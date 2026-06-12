# Production Deployment

## Prerequisites

- Linux server (2 vCPU / 4 GB RAM minimum)
- PostgreSQL 16+ (cloud database service works fine)
- Node.js 20+, pnpm 9+
- Nginx (reverse proxy)
- DeepSeek production API key

## Steps

### 1. Deploy code

```bash
cd /opt
git clone https://github.com/binchenz/omaha_ontocenter_v4.git
cd omaha_ontocenter_v4
pnpm install --frozen-lockfile
pnpm build
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

**Variables that MUST be set:**

```bash
DATABASE_URL=postgresql://<user>:<password>@<host>:5432/ontocenter
NEXT_PUBLIC_API_URL=https://<your-domain>/api
```

**Secrets (optional):** `JWT_SECRET`, `CONNECTOR_ENCRYPTION_KEY`, and `DEEPSEEK_API_KEY` are generated/collected by the Setup Wizard on first run and stored in the database — no need to set them in `.env`.

Set them explicitly only when:
- Running multiple replicas that must share the same `JWT_SECRET` (`openssl rand -hex 32`)
- Pinning `CONNECTOR_ENCRYPTION_KEY` across redeploys (changing it makes existing connector passwords undecryptable)

```bash
# Only for multi-replica / pinned-secret setups
JWT_SECRET=<openssl rand -hex 32>
CONNECTOR_ENCRYPTION_KEY=<openssl rand -hex 16>
```

### 3. Initialize the database

```bash
pnpm db:generate
pnpm db:migrate:deploy
```

The database stays empty after migration — the Setup Wizard initializes it (organization, admin, secrets) on first visit.

### 4. Start services (PM2)

```bash
npm install -g pm2

pm2 start "node apps/core-api/dist/main.js" --name ontocenter-api

pm2 start "node apps/web/.next/standalone/server.js" \
  --name ontocenter-web \
  --env PORT=3000

pm2 save
pm2 startup
```

### 5. Nginx reverse proxy

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
    }

    location /api/ {
        proxy_pass http://localhost:3001/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        # Required for SSE streaming
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }
}
```

> **Important**: `proxy_buffering off` is required for the Agent's SSE streaming to work. Without it, users won't see real-time responses.

### 6. Smoke test

```bash
curl https://your-domain.com/api/health
```

On first visit, https://your-domain.com redirects to the Setup Wizard. Complete initialization in the browser (enter the API key, create the admin account). After the wizard completes, you can log in normally.

## Update deployment

```bash
cd /opt/omaha_ontocenter_v4
git pull
pnpm install --frozen-lockfile
pnpm build
pnpm db:migrate:deploy
pm2 restart all
```

## Pre-launch checklist

- [ ] `DATABASE_URL` points to the production database
- [ ] `NEXT_PUBLIC_API_URL` set to the public domain
- [ ] HTTPS certificate configured
- [ ] Nginx `proxy_buffering off` set (required for SSE streaming)
- [ ] Database backup strategy in place
- [ ] PM2 startup configured (`pm2 startup`)
- [ ] Setup Wizard completed after first visit (API key + admin account)
