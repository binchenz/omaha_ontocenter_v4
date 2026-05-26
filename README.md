# OmahA OntoCenter

**基于本体论的智能数据平台** — 通过自然语言对话查询、管理和集成企业业务数据。

An ontology-driven data platform where business users query, manage, and integrate enterprise data through natural language conversation.

---

## 核心能力 / Key Features

- **自然语言查询** — 用对话方式查询业务数据，无需 SQL。Ask questions in plain language, no SQL required.
- **动态本体建模** — 运行时定义对象类型、属性和关系，无需改表结构。Define object types, properties, and relationships at runtime without schema migrations.
- **权限即代码** — 行级 + 字段级权限用 DSL 表达式声明，与查询共享同一编译器。Row-level and field-level permissions declared as DSL expressions, compiled alongside queries.
- **Agent 工具扩展** — 14 个内置工具，可扩展的 Skill 体系，LLM 自动选择调用。14 built-in tools with an extensible Skill system; the LLM selects tools automatically.

---

## 快速开始 / Quick Start

### 前置条件 / Prerequisites

- Node.js 20+, pnpm 9+
- Docker（用于本地 Postgres / for local Postgres）
- DeepSeek API key（[申请地址](https://platform.deepseek.com)）

### 1. 克隆并配置环境 / Clone and configure

```bash
git clone https://github.com/binchenz/omaha_ontocenter_v4.git
cd omaha_ontocenter_v4
cp .env.example .env
# 编辑 .env，填入 DEEPSEEK_API_KEY / Edit .env and set DEEPSEEK_API_KEY
```

### 2. 启动数据库 / Start database

```bash
docker-compose up -d
```

### 3. 一键初始化 / One-command setup

```bash
pnpm setup
```

这条命令会依次执行：安装依赖 → 生成 Prisma client → 运行数据库迁移 → 初始化种子数据。

This runs: install dependencies → generate Prisma client → run migrations → seed initial data.

### 4. 启动应用 / Start the app

```bash
pnpm dev
```

- 前端 / Frontend: http://localhost:3000
- API: http://localhost:3001

### 5. 加载演示数据（可选）/ Load demo data (optional)

```bash
cd scripts
pnpm tsx demo-ecommerce/setup.ts
pnpm tsx demo-ecommerce/seed-base.ts
pnpm tsx demo-ecommerce/seed-signal.ts
```

登录 / Login: `admin@demo-ecommerce.local` / `demo2026`

---

## 文档 / Documentation

| 文档 | English |
|------|---------|
| [快速开始](docs/guide/getting-started.md) | [Getting Started](docs/guide/getting-started.en.md) |
| [架构设计](docs/guide/architecture.md) | [Architecture](docs/guide/architecture.en.md) |
| [数据接入](docs/guide/data-ingestion.md) | [Data Ingestion](docs/guide/data-ingestion.en.md) |
| [演示指南](docs/guide/demo.md) | [Demo Guide](docs/guide/demo.en.md) |
| [生产部署](docs/guide/deployment.md) | [Deployment](docs/guide/deployment.en.md) |
| [领域词汇表](CONTEXT.md) | [Domain Glossary](CONTEXT.md) |
| [架构决策记录](docs/adr/) | [Architecture Decision Records](docs/adr/) |

---

## 技术栈 / Tech Stack

- **Backend**: NestJS, Prisma, PostgreSQL
- **Frontend**: Next.js, React Query, shadcn/ui
- **AI**: DeepSeek LLM（OpenAI-compatible API）
- **Monorepo**: pnpm workspaces + Turborepo

---

## 许可证 / License

[MIT](LICENSE)
