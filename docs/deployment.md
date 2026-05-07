# Production Deployment — Aliyun

This is the runbook for deploying Omaha OntoCenter to Aliyun for the drama-co engagement (and any future single-customer engagement on the same shape). It assumes the customer's source database is already on Aliyun RDS and accessible via VPC.

> **Audience:** the integration engineer running the deployment. Read top to bottom; commands are copy-pastable. Items marked **★ MUST CHANGE** are values you cannot reuse from dev.

---

## What we deploy vs what we don't

We deploy:
- `apps/core-api` (NestJS API server)
- `apps/web` (Next.js frontend)
- A **new** Postgres database for our platform's `object_instances`, `object_types`, `audit_logs`, etc. (the `ontocenter` database — empty until step 5)
- A one-shot ingest script run that pulls the customer's source data into our platform database

We do **not** deploy:
- The customer's source database (it already exists; we read from it; we never write to it)
- Anything from your local Mac (no `node_modules`, no `dist/`, no `scripts/test-results/*`, no docker volumes)
- The dev `.env` (every value gets regenerated)

---

## Prerequisites

- [ ] Aliyun ECS instance (2 vCPU / 4 GB RAM minimum; CentOS 7+ / Ubuntu 22.04 / AlibabaCloud Linux 3 fine)
- [ ] Aliyun RDS Postgres instance for our platform DB. **Same VPC as the customer's source RDS** so we can use internal endpoints.
- [ ] VPC peering or same-VPC placement so ECS can reach the customer's source RDS internal endpoint
- [ ] Domain + HTTPS cert (Aliyun SLB / Nginx + Let's Encrypt)
- [ ] DeepSeek **production** API key (`api.deepseek.com` — do not reuse the dev key)
- [ ] Node.js 20.x LTS + pnpm 9.x on ECS
- [ ] Git access to `https://github.com/binchenz/omaha_ontocenter_v4`

---

## Step 1 — Provision the platform database

Open Aliyun RDS console:

1. Pick the existing customer-source RDS instance, **or** spin up a new RDS Postgres instance in the **same VPC**.
2. Create a database named `ontocenter`.
3. Create a database user `omaha_prod` with full privileges on `ontocenter` only. **★ MUST CHANGE** — generate a strong password.
4. Note the **internal endpoint** (e.g. `pgm-bp1xxxx.pg.rds.aliyuncs.com:5432`).
5. Add the ECS instance's internal IP to the RDS whitelist.

Verify from ECS:
```bash
psql "postgresql://omaha_prod:<pwd>@<internal-endpoint>:5432/ontocenter" -c "SELECT 1;"
```

---

## Step 2 — Whitelist ECS for the customer's source RDS

The customer's source database is `pgm-bp1vjn89c3q54h0fto.pg.rds.aliyuncs.com:5432/film_ai`. Ask the customer's DBA to:

1. Add the ECS instance's internal IP to the source RDS whitelist (read-only access is sufficient — we only `SELECT`).
2. Confirm the **internal endpoint** (the public one will work but is slow and times out under load — the dev runs hit ECONNRESET several times).

Verify:
```bash
psql "postgresql://short_play:<pwd>@<source-internal-endpoint>:5432/film_ai" \
  -c "SELECT count(*) FROM uploaded_books;"
```

---

## Step 3 — Deploy code on ECS

```bash
cd /opt
sudo git clone https://github.com/binchenz/omaha_ontocenter_v4.git
sudo chown -R $USER:$USER omaha_ontocenter_v4
cd omaha_ontocenter_v4
pnpm install --frozen-lockfile
pnpm --filter @omaha/db generate
pnpm --filter @omaha/shared-types build
pnpm --filter @omaha/dsl build
pnpm --filter @omaha/core-api build
pnpm --filter @omaha/web build
```

`pnpm --filter @omaha/core-api build` produces `apps/core-api/dist/main.js` — that's what we run in production.

---

## Step 4 — Write the production environment file

Create `/opt/omaha_ontocenter_v4/.env` with restricted permissions:

```bash
sudo install -m 600 /dev/null .env
```

Fill it in (★ marks values you must change from dev):

```
# Our platform database
DATABASE_URL=postgresql://omaha_prod:<step1-pwd>@<step1-endpoint>:5432/ontocenter?schema=public

# Customer source database (read-only)
FILM_AI_SOURCE_URL=postgresql://short_play:<customer-pwd>@<source-internal-endpoint>:5432/film_ai

# ★ MUST CHANGE — generate fresh: `openssl rand -hex 32`
JWT_SECRET=<32-byte hex>
JWT_EXPIRES_IN=7d

# ★ MUST CHANGE — generate at platform.deepseek.com (production key, not dev)
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-<production key>

# Server
PORT=3001
NODE_ENV=production

# Connector encryption
# ★ MUST CHANGE — generate fresh: `openssl rand -hex 32`
CONNECTOR_ENCRYPTION_KEY=<32-byte hex>
```

> **Why JWT_SECRET must change:** the dev value is committed-adjacent default. Once production tokens are signed with a key, never rotate it lightly — all sessions expire on rotation.

> **Why CONNECTOR_ENCRYPTION_KEY must change:** ConnectorClient uses this to AES-encrypt customer DB credentials in `connectors.config.password`. If you reuse the dev key, anyone with the dev key can decrypt prod connector configs.

---

## Step 5 — Migrate the platform database schema

The platform database is empty after step 1. Apply our 4 migrations:

```bash
cd /opt/omaha_ontocenter_v4
pnpm --filter @omaha/db prisma migrate deploy
```

Expected output: 4 migrations applied (`20260503035155_init`, `20260504040518_add_object_instance_deleted_at`, `20260504045954_add_audit_log_filter_and_hash`, `20260506041700_add_object_type_index_registry`).

Verify:
```bash
psql "$DATABASE_URL" -c "\dt"   # should show ~14 tables: tenants, users, roles, object_types, object_instances, etc.
```

The platform database has tables but no tenant, no ObjectType, no instances. The next step seeds it from the customer's source data.

---

## Step 6 — One-shot ingest from customer source

This step does **everything** for the drama-co tenant:
- Creates the `drama_co` tenant + admin user (and **prints the generated admin password once**)
- Registers the 8 v2 ObjectTypes per ADR-0015
- Builds ADR-0011 expression indexes via the registry
- Pulls all data from `film_ai` and writes ~378k Object Instances

```bash
# Dry-run first so you see expected row counts before writing.
pnpm --filter @omaha/scripts run import:film-ai-v2 -- --dry-run

# When the planned counts look right:
pnpm --filter @omaha/scripts run import:film-ai-v2 -- --confirm
```

> **★ CAPTURE THE ADMIN PASSWORD.** Look for the line `[bootstrap] INITIAL PASSWORD (save this): xxxx`. It is printed exactly once. If you miss it, see "Resetting the admin password" below.

Expected ingest time on internal-VPC RDS: **5-15 minutes** (was ~10 min on a Mac over public internet).

Verify counts:
```bash
psql "$DATABASE_URL" -c "
  SELECT object_type, count(*)
  FROM object_instances
  WHERE tenant_id = (SELECT id FROM tenants WHERE slug='drama_co')
  GROUP BY object_type
  ORDER BY 2 DESC;
"
```

Expect 8 ObjectTypes; numbers should match the customer's source counts at ingest time. Re-running `--confirm` is idempotent (updates in place; no duplicates).

---

## Step 7 — Start the services

The simplest path is `pm2`. Install it: `npm install -g pm2`.

```bash
cd /opt/omaha_ontocenter_v4

# API server
pm2 start apps/core-api/dist/main.js --name omaha-api --instances 1 --time

# Web frontend (Next.js production)
pm2 start "pnpm --filter @omaha/web start" --name omaha-web --time

pm2 save
pm2 startup    # one-time, then run the command pm2 prints
```

Verify:
```bash
curl http://localhost:3001/auth/login -X POST -H 'Content-Type: application/json' \
  -d '{"email":"a@b.cd","password":"zzzzzz","tenantSlug":"drama_co"}'
# expect: {"message":["password must be longer than or equal to 6 characters"], ...}
```

The 400 here means the server is up and validating input correctly.

---

## Step 8 — Reverse proxy + HTTPS

Put Nginx in front (or Aliyun SLB). Minimal Nginx config:

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;
    ssl_certificate     /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    # API
    location /api/ {
        proxy_pass http://127.0.0.1:3001/;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_buffering off;          # SSE — agent stream
        proxy_read_timeout 300s;      # agent calls can take >60s
    }

    # Web
    location / {
        proxy_pass http://127.0.0.1:3000/;   # Next.js default
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }
}
```

> **Why `proxy_buffering off` on /api/:** the agent uses Server-Sent Events for streaming responses. If Nginx buffers, the user sees the answer in one delayed dump instead of token-by-token streaming.

> **Why `proxy_read_timeout 300s`:** complex agent queries (#36 follow-up territory) can take 60-120s. The default 60s would cut them off mid-stream.

---

## Step 9 — Acceptance smoke test

Run our drama-co Agent acceptance suite from a developer laptop pointed at the production API:

```bash
# From local dev machine, env vars set to point at prod:
OMAHA_API_BASE_URL=https://your-domain.com/api \
DRAMA_CO_PASSWORD=<password from step 6> \
DATABASE_URL='<production DATABASE_URL — read-only access OK>' \
  pnpm --filter @omaha/scripts run test:drama-agent -- --smoke
```

Expected: `auto-judged 4/7 pass`, 4 humanReview answers (all should be reasonable when read by a human). If smoke is healthy, do a `--full` (~10 min) for the post-deploy baseline.

If smoke fails on an unexpected scenario, read the report at `scripts/test-results/drama-agent-smoke-<ts>.md` and check:
- **A1.x fails for "数字 not found":** API server can't reach LLM (DeepSeek key wrong, or egress blocked).
- **All scenarios time out:** API server can't reach platform RDS (DATABASE_URL wrong or whitelist missing).
- **Login fails:** admin password mismatch — see "Resetting" below.

---

## Step 10 — Hand-off to customer

Provide the customer with:
- Application URL: `https://your-domain.com/`
- Tenant slug: `drama_co`
- Admin email: `admin@drama-co.local` (from step 6)
- Admin password: from step 6 capture
- Recommend they change the password on first login (UI flow exists; not yet enforced)

---

## Resetting the admin password (if missed in step 6)

```bash
cd /opt/omaha_ontocenter_v4/apps/core-api
NEW_PWD=$(openssl rand -base64 12)
echo "NEW PASSWORD: $NEW_PWD"
DATABASE_URL="$DATABASE_URL" node -e "
  const bcrypt = require('bcrypt');
  const { PrismaClient } = require('@omaha/db');
  (async () => {
    const p = new PrismaClient();
    const t = await p.tenant.findUniqueOrThrow({ where: { slug: 'drama_co' }});
    const hash = await bcrypt.hash(process.env.NEW_PWD, 10);
    await p.user.update({
      where: { tenantId_email: { tenantId: t.id, email: 'admin@drama-co.local' }},
      data: { passwordHash: hash }
    });
    console.log('reset OK');
    await p.\$disconnect();
  })();
" NEW_PWD="$NEW_PWD"
```

---

## Re-ingesting (when the customer's source has new data)

The drama-co engagement is one-shot snapshot per ADR-0014/0015. If the customer asks for refreshed data:

```bash
cd /opt/omaha_ontocenter_v4
pnpm --filter @omaha/scripts run import:film-ai-v2 -- --confirm
```

Re-running is idempotent: existing rows are updated in place, new rows are inserted, no duplicates. **Schedule it during off-hours** because it locks active reads briefly during the per-row update phase (45k chapter_summaries × ~3ms each = ~2 minutes of write pressure).

---

## What is deliberately NOT in this runbook

| Topic | Where to look |
|---|---|
| Background data migration / live sync | Out of scope per ADR-0014/0015 — snapshot only. |
| Multi-tenant onboarding | One tenant per engagement currently. CONTEXT.md `Tenant` definition is the spec. |
| Backup / restore | Use Aliyun RDS automatic backup + point-in-time recovery. Application-level dump not needed. |
| Horizontal scaling of API | Single-process `pm2` is fine for one customer. Scale via process count or move to ACK if multi-customer. |
| Observability beyond `pm2 logs` | Add Aliyun ARMS / Loghub when you have a SLA to hit. |

---

## Pre-launch sanity checklist

Before sharing the URL with the customer:

- [ ] Smoke test passed (step 9)
- [ ] `pm2 status` shows both processes online
- [ ] HTTPS cert valid; HTTP redirects to HTTPS
- [ ] Login as `admin@drama-co.local` with the password from step 6 succeeds
- [ ] `/api/auth/login` 400s on bad input (proves API + RDS reachable)
- [ ] Open the web UI → ask "我们有几本书" → Agent returns `292` (or current count)
- [ ] Open the web UI → ask "评分大于 90 的书总字数" → Agent returns ~3500万字
- [ ] `audit_logs` rows are being written (`SELECT count(*) FROM audit_logs WHERE tenant_id = ... AND created_at > now() - interval '5 minutes';`)
- [ ] All env values in `/opt/omaha_ontocenter_v4/.env` are production values (no `localhost`, no dev keys)
