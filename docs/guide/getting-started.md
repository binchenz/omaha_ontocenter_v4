# 快速开始

## 前置条件

- Node.js 20+
- pnpm 9+（`npm install -g pnpm`）
- Docker（用于本地 Postgres）
- DeepSeek API key（[申请地址](https://platform.deepseek.com)）

## 步骤

### 1. 克隆仓库

```bash
git clone https://github.com/binchenz/omaha_ontocenter_v4.git
cd omaha_ontocenter_v4
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

打开 `.env`，至少填写以下必填项：

| 变量 | 说明 |
|------|------|
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 |
| `JWT_SECRET` | 任意随机字符串（开发环境可保持默认） |
| `CONNECTOR_ENCRYPTION_KEY` | 必须恰好 32 个字符（开发环境可保持默认） |

### 3. 启动数据库

```bash
docker-compose up -d
```

Postgres 会在 `localhost:5434` 启动。

### 4. 初始化项目

```bash
pnpm setup
```

这条命令依次执行：

1. `pnpm install` — 安装所有依赖
2. `pnpm db:generate` — 生成 Prisma client
3. `pnpm db:migrate` — 运行数据库迁移
4. `pnpm db:seed` — 写入初始数据（默认管理员账号）

### 5. 启动开发服务器

```bash
pnpm dev
```

| 服务 | 地址 |
|------|------|
| 前端 | http://localhost:3000 |
| API | http://localhost:3001 |

### 6. 加载演示数据（可选）

```bash
cd scripts
pnpm tsx demo-ecommerce/setup.ts    # 创建租户 + 本体结构
pnpm tsx demo-ecommerce/seed-base.ts  # 生成 2 万条订单（约 2 分钟）
pnpm tsx demo-ecommerce/seed-signal.ts  # 叠加演示故事数据
```

登录地址：http://localhost:3000/login  
账号：`admin@demo-ecommerce.local` / 密码：`demo2026`

## 常见问题

**数据库连接失败**：确认 `docker-compose up -d` 已运行，且 `.env` 中 `DATABASE_URL` 端口为 `5434`（docker-compose 映射的端口）。

**pnpm setup 失败**：先确认 Node.js 版本 ≥ 20（`node -v`）。

**Agent 不响应**：检查 `.env` 中 `DEEPSEEK_API_KEY` 是否正确填写。
