# 生产部署

## 前置条件

- Linux 服务器（2 vCPU / 4 GB RAM 起步）
- PostgreSQL 16+（可用云数据库服务）
- Node.js 20+，pnpm 9+
- Nginx（反向代理）
- DeepSeek 生产 API key

## 步骤

### 1. 部署代码

```bash
cd /opt
git clone https://github.com/binchenz/omaha_ontocenter_v4.git
cd omaha_ontocenter_v4
pnpm install --frozen-lockfile
pnpm build
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

**必须设置的变量：**

```bash
DATABASE_URL=postgresql://<user>:<password>@<host>:5432/ontocenter
NEXT_PUBLIC_API_URL=https://<your-domain>/api
```

**密钥（可选）：** `JWT_SECRET`、`CONNECTOR_ENCRYPTION_KEY`、`DEEPSEEK_API_KEY` 默认由 Setup 向导首次启动时生成/收集并存入数据库，无需在 `.env` 设置。

仅在以下情况显式设置：
- 多副本部署需要所有实例共用同一 `JWT_SECRET`（`openssl rand -hex 32`）
- 需要跨重新部署固定 `CONNECTOR_ENCRYPTION_KEY`（更改后已存连接器密码无法解密）

```bash
# 仅多副本/固定密钥场景需要
JWT_SECRET=<openssl rand -hex 32>
CONNECTOR_ENCRYPTION_KEY=<openssl rand -hex 16>
```

### 3. 初始化数据库

```bash
pnpm db:generate
pnpm db:migrate:deploy
```

数据库迁移完成后保持为空，由 Setup 向导首次访问时初始化（创建组织、管理员、密钥）。

### 4. 启动服务（PM2）

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

### 5. Nginx 反向代理

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
