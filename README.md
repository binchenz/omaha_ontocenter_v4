# OmahA OntoCenter

**基于本体论的智能数据平台** — 通过自然语言对话查询、管理和集成企业业务数据。

An ontology-driven data platform where business users query, manage, and integrate enterprise data through natural language conversation.

---

## 核心能力 / Key Features

- **自然语言查询** — 用对话方式查询业务数据，无需 SQL。Ask questions in plain language, no SQL required.
- **动态本体建模** — 运行时定义对象类型、属性和关系，无需改表结构。Define object types, properties, and relationships at runtime without schema migrations.
- **语义层** — 自动推断字段的业务含义和度量单位，让 AI 理解"慢的订单"指的是耗时而非距离。Semantic annotations (description + unit) auto-inferred during modeling, enabling the AI to disambiguate natural language.
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
```

> DeepSeek API key 不必现在填 —— 首次启动的 Setup 向导里会引导你填入并测试连接。
> No need to set the DeepSeek API key now — the first-run Setup Wizard will guide you through entering and testing it.

### 2. 启动数据库 / Start database

```bash
docker-compose up -d
```

### 3. 一键初始化 / One-command setup

```bash
pnpm setup
```

这条命令会依次执行：安装依赖 → 生成 Prisma client → 运行数据库迁移。数据库此时为空。

This runs: install dependencies → generate Prisma client → run migrations. The database starts empty.

### 4. 启动应用 / Start the app

```bash
pnpm dev
```

- 前端 / Frontend: http://localhost:3000
- API: http://localhost:3001

### 5. 首次访问：Setup 向导 / First visit: Setup Wizard

打开 http://localhost:3000 ，因为数据库为空，会自动跳转到 `/setup` 向导：

1. 填入 DeepSeek API key 并测试连接
2. 创建你的组织、管理员邮箱和密码

向导完成后即可用刚创建的管理员账号登录，并开始接入你自己的数据。

Open http://localhost:3000 — since the database is empty, you'll be redirected to the `/setup` wizard:

1. Enter your DeepSeek API key and test the connection
2. Create your organization, admin email, and password

After the wizard completes, log in with the admin account you just created and start ingesting your own data.

---

## 快速体验 / Quick Demo

Setup 向导完成后数据库是空的。运行 seed 脚本创建 5 个 Product + 10 个 Order，立刻可以体验自然语言查询：

After the Setup Wizard, the database is empty. Run the seed script to create 5 Products + 10 Orders so you can try natural-language queries immediately:

```bash
pnpm seed:demo
```

试试这些查询 / Example queries to try:

- "哪个产品卖得最好" / "Which product sells best"
- "上周的订单总额" / "Last week's order total"
- "最贵的产品是什么" / "What's the most expensive product"
- "每个产品的订单数量" / "Order count per product"

---

## 接入你自己的数据 / Connect Your Data

平台支持多种数据源接入方式。基本流程：上传文件 → 自动推断 Schema → 确认字段映射 → 同步数据。目前支持的 Connector 类型：CSV、Excel、PostgreSQL、MySQL。

The platform supports multiple data source types. The basic workflow: upload a file → auto-infer schema → confirm field mappings → sync. Supported Connector types: CSV, Excel, PostgreSQL, MySQL.

**步骤 / Steps:**

1. 进入对话界面，告诉 Agent"我想导入数据"并上传 CSV/Excel 文件。
   Open the chat, tell the Agent "I want to import data" and upload a CSV/Excel file.

2. Agent 自动推断字段类型和本体映射建议，你可以逐一确认或修改。
   The Agent auto-infers column types and suggests ontology mappings — review and adjust as needed.

3. 确认映射后 Agent 执行同步，数据即刻可用于自然语言查询。
   After you confirm, the Agent syncs the data — it's immediately queryable via natural language.

> 也可以通过 Connector 配置直接连接 PostgreSQL/MySQL 数据库，Agent 会引导你完成全部步骤。
> You can also connect directly to a PostgreSQL/MySQL database via the Connector config — the Agent guides you through the entire flow.

---

## 更多演示数据 / Additional Demo Datasets

<details>
<summary>电商大数据集（200 产品 / 20,000 订单）/ Large e-commerce dataset</summary>

```bash
cd scripts
pnpm tsx demo-ecommerce/setup.ts
pnpm tsx demo-ecommerce/seed-base.ts
pnpm tsx demo-ecommerce/seed-signal.ts
```

登录 / Login: `admin@demo-ecommerce.local` / `demo2026`

</details>

<details>
<summary>短剧拉片分析 / Short Drama Shot Analysis</summary>

**路径①：确定性 e2e 基线**

```bash
cd scripts
pnpm tsx demo-drama/setup.ts
pnpm tsx demo-drama/seed.ts
```

**路径②：对话式接入 demo**（需 `pnpm dev` 运行中）

```bash
cd scripts
pnpm tsx demo-drama/stage-to-pg.ts
pnpm tsx demo-drama/demo-ingestion.ts
```

登录 / Login: `admin@demo-drama.local` / `demo2026`

</details>

---

## 文档 / Documentation

| 文档 | English |
|------|---------|
| [快速开始](docs/guide/getting-started.md) | [Getting Started](docs/guide/getting-started.en.md) |
| [架构设计](docs/guide/architecture.md) | [Architecture](docs/guide/architecture.en.md) |
| [数据接入](docs/guide/data-ingestion.md) | [Data Ingestion](docs/guide/data-ingestion.en.md) |
| [演示指南](docs/guide/demo.md) | [Demo Guide](docs/guide/demo.en.md) |
| [生产部署](docs/guide/deployment.md) | [Deployment](docs/guide/deployment.en.md) |
| [外部 Agent 集成](docs/integrations/ontocenter-skill/SKILL.md) | [Agent Integration](docs/adr/0021-mcp-server-external-agent-integration.md) |
| [领域词汇表](CONTEXT.md) | [Domain Glossary](CONTEXT.md) |
| [架构决策记录](docs/adr/) | [Architecture Decision Records](docs/adr/) |
| [贡献指南](CONTRIBUTING.md) | [Contributing](CONTRIBUTING.md) |

---

## 外部 Agent 集成 / Agent Integration

支持 Claude Code、Cursor、Codex 等外部 AI Agent 接入 OntoCenter 查询和管理数据。

External AI agents (Claude Code, Cursor, Codex) can integrate with OntoCenter to query and manage data.

### Claude Code Skill（即刻可用 / Ready to use）

```bash
cp -r docs/integrations/ontocenter-skill ~/.claude/skills/ontocenter
```

配置环境变量后即可在 Claude Code 中直接查询业务数据：

```bash
export ONTOCENTER_URL=http://localhost:3001
export ONTOCENTER_EMAIL=admin@demo.com
export ONTOCENTER_PASSWORD=admin123
export ONTOCENTER_TENANT=demo
```

### MCP Server（规划中 / Planned for v0.2.0）

标准 MCP 协议集成，支持 tool 自动发现和权限分层。详见 [ADR-0021](docs/adr/0021-mcp-server-external-agent-integration.md)。

---

## 技术栈 / Tech Stack

- **Backend**: NestJS, Prisma, PostgreSQL
- **Frontend**: Next.js, React Query, shadcn/ui
- **AI**: DeepSeek LLM（OpenAI-compatible API）
- **Monorepo**: pnpm workspaces + Turborepo

---

## 许可证 / License

[MIT](LICENSE)
