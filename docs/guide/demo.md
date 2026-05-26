# 演示指南

## 准备工作

加载电商演示数据集（约 3–5 分钟）：

```bash
cd scripts
pnpm tsx demo-ecommerce/setup.ts
pnpm tsx demo-ecommerce/seed-base.ts
pnpm tsx demo-ecommerce/seed-signal.ts
```

登录地址：http://localhost:3000/login  
账号：`admin@demo-ecommerce.local` / 密码：`demo2026`

## 5 分钟演示剧本

### 0:00–0:30 — 开场

1. 登录，进入 `/ontology` 页面，快速展示 5 个对象类型和关系。
2. 说："这是一个电商客户配置好的数据模型。2 万条订单，5000 个客户。接下来我用自然语言问几个问题。"

### 0:30–1:30 — Q1：品类排行

**问：** "本月卖得最好的三个品类分别是什么？销售额多少？"

**预期答案：**

| 品类 | 销售额 |
|------|--------|
| 美妆护肤 | 最高 |
| 数码配件 | 第二 |
| 运动户外 | 第三 |

**秀点：** "不需要数据工程师写 SQL，几秒出结果。"

### 1:30–2:30 — Q2：销量 TOP20 vs 评分

**问：** "把销售额 TOP20 的商品和它们的平均评分拉出来看。"

**预期：** TOP20 里出现 3 款"网红产品"评分低于 3：
- 网红充电线
- 爆款网红零食
- 爆款运动水杯

**秀点：** "一个问题跨了 3 张表（商品 / 订单行 / 评价）。洞察：卖得好不等于口碑好，这 3 款是潜在退货雷区。"

### 2:30–3:30 — Q3：周末 vs 工作日

**问：** "周末订单比工作日多多少？客单价有差别吗？"

**预期：**
- 周末日均订单量比工作日高 40–60%
- 周末客单价比工作日低 15–25%

**秀点：** "Agent 记住了上下文。洞察：周末是量大客小的流量，推荐该时段推促销，不推高客单。"

### 3:30–5:00 — 客户自问 + 收尾

说："您最关心业务哪个问题？随便问。"

让客户当场问一个真正关心的问题。前 3.5 分钟证明"平台能做这些"，最后 1.5 分钟证明"平台能做任何你想问的"。

**常见 follow-up：**

| 问题 | 平台能否答 |
|------|-----------|
| "按城市看高价值客户分布" | ✓ |
| "过去 7 天订单趋势" | ✓ |
| "哪些商品退货率最高" | ⚠️（可做，需要关系遍历） |
| "把这份 Excel 导入" | ✓（触发数据接入 Skill） |

如果客户卡壳，主动提示："要不要看看派生属性？可以现场定义'高价值客户 = 月消费 1000+ 的人'，然后按这个标签继续分析。"

## 数据特征（调试用）

运行 `pnpm tsx demo-ecommerce/verify.ts` 确认：

- **规模**：200 个商品 / 5000 个客户 / 约 20900 个订单 / 约 61000 个订单行 / 约 8900 条评价
- **Q1 故事**：零食饮料销量最多但客单价最低
- **Q2 故事**：TOP20 里 ≥ 2 款评分 < 3.5 的网红商品
- **Q3 故事**：周末日均订单 lift ≥ 40%，周末客单价比工作日低 ≥ 15%

如果 verify 输出不满足上述条件，重新跑 `seed-signal.ts`。

## 清理

```sql
-- 快速重置（保留租户，清数据）
DELETE FROM object_instances WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'demo-ecommerce');

-- 完全删除（慎用）
DELETE FROM object_types WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'demo-ecommerce');
DELETE FROM users WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'demo-ecommerce');
DELETE FROM tenants WHERE slug = 'demo-ecommerce';
```
