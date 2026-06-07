#!/usr/bin/env bash
# OntoCenter monitoring script (ADR-0046)
# Run via host cron: */5 * * * * /path/to/deploy/monitor.sh
#
# Required environment variables:
#   FEISHU_WEBHOOK_URL  — Feishu bot webhook URL
#   ALERT_EMAIL         — email address for alert archive
#   API_URL             — core-api URL (default: http://localhost:3001)
#   DATABASE_URL        — postgres connection string for queue depth check
#   DISK_MOUNT          — disk mount point to check (default: /)
#
# Optional:
#   HEALTH_FAIL_THRESHOLD — consecutive /health failures before alert (default: 3)
#   QUEUE_DEPTH_THRESHOLD — pg-boss queue depth alert threshold (default: 50)
#   QUEUE_STALE_MINUTES   — minutes without consumption before alert (default: 30)
#   LLM_FAIL_THRESHOLD    — LLM failures in window before alert (default: 10)
#   DISK_THRESHOLD        — disk usage % threshold (default: 80)
#   COOLDOWN_SECONDS      — seconds between repeated alerts for same condition (default: 3600)
#   STATE_DIR             — directory for state files (default: /tmp/ontocenter-monitor)

set -euo pipefail

# Configuration
API_URL="${API_URL:-http://localhost:3001}"
FEISHU_WEBHOOK_URL="${FEISHU_WEBHOOK_URL:?FEISHU_WEBHOOK_URL is required}"
ALERT_EMAIL="${ALERT_EMAIL:-}"
DISK_MOUNT="${DISK_MOUNT:-/}"
HEALTH_FAIL_THRESHOLD="${HEALTH_FAIL_THRESHOLD:-3}"
QUEUE_DEPTH_THRESHOLD="${QUEUE_DEPTH_THRESHOLD:-50}"
QUEUE_STALE_MINUTES="${QUEUE_STALE_MINUTES:-30}"
LLM_FAIL_THRESHOLD="${LLM_FAIL_THRESHOLD:-10}"
DISK_THRESHOLD="${DISK_THRESHOLD:-80}"
COOLDOWN_SECONDS="${COOLDOWN_SECONDS:-3600}"
STATE_DIR="${STATE_DIR:-/tmp/ontocenter-monitor}"

mkdir -p "${STATE_DIR}"

# ── Helper functions ──────────────────────────────────────────────────────────

send_feishu() {
  local msg="$1"
  curl -s -X POST "${FEISHU_WEBHOOK_URL}" \
    -H "Content-Type: application/json" \
    -d "{\"msg_type\":\"text\",\"content\":{\"text\":\"${msg}\"}}" > /dev/null 2>&1 || true
}

send_email() {
  local subject="$1"
  local body="$2"
  if [[ -n "${ALERT_EMAIL}" ]]; then
    echo "${body}" | mail -s "${subject}" "${ALERT_EMAIL}" 2>/dev/null || true
  fi
}

# Check cooldown — returns 0 if alert should fire, 1 if in cooldown
check_cooldown() {
  local key="$1"
  local state_file="${STATE_DIR}/${key}.last_alert"
  if [[ -f "${state_file}" ]]; then
    local last_alert
    last_alert=$(cat "${state_file}")
    local now
    now=$(date +%s)
    local diff=$((now - last_alert))
    if [[ ${diff} -lt ${COOLDOWN_SECONDS} ]]; then
      return 1
    fi
  fi
  return 0
}

mark_alerted() {
  local key="$1"
  date +%s > "${STATE_DIR}/${key}.last_alert"
}

alert() {
  local key="$1"
  local msg="$2"
  if check_cooldown "${key}"; then
    send_feishu "⚠️ OntoCenter: ${msg}"
    send_email "[OntoCenter Alert] ${key}" "${msg}"
    mark_alerted "${key}"
    echo "[monitor] ALERT: ${msg}"
  else
    echo "[monitor] (cooldown) ${msg}"
  fi
}

# ── Check 1: /health endpoint ────────────────────────────────────────────────

check_health() {
  local state_file="${STATE_DIR}/health_failures"
  local http_code
  http_code=$(curl -s -o /dev/null -w "%{http_code}" "${API_URL}/health" 2>/dev/null || echo "000")

  if [[ "${http_code}" != "200" ]]; then
    local count
    count=$(cat "${state_file}" 2>/dev/null || echo "0")
    count=$((count + 1))
    echo "${count}" > "${state_file}"
    if [[ ${count} -ge ${HEALTH_FAIL_THRESHOLD} ]]; then
      alert "health" "/health 连续失败 ${count} 次 (HTTP ${http_code})，系统可能已停止响应"
    fi
  else
    echo "0" > "${state_file}"
  fi
}

# ── Check 2: pg-boss queue depth ─────────────────────────────────────────────

check_queue() {
  if [[ -z "${DATABASE_URL:-}" ]]; then
    return
  fi

  # Single query: fetch both queue depth and recent completions in one connection.
  local result
  result=$(psql "${DATABASE_URL}" -t -A -c \
    "SELECT (SELECT COUNT(*) FROM pgboss.job WHERE state IN ('created','retry')), (SELECT COUNT(*) FROM pgboss.job WHERE state = 'completed' AND completedon > NOW() - INTERVAL '${QUEUE_STALE_MINUTES} minutes');" 2>/dev/null || echo "0|1")

  local depth recent
  depth=$(echo "${result}" | cut -d'|' -f1)
  recent=$(echo "${result}" | cut -d'|' -f2)

  if [[ ${depth} -gt ${QUEUE_DEPTH_THRESHOLD} ]] && [[ ${recent} -eq 0 ]]; then
    alert "queue" "pg-boss 队列积压 ${depth} 个任务，${QUEUE_STALE_MINUTES} 分钟内无消费，worker 可能已停止"
  fi
}

# ── Check 3: LLM failures ───────────────────────────────────────────────────

check_llm() {
  local response
  response=$(curl -s "${API_URL}/health/llm" 2>/dev/null || echo "{}")

  local reachable
  reachable=$(echo "${response}" | grep -o '"reachable":\s*false' || true)

  if [[ -n "${reachable}" ]]; then
    alert "llm" "LLM (DeepSeek) 最近调用失败，AI 功能可能不可用"
  fi
}

# ── Check 4: Disk usage ──────────────────────────────────────────────────────

check_disk() {
  local usage
  usage=$(df "${DISK_MOUNT}" | tail -1 | awk '{print $5}' | tr -d '%')

  if [[ ${usage} -ge ${DISK_THRESHOLD} ]]; then
    alert "disk" "磁盘使用率 ${usage}% (阈值 ${DISK_THRESHOLD}%)，请清理 BlobStore 或扩容"
  fi
}

# ── Main ─────────────────────────────────────────────────────────────────────

echo "[monitor] $(date '+%Y-%m-%d %H:%M:%S') Running checks..."
check_health &
check_queue &
check_llm &
check_disk &
wait
echo "[monitor] Done."
