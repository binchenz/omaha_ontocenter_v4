# Demo: E-commerce Operations

5 分钟闪电 demo 用的数据集 + 运行手册。目标客户：传统企业管理层（零售/电商运营）。

## 快速开始

```bash
cd scripts

# 1. 创建租户 + ontology + 物化视图（幂等）
pnpm tsx demo-ecommerce/setup.ts

# 2. 生成基础数据（20k 订单，约 2 分钟）
pnpm tsx demo-ecommerce/seed-base.ts

# 3. 叠加演示信号（约 1 分钟）
pnpm tsx demo-ecommerce/seed-signal.ts

# 4. 校验演示数据符合预期（几秒）
pnpm tsx demo-ecommerce/verify.ts
```

全程大约 3-5 分钟。

## 登录

- **URL**: http://localhost:3004/login
- **账号**: `admin@demo-ecommerce.local`
- **密码**: `demo2026`
- **租户**: `demo-ecommerce`

## 5 分钟 Demo 剧本

### 0:00–0:30  开场

1. 登录，进入 `/ontology` 页面，快速展示 5 个对象类型和关系
2. 说："这是一个电商客户配置好的数据模型。20000 个订单，5000 个客户。接下来我用自然语言问几个问题。"

### 0:30–1:30  Q1  品类排行

**问：** "本月卖得最好的三个品类分别是什么？销售额多少？"

**预期答案：**
| 品类 | 销售额（元） |
|------|------|
| 美妆护肤 | 最高 |
| 数码配件 | 第二 |
| 运动户外 | 第三 |

**秀点：**
- 几秒钟出结果
- 底层有 6 万订单行做聚合
- 说："不需要数据工程师写 SQL"

### 1:30–2:30  Q2  销量 TOP20 vs 评分

**问：** "把销售额 TOP20 的商品和它们的平均评分拉出来看"

**预期答案：** TOP20 里会出现 3 个"网红产品"：
- 网红充电线 — 评分 < 3
- 爆款网红零食 — 评分 < 3
- 爆款运动水杯 — 评分 < 3

**秀点：**
- 一个问题跨了 3 张表（商品 / 订单行 / 评价）
- 洞察："卖得好不等于口碑好。这 3 款是潜在退货雷区。"
- 说："这种跨对象分析在 Excel / 传统 BI 里要麻烦很多。"

### 2:30–3:30  Q3  周末 vs 工作日

**问：** "周末订单比工作日多多少？客单价有差别吗？"

**预期答案：**
- 周末日均订单量比工作日高 **40-60%**
- 周末客单价比工作日低 **15-25%**

**秀点：**
- 同一个会话，Agent 记住了上下文
- 洞察："周末是量大客小的流量，推荐该时段推促销，不推高客单"
- 说："您看，Agent 能识别这种业务模式，而不只是返回数字。"

### 3:30–5:00  客户自问 + 收尾

**开场白：** "您最关心业务哪个问题？随便问。"

让客户当场问一个他真正关心的问题。这是 demo 的关键时刻——前 3.5 分钟证明了"平台能做这些"，最后 1.5 分钟证明"平台能做任何你想问的"。

**常见的 follow-up 问题及预期：**

| 问题 | 平台能否答 |
|------|-----------|
| "按城市看高价值客户分布" | ✓ (groupBy city + filter by tier) |
| "过去 7 天订单趋势" | ✓ (filter by orderDate range + groupBy weekday) |
| "哪些商品退货率最高" | ⚠️ (status=refunded 的订单 + 商品，可做但需要关系遍历) |
| "把这份 Excel 导入" | ✓ (演示 data-ingestion skill) |

如果客户卡壳，主动提示："要不要看看我们的派生属性？可以现场定义 '高价值客户 = 月消费 1000+ 的人'，然后按这个标签继续分析。"

## 数据特征（调试用）

运行 `verify.ts` 后应看到：

- **规模**：200 products / 5000 customers / ~20900 orders / ~61000 items / ~8900 reviews
- **Q1 故事**：零食饮料销量最多但客单价最低
- **Q2 故事**：TOP20 里 ≥ 2 款评分 < 3.5 的网红商品
- **Q3 故事**：周末日均订单 lift ≥ 40%，周末 AOV 比工作日低 ≥ 15%

如果 verify 输出不满足上述条件，重新跑 seed-signal.ts。

## 文件说明

- `ontology.ts` — 对象类型 + 关系 + 品类/城市/等级配置
- `setup.ts` — 创建租户 + ontology + 视图（幂等）
- `seed-base.ts` — 生成基础数据（deterministic PRNG seed=42）
- `seed-signal.ts` — 叠加 3 个 demo 故事（seed=99）
- `verify.ts` — 运行 demo 问题的 raw SQL，确认答案正确

## 清理

```sql
-- 快速重置（保留租户，清数据）
DELETE FROM object_instances WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'demo-ecommerce');

-- 完全删除（慎用）
DELETE FROM object_types WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'demo-ecommerce');
DELETE FROM users WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'demo-ecommerce');
DELETE FROM tenants WHERE slug = 'demo-ecommerce';
```
