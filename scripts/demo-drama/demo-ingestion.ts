/**
 * demo-drama: demo-ingestion
 *
 * Drives the Agent through the full DataIngestionSkill DB import flow:
 *   connect to drama_staging → list tables → preview → infer schema
 *   (including description + unit) → confirm → create_object_type + import_data
 *
 * This is path ② of ADR-0022: non-deterministic, human-facing, not run in CI.
 * It proves "connect DB → Agent auto-models with semantic annotations → queryable".
 *
 * Prerequisites:
 *   - pnpm dev running (API on OMAHA_API_BASE_URL, default http://localhost:3001)
 *   - demo-drama tenant seeded (run setup.ts first)
 *   - drama_staging schema populated (run stage-to-pg.ts first)
 *
 * Usage:
 *   cd scripts && pnpm tsx demo-drama/demo-ingestion.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const API_BASE = process.env.OMAHA_API_BASE_URL || 'http://localhost:3001';
const TENANT_SLUG = 'demo-drama';
const ADMIN_EMAIL = 'admin@demo-drama.local';
const ADMIN_PASSWORD = 'demo2026';

// DB connection info for the staging schema (same PG instance as platform DB)
const DB_URL = new URL(process.env.DATABASE_URL || 'postgresql://localhost:5432/ontocenter');
const STAGING_DB = {
  host: DB_URL.hostname,
  port: DB_URL.port || '5432',
  user: DB_URL.username,
  password: DB_URL.password,
  database: DB_URL.pathname.replace(/^\//, ''),
};

interface SseEvent {
  type: string;
  conversationId?: string;
  id?: string;
  toolName?: string;
  args?: unknown;
  message?: string;
  content?: string;
  [key: string]: unknown;
}

// ── SSE consumer ─────────────────────────────────────────────────────────────

async function* streamSse(url: string, body: unknown, token: string): AsyncGenerator<SseEvent> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

  const decoder = new TextDecoder();
  let buffer = '';
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try { yield JSON.parse(line.slice(6)); } catch {}
    }
  }
}

// Collect all events from one SSE call; return { events, conversationId }
async function call(
  endpoint: string,
  body: unknown,
  token: string,
): Promise<{ events: SseEvent[]; conversationId: string }> {
  const events: SseEvent[] = [];
  let conversationId = (body as any).conversationId ?? '';
  for await (const ev of streamSse(`${API_BASE}${endpoint}`, body, token)) {
    events.push(ev);
    if (ev.type === 'done' && ev.conversationId) conversationId = ev.conversationId as string;
    if (ev.type === 'text') process.stdout.write(`\n[agent] ${ev.content}`);
    if (ev.type === 'tool_call') console.log(`\n[tool]  ${ev.name}(${JSON.stringify(ev.args).slice(0, 120)}…)`);
    if (ev.type === 'confirmation_request') console.log(`\n[confirm?] ${ev.message}`);
  }
  return { events, conversationId };
}

// ── Turn loop ─────────────────────────────────────────────────────────────────

// Send a user message; if Agent pauses for confirmation, auto-confirm and continue.
async function turn(
  message: string,
  conversationId: string,
  token: string,
): Promise<{ conversationId: string; events: SseEvent[] }> {
  console.log(`\n[user]  ${message}`);
  let { events, conversationId: cid } = await call(
    '/agent/chat',
    { message, conversationId: conversationId || undefined },
    token,
  );

  // Auto-confirm any confirmation_request events
  while (events.some(e => e.type === 'confirmation_request')) {
    console.log('\n[auto-confirm] ✓');
    ({ events, conversationId: cid } = await call(
      '/agent/confirm',
      { conversationId: cid, confirmed: true },
      token,
    ));
  }

  return { conversationId: cid, events };
}

// ── Login ─────────────────────────────────────────────────────────────────────

async function login(): Promise<string> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, tenantSlug: TENANT_SLUG }),
  });
  if (!res.ok) throw new Error(`Login failed: HTTP ${res.status}`);
  const body = await res.json() as { accessToken: string };
  return body.accessToken;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('[demo-ingestion] logging in…');
  const token = await login();

  let cid = '';

  // Step 1: initiate DB ingestion
  ({ conversationId: cid } = await turn(
    '我想连接数据库导入短剧拉片数据，帮我接入。',
    cid, token,
  ));

  // Step 2-5: provide connection info step by step
  for (const [label, value] of [
    ['host', STAGING_DB.host],
    ['port', STAGING_DB.port],
    ['user', STAGING_DB.user],
    ['password', STAGING_DB.password],
    ['database', STAGING_DB.database],
  ]) {
    ({ conversationId: cid } = await turn(value, cid, token));
    void label; // used only for logging context
  }

  // Step 6: pick tables
  ({ conversationId: cid } = await turn(
    '请导入 drama_staging.episodes 和 drama_staging.shots 这两张表。',
    cid, token,
  ));

  // Step 7+: Agent previews, infers schema, asks for confirmation — auto-confirmed in turn()
  // Continue until Agent signals completion or no more confirmation_requests
  ({ conversationId: cid } = await turn(
    '好的，按你推断的结构导入，不需要修改。',
    cid, token,
  ));

  console.log('\n[demo-ingestion] done. conversationId:', cid);
  console.log('[demo-ingestion] Check the demo-drama tenant — object types and instances should now exist.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
