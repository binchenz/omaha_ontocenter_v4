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

**必须修改的变量（★ 生产环境不能使用默认值）：**

```bash
DATABASE_URL=postgresql://<user>:<password>@<host>:5432/ontocenter
JWT_SECRET=<openssl rand -hex 32>
CONNECTOR_ENCRYPTION_KEY=<openssl rand -hex 16>   # 必须恰好 32 字符
DEEPSEEK_API_KEY=<生产 API key>
NEXT_PUBLIC_API_URL=https://<your-domain>/api
```

### 3. 初始化数据库

```bash
pnpm db:generate
pnpm --filter @omaha/db prisma migrate deploy
pnpm db:seed
```

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

# 登录
curl -X POST https://your-domain.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@system.local","password":"<seed 中设置的密码>"}'
```

## 重置管理员密码

```bash
cd /opt/omaha_ontocenter_v4
node -e "
const bcrypt = require('bcrypt');
bcrypt.hash('new-password', 10).then(h => console.log(h));
" | xargs -I{} pnpm --filter @omaha/db prisma db execute \
  --stdin <<< "UPDATE users SET password_hash='{}' WHERE email='admin@system.local';"
```

## 更新部署

```bash
cd /opt/omaha_ontocenter_v4
git pull
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @omaha/db prisma migrate deploy
pm2 restart all
```

## 上线前检查清单

- [ ] `JWT_SECRET` 已更换为随机值
- [ ] `CONNECTOR_ENCRYPTION_KEY` 已更换为随机值
- [ ] `DEEPSEEK_API_KEY` 使用生产密钥
- [ ] HTTPS 证书已配置
- [ ] Nginx `proxy_buffering off` 已设置
- [ ] 数据库已备份策略
- [ ] PM2 开机自启已配置（`pm2 startup`）
