# Getting Started

## Prerequisites

- Node.js 20+
- pnpm 9+ (`npm install -g pnpm`)
- Docker (for local Postgres)
- DeepSeek API key ([sign up](https://platform.deepseek.com))

## Steps

### 1. Clone the repository

```bash
git clone https://github.com/binchenz/omaha_ontocenter_v4.git
cd omaha_ontocenter_v4
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

The `.env` file works out of the box for local development — no keys to fill in manually:

- `DEEPSEEK_API_KEY` — the first-run Setup Wizard will guide you through entering and testing it
- `JWT_SECRET`, `CONNECTOR_ENCRYPTION_KEY` — leave unset; the wizard generates random values and stores them in the database

Only set these explicitly if you need to pin secrets across multiple replicas (see [Deployment](deployment.en.md)).

### 3. Start the database

```bash
docker-compose up -d
```

Postgres starts on `localhost:5434`.

### 4. Initialize the project

```bash
pnpm setup
```

This runs in sequence:

1. `pnpm install` — install all dependencies
2. `pnpm db:generate` — generate Prisma client
3. `pnpm db:migrate` — run database migrations

The database is empty after this step — the Setup Wizard handles the rest.

### 5. Start the dev server

```bash
pnpm dev
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| API | http://localhost:3001 |

### 6. First visit: Setup Wizard

Open http://localhost:3000 — because the database is empty you'll be redirected to the `/setup` wizard:

1. Enter your DeepSeek API key and test the connection
2. Create your organization, admin email, and password

After the wizard completes, log in with the admin account you just created. Add more users under **Settings → Users**.

### 7. Want to explore with demo data? (optional)

```bash
pnpm setup:demo   # same as pnpm setup, plus demo tenant
pnpm dev
```

Login: `admin@demo.com` / `admin123`

> The demo tenant and the Setup Wizard are mutually exclusive: once demo data is loaded, the wizard no longer appears. Pick one path.

## Troubleshooting

**Database connection error**: Confirm `docker-compose up -d` is running and `DATABASE_URL` in `.env` uses port `5434`.

**pnpm setup fails**: Verify Node.js version is ≥ 20 (`node -v`).

**Wizard not showing**: The database already has a tenant (you may have run `pnpm setup:demo` or `pnpm db:seed`). The wizard only appears on a fresh empty database.

**Agent not responding**: Check the DeepSeek API key you entered in the Setup Wizard; you can re-test it under Settings.
