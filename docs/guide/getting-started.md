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

`.env` 开箱即可用于本地开发，无需手动填写任何密钥：

- `DEEPSEEK_API_KEY` — 首次启动的 Setup 向导会引导你填入并测试连接
- `JWT_SECRET`、`CONNECTOR_ENCRYPTION_KEY` — 留空即可，向导会自动生成随机值并存入数据库

只有在多副本部署需要固定密钥时，才需要在 `.env` 里显式设置（见 [生产部署](deployment.md)）。

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

完成后数据库为空，等待 Setup 向导初始化。

### 5. 启动开发服务器

```bash
pnpm dev
```

| 服务 | 地址 |
|------|------|
| 前端 | http://localhost:3000 |
| API | http://localhost:3001 |

### 6. 首次访问：Setup 向导

打开 http://localhost:3000 ，因为数据库为空，会自动跳转到 `/setup` 向导：

1. 填入 DeepSeek API key 并测试连接
2. 创建你的组织、管理员邮箱和密码

向导完成后，用刚创建的管理员账号登录，即可开始接入自己的数据。之后还能在 `设置 → 用户管理` 里添加更多用户。

### 7. 想先看 Demo？（可选）

如果你只想体验平台能力而不接入自己的数据，加载内置的电商演示租户：

```bash
pnpm setup:demo   # 等同 pnpm setup，额外加载 demo 租户
pnpm dev
```

登录地址：http://localhost:3000/login  
账号：`admin@demo.com` / 密码：`admin123`

> Demo 租户与 Setup 向导互斥：加载 demo 数据后平台视为已初始化，向导不再显示。两条路二选一。
>
> 更多演示数据集（电商订单、短剧拉片）见 [README](../../README.md#想先看-demo--want-to-see-a-demo-first)。

## 常见问题

**数据库连接失败**：确认 `docker-compose up -d` 已运行，且 `.env` 中 `DATABASE_URL` 端口为 `5434`（docker-compose 映射的端口）。

**pnpm setup 失败**：先确认 Node.js 版本 ≥ 20（`node -v`）。

**没有跳转到向导**：说明数据库里已有租户（可能跑过 `pnpm setup:demo` 或 `pnpm db:seed`）。向导只在全新空库时显示。

**Agent 不响应**：检查 Setup 向导里填写的 DeepSeek API key 是否有效；可在 `设置` 中重新测试。
