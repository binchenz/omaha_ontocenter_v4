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

**Variables that MUST be changed for production (★):**

```bash
DATABASE_URL=postgresql://<user>:<password>@<host>:5432/ontocenter
JWT_SECRET=<openssl rand -hex 32>
CONNECTOR_ENCRYPTION_KEY=<openssl rand -hex 16>   # must be exactly 32 chars
DEEPSEEK_API_KEY=<production API key>
NEXT_PUBLIC_API_URL=https://<your-domain>/api
```

### 3. Initialize the database

```bash
pnpm db:generate
pnpm --filter @omaha/db prisma migrate deploy
pnpm db:seed
```

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

curl -X POST https://your-domain.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@system.local","password":"<password from seed>"}'
```

## Reset admin password

```bash
cd /opt/omaha_ontocenter_v4
node -e "
const bcrypt = require('bcrypt');
bcrypt.hash('new-password', 10).then(h => console.log(h));
" | xargs -I{} pnpm --filter @omaha/db prisma db execute \
  --stdin <<< "UPDATE users SET password_hash='{}' WHERE email='admin@system.local';"
```

## Update deployment

```bash
cd /opt/omaha_ontocenter_v4
git pull
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @omaha/db prisma migrate deploy
pm2 restart all
```

## Pre-launch checklist

- [ ] `JWT_SECRET` replaced with a random value
- [ ] `CONNECTOR_ENCRYPTION_KEY` replaced with a random value
- [ ] `DEEPSEEK_API_KEY` is the production key
- [ ] HTTPS certificate configured
- [ ] Nginx `proxy_buffering off` set
- [ ] Database backup strategy in place
- [ ] PM2 startup configured (`pm2 startup`)
