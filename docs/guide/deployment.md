# 生产部署

## 前置条件

- Linux 服务器（2 vCPU / 4 GB RAM 起步）
- PostgreSQL 16+（可用云数据库服务）
- Node.js 20+，pnpm 9+
- Nginx（反向代理）
- DeepSeek 生产 API key

## 步骤

> ⚠️ **构建顺序至关重要：先配置 `NEXT_PUBLIC_API_URL`，再 `pnpm build`。**
> `NEXT_PUBLIC_*` 是 Next.js 的**构建期**变量——它在 `next build` 时被**内联进浏览器 JS bundle**，运行时再设置（`.env`、PM2 `env`）对已构建的前端**无效**。
> 若构建时未设置，前端会固化默认值 `http://localhost:3001`，导致用户浏览器去连**自己机器**的 3001 端口而非服务器后端，表现为登录报 `Invalid credentials` / 接口全部失败（即便后端、账号、密码都正确）。

### 1. 部署代码

```bash
cd /opt
git clone https://github.com/binchenz/omaha_ontocenter_v4.git
cd omaha_ontocenter_v4
pnpm install --frozen-lockfile
```

### 2. 配置环境变量（必须在 build 之前）

```bash
cp .env.example .env
```

**必须设置的变量：**

```bash
DATABASE_URL=postgresql://<user>:<password>@<host>:5432/ontocenter
# 前端浏览器访问后端的地址。构建期固化，必须是终端用户浏览器可达的地址
# （公网域名或服务器 IP，绝不能是 localhost——除非所有用户都走 SSH 隧道）
NEXT_PUBLIC_API_URL=https://<your-domain>/api
```

### 3. 构建（在 NEXT_PUBLIC_API_URL 已导出的前提下）

```bash
# 确保 NEXT_PUBLIC_API_URL 已在环境中（来自 .env 或显式 export）
export NEXT_PUBLIC_API_URL=https://<your-domain>/api
pnpm build
```

> **Next.js standalone 静态资源**：`output: 'standalone'` 构建**不会**把 `.next/static` 和 `public/` 自动放进 standalone 目录，必须手动拷贝，否则页面丢失 CSS/JS：
> ```bash
> cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static
> [ -d apps/web/public ] && cp -r apps/web/public apps/web/.next/standalone/apps/web/public
> ```

> **重新构建前端时**（例如改了 API 地址）：重复步骤 3（含静态资源拷贝），再 `pm2 restart omaha-web`。验证：
> ```bash
> # 0 个才算干净；若 >0 说明旧地址仍残留
> grep -rl "localhost:3001" apps/web/.next/standalone/apps/web/.next/static | wc -l
> ```

**密钥（可选）：** `JWT_SECRET`、`CONNECTOR_ENCRYPTION_KEY`、`DEEPSEEK_API_KEY` 默认由 Setup 向导首次启动时生成/收集并存入数据库，无需在 `.env` 设置。

仅在以下情况显式设置：
- 多副本部署需要所有实例共用同一 `JWT_SECRET`（`openssl rand -hex 32`）
- 需要跨重新部署固定 `CONNECTOR_ENCRYPTION_KEY`（更改后已存连接器密码无法解密）

```bash
# 仅多副本/固定密钥场景需要
JWT_SECRET=<openssl rand -hex 32>
CONNECTOR_ENCRYPTION_KEY=<openssl rand -hex 16>
```

**调试开关（可选，默认关闭）：**
- `LLM_DEBUG=1` — 把每轮完整 messages + tools + 原始响应落盘到 `.llm-debug/*.json`（事后逐字分析）。
- `EXPOSE_SYSTEM_PROMPT=1` — 把拼好的 system prompt 通过 SSE 推给前端 chat「提示词」标签页（实时看喂给 LLM 的上下文）。**生产默认关闭**：该提示词含租户身份注入与内部编排纪律，不应对每个登录用户外泄（见 ADR-0024 修订）。仅联调时开启。

### 4. 初始化数据库

```bash
pnpm db:generate
pnpm db:migrate:deploy
```

数据库迁移完成后保持为空，由 Setup 向导首次访问时初始化（创建组织、管理员、密钥）。

### 5. 启动服务（PM2）

```bash
npm install -g pm2

# 启动 core-api
pm2 start "node apps/core-api/dist/main.js" --name ontocenter-api

# 启动 web（Next.js standalone）
pm2 start "node apps/web/.next/standalone/server.js" \
  --name ontocenter-web \
  --env PORT=3000

pm2 save
pm2 startup
```

### 6. Nginx 反向代理

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    # 前端
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
    }

    # API（含 SSE 流式输出）
    location /api/ {
        proxy_pass http://localhost:3001/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        # SSE 必须关闭缓冲
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }
}
```

> **注意**：`proxy_buffering off` 对 Agent 的 SSE 流式输出至关重要，否则用户看不到实时响应。

### 6. 冒烟测试

```bash
# 健康检查
curl https://your-domain.com/api/health
```

首次访问 https://your-domain.com 会自动跳转到 Setup 向导，在浏览器里完成初始化（填入 API key、创建管理员账号）。向导完成后即可正常登录。

## 更新部署

```bash
cd /opt/omaha_ontocenter_v4
git pull
pnpm install --frozen-lockfile
pnpm build
pnpm db:migrate:deploy
pm2 restart all
```

## 上线前检查清单

- [ ] `DATABASE_URL` 指向生产数据库
- [ ] `NEXT_PUBLIC_API_URL` 设置为公开域名
- [ ] HTTPS 证书已配置
- [ ] Nginx `proxy_buffering off` 已设置（SSE 流式输出必须）
- [ ] 数据库已制定备份策略
- [ ] PM2 开机自启已配置（`pm2 startup`）
- [ ] 首次访问后完成 Setup 向导（API key + 管理员账号）
