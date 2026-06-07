# ADR-0046: Production Stability — Docker Compose Deployment & Resilience

## Status

Accepted (2026-06-07)

## Context

The platform is approaching pilot deployment for SMB clients. The operator is a single OPC — no DevOps team, no SRE on-call. The system needs to be deployable, observable, and self-healing within the constraints of one person managing it.

Key constraints:
- Traffic is low (tens of users per tenant, not thousands)
- Data is not real-time transactional (AVC monthly reports, research PDFs)
- LLM dependency (DeepSeek) is external and unreliable
- Two background queue workers (pg-boss) already exist but have no retry config wired
- No health checks, no deployment artifact, no backup strategy exist today

## Decision

### Deployment: Docker Compose on single VPS

Three containers: `postgres` (self-hosted PG with volume), `api` (NestJS core-api + pg-boss workers), `web` (Next.js SSR). No Kubernetes — the traffic doesn't justify it, and the operational burden of K8s for one person outweighs the benefits.

Trade-off: no auto-scaling, no rolling deploys. Acceptable because traffic is low and a 30-second restart window during deploys is fine for SMB pilots.

### LLM failure handling: classify and surface

`ResilientLlmClient` changes:
- **4xx errors (invalid request, auth failure): do NOT retry.** These are permanent.
- **5xx / timeout / network errors: retry up to 3 times** with exponential backoff + random jitter (±25% of delay) to prevent thundering herd.
- No circuit breaker (adds complexity for low-traffic scenario; revisit if multi-tenant load grows).
- No LLM fallback provider (maintaining prompt/tool compatibility across two providers costs more than occasional downtime).
- Non-LLM functionality (query, ontology browsing, Pipeline status) is unaffected by LLM outage.

### pg-boss retry configuration

| Queue | retryLimit | retryDelay | retryBackoff | expireInHours |
|-------|-----------|------------|--------------|---------------|
| `sync-job` | 3 | 30s | true | 4 |
| `pipeline-run` | 1 | 30s | true | 1 |

Rationale:
- **sync-job** input is a finalized clean Dataset + static Mapping — failure is almost certainly transient (DB blip, lock contention). 3 retries is generous.
- **pipeline-run** executes transform logic in-memory — if the data causes an error (type mismatch, NaN), retrying won't help. 1 retry covers OOM-recovery / connection-drop scenarios only.
- `expireInHours` differs because pipeline-run is in-memory (1h is already very generous); sync-job can legitimately queue behind other work.

Additionally: `boss.on('error', ...)` handler to log queue-level failures that would otherwise go unobserved.

### Health checks

- **`GET /health`** — checks Postgres connectivity (`SELECT 1`) and pg-boss state (not errored). Used by Docker `healthcheck` to trigger container restart.
- **`GET /health/llm`** — reports last-known LLM reachability (based on recent call success/failure, not a live probe). For monitoring only; does NOT participate in restart decisions. DeepSeek being down should not restart the container.

### Backup

Daily `pg_dump --format=custom` via host cron → upload to object storage (OSS/COS), retain 7 days. RPO = 24 hours. Acceptable because AVC reports can be re-ingested and research documents are stored in BlobStore (separate from PG, backed up alongside).

No WAL archiving — operational overhead too high for one person, and 24h RPO is fine for monthly market data.

### Alerting

Channel: **Feishu webhook** (immediate) + **email** (archive).

Trigger conditions (minimal set):
1. `/health` fails 3 consecutive checks → container likely wedged
2. pg-boss queue depth > 50 AND no consumption for 30 minutes → worker stuck
3. LLM failures > 10 in 5 minutes → DeepSeek outage
4. Disk usage > 80% → BlobStore PDFs filling disk

Implementation: lightweight monitoring script (cron on host or external uptime service), not Prometheus + Grafana.

## Alternatives Considered

| Alternative | Why rejected |
|-------------|-------------|
| Kubernetes | Operational burden for one person; traffic doesn't justify auto-scaling |
| LLM fallback (Qwen/GLM) | Maintaining dual prompt/tool compatibility is expensive; outage windows are short and acceptable |
| WAL archiving (RPO ≈ minutes) | Overkill for monthly market data; `pg_dump` daily is sufficient |
| Prometheus + Grafana | Infrastructure overhead; a cron script + webhook covers the 4 alert conditions |
| Combined api+web container | Different failure modes (api has long-running workers, web is stateless SSR); independent restart is safer |

## Consequences

- Deployment is repeatable: `docker compose up -d` on any VPS with Docker.
- pg-boss transient retries actually fire (currently dead code).
- LLM outage is isolated — non-AI features stay available.
- Data loss window is bounded to 24h worst case.
- OPC gets notified via Feishu within minutes of system issues.
- No path to horizontal scaling without migrating to K8s or managed services — acceptable for current stage; revisit when a single VPS CPU/RAM is saturated.
