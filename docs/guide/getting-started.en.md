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

Open `.env` and fill in the required values:

| Variable | Description |
|----------|-------------|
| `DEEPSEEK_API_KEY` | Your DeepSeek API key |
| `JWT_SECRET` | Any random string (default is fine for dev) |
| `CONNECTOR_ENCRYPTION_KEY` | Must be exactly 32 characters (default is fine for dev) |

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
4. `pnpm db:seed` — seed initial data (default admin account)

### 5. Start the dev server

```bash
pnpm dev
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| API | http://localhost:3001 |

### 6. Load demo data (optional)

```bash
cd scripts
pnpm tsx demo-ecommerce/setup.ts      # create tenant + ontology
pnpm tsx demo-ecommerce/seed-base.ts  # generate ~20k orders (~2 min)
pnpm tsx demo-ecommerce/seed-signal.ts  # overlay demo story data
```

Login at http://localhost:3000/login  
Email: `admin@demo-ecommerce.local` / Password: `demo2026`

## Troubleshooting

**Database connection error**: Confirm `docker-compose up -d` is running and `DATABASE_URL` in `.env` uses port `5434`.

**pnpm setup fails**: Verify Node.js version is ≥ 20 (`node -v`).

**Agent not responding**: Check that `DEEPSEEK_API_KEY` is set correctly in `.env`.
