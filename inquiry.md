# PRD：Ontology-native 企业订单智能查询与动作平台

## 1. 文档信息

- **产品名称**：企业 Ontology + Action 智能数据平台
- **版本**：V1.0 MVP
- **目标客户**：中小型贸易、电商、本地生活、制造企业
- **核心场景**：订单、客户、支付、评价、库存、任务等业务对象的统一查询、分析与动作执行
- **产品定位**：不是 Text-to-SQL 工具，而是基于 Ontology Object 的企业业务对象查询与操作平台

---

# 2. 产品背景

中小企业通常存在以下问题：

- 数据分散在 ERP、CRM、订单系统、支付系统、Excel、客服系统、评价系统中。
- 老板和业务人员想问业务问题，但不知道数据在哪张表。
- 传统 BI 只能做固定报表，临时问题响应慢。
- Text-to-SQL 容易误解业务语义，例如“已付款”“最后一条评价”“杭州市订单”。
- AI 如果直接查库或改库，存在权限、准确性和安全风险。

因此，需要构建一个基于业务对象的智能平台，让用户通过自然语言或业务应用查询企业经营数据，并在受控条件下执行业务动作。

---

# 3. 产品目标

## 3.1 一句话目标

让企业用户能够用自然语言查询和操作业务对象，例如：

> 昨天晚上 19 点前杭州市的订单中，截止今天上午 11 点已经付款且最后一条评价为好评的订单，给我明细。

系统能够基于 Ontology 正确理解业务语义，返回准确明细，并支持后续动作，例如导出、创建跟进任务、通知负责人。

---

## 3.2 核心目标

- 支持业务对象建模，而不是直接暴露数据库表。
- 支持自然语言转换为对象查询计划。
- 支持复杂业务语义，例如时间切片、最后状态、派生属性。
- 支持对象级、字段级、行级、动作级权限。
- 支持 Action Preview 和用户确认执行。
- 支持审计，记录用户和 AI 的所有查询与动作。
- MVP 聚焦订单查询、支付状态、评价状态、客户信息和任务动作。

---

# 4. 用户角色

## 4.1 老板 / 管理层

关注：

- 经营概况
- 销售额
- 回款情况
- 订单风险
- 客户满意度
- 异常订单

典型问题：

- 昨天杭州已付款且好评订单有哪些？
- 最近 7 天差评订单集中在哪些区域？
- 哪些订单金额高但还没付款？
- 哪些客户最近投诉变多？

---

## 4.2 运营人员

关注：

- 订单明细
- 区域表现
- 支付状态
- 评价状态
- 异常跟进

典型问题：

- 今天 11 点前已付款但未发货的订单有哪些？
- 杭州地区最后评价为差评的订单有哪些？
- 昨晚 7 点前下单但还未支付的订单有哪些？

---

## 4.3 客服人员

关注：

- 客户订单
- 评价内容
- 投诉记录
- 跟进任务

典型问题：

- 找出最近差评订单，并创建客服回访任务。
- 查看这个客户最近 3 笔订单和评价。

---

## 4.4 管理员

关注：

- 数据源配置
- Ontology 建模
- 字段映射
- 权限配置
- 审计日志

典型任务：

- 配置订单数据源。
- 定义“好评”的业务规则。
- 定义“杭州市订单”的城市来源。
- 配置哪些角色能查看客户手机号。

---

# 5. MVP 范围

## 5.1 MVP 核心对象

第一版支持以下 Ontology Object：

```text
Order           订单
OrderItem       订单明细
Customer        客户
Payment         支付记录
Review          评价
Address         地址
Employee        员工
Task            任务
```

---

## 5.2 MVP 核心能力

| 模块 | 是否 MVP | 说明 |
|---|---:|---|
| 数据源接入 | 是 | 支持 CSV、Excel、MySQL、PostgreSQL |
| Ontology 建模 | 是 | 支持对象、字段、关系、派生属性 |
| Mapping 映射 | 是 | 支持底层字段映射到业务对象 |
| Object Query | 是 | 支持对象查询、过滤、排序、明细返回 |
| 自然语言查询 | 是 | NL → Object Query Plan |
| 权限控制 | 是 | 对象、字段、行、动作权限 |
| Action Engine | 是 | 支持预览、确认、执行 |
| 审计日志 | 是 | 查询、AI 工具调用、动作执行留痕 |
| 低代码应用 | 否 | 后续版本 |
| 复杂审批流 | 否 | 后续版本 |
| 图数据库 | 否 | MVP 先用 PostgreSQL |
| 实时流计算 | 否 | 后续版本 |

---

# 6. 核心用户故事

## 6.1 自然语言查询订单

作为运营人员，我希望输入：

> 昨天晚上 19 点前杭州市的订单中，截止今天上午 11 点已经付款且最后一条评价为好评的订单，给我明细。

系统能够返回符合条件的订单明细。

### 验收标准

- 系统正确解析“昨天晚上 19 点前”为具体时间。
- 系统正确解析“今天上午 11 点”为付款截止时间。
- 系统按 Ontology 中定义的城市字段筛选杭州订单。
- 系统判断付款状态时使用 `Payment.paidAt <= cutoffTime`。
- 系统判断最后一条评价时按评价时间取最新评价。
- 系统判断好评时使用已配置规则，例如 `rating >= 4`。
- 返回订单、客户、明细、付款、评价等字段。
- 查询结果必须经过权限过滤。
- 查询行为必须写入审计日志。

---

## 6.2 查看查询计划

作为高级用户，我希望看到系统是如何理解我的问题的，避免 AI 查错。

### 示例查询计划

```json
{
  "objectType": "Order",
  "filters": [
    {
      "field": "createdAt",
      "operator": "<",
      "value": "2025-01-14T19:00:00+08:00"
    },
    {
      "field": "fulfillmentCity",
      "operator": "=",
      "value": "杭州市"
    },
    {
      "derivedProperty": "isPaidAt",
      "operator": "=",
      "value": true,
      "params": {
        "cutoffTime": "2025-01-15T11:00:00+08:00"
      }
    },
    {
      "derivedProperty": "latestReviewIsPositive",
      "operator": "=",
      "value": true
    }
  ],
  "include": ["customer", "items", "payments", "latestReview"]
}
```

### 验收标准

- 用户可展开查看查询计划。
- 查询计划显示对象、字段、条件、时间解释和派生属性。
- 用户可确认后执行，也可修改条件。
- 查询计划不得展示底层敏感 SQL，除管理员调试模式外。

---

## 6.3 不确定语义时反问

作为用户，我希望当系统不确定业务语义时，不要乱猜。

### 示例

用户问：

> 杭州市订单有哪些？

如果系统没有配置“杭州市订单”的含义，应反问：

> “杭州市订单”是指收货地址在杭州、门店城市在杭州，还是履约城市在杭州？

### 验收标准

- 当 Ontology 中存在多个候选字段时，系统必须反问。
- 用户选择后，可保存为默认规则。
- 管理员可在 Ontology 中配置默认语义。
- 后续相同问题不再重复反问。

---

## 6.4 执行动作前预览

作为客服主管，我希望查询出好评或差评订单后，可以创建跟进任务，但必须先看到预览。

### 示例

用户问：

> 找出昨天杭州最后评价为差评的订单，并给客服创建回访任务。

系统流程：

1. 查询订单。
2. 返回结果。
3. 生成任务预览。
4. 用户确认。
5. 创建任务。
6. 记录审计。

### 验收标准

- AI 不能直接创建任务。
- 必须调用 Action Preview。
- 用户确认后才能执行。
- 任务创建结果可追踪。
- 所有动作写入审计日志。

---

# 7. 功能需求

# 7.1 数据源接入模块

## 功能描述

支持企业接入订单、支付、评价、客户等数据源。

## MVP 支持数据源

- Excel
- CSV
- MySQL
- PostgreSQL

## 功能点

- 新建数据源
- 测试连接
- 数据预览
- 字段识别
- 手动同步
- 定时同步
- 同步日志
- 同步失败重试

## 数据源配置示例

```json
{
  "name": "order_db",
  "type": "postgresql",
  "host": "127.0.0.1",
  "port": 5432,
  "database": "orders",
  "syncMode": "scheduled",
  "syncInterval": "*/30 * * * *"
}
```

## 验收标准

- 用户可以成功配置数据库连接。
- 用户可以预览表结构和前 100 行数据。
- 系统可以将数据同步到平台内部。
- 同步失败时有错误提示和日志。

---

# 7.2 Ontology Registry 模块

## 功能描述

管理业务对象定义，包括对象、属性、关系、派生属性和动作。

## MVP Object

### Order

```json
{
  "name": "Order",
  "label": "订单",
  "properties": [
    {
      "name": "orderNo",
      "label": "订单号",
      "type": "string"
    },
    {
      "name": "createdAt",
      "label": "下单时间",
      "type": "datetime"
    },
    {
      "name": "fulfillmentCity",
      "label": "履约城市",
      "type": "string"
    },
    {
      "name": "totalAmount",
      "label": "订单金额",
      "type": "decimal"
    },
    {
      "name": "status",
      "label": "订单状态",
      "type": "enum"
    }
  ],
  "relationships": [
    {
      "name": "customer",
      "target": "Customer",
      "cardinality": "many-to-one"
    },
    {
      "name": "items",
      "target": "OrderItem",
      "cardinality": "one-to-many"
    },
    {
      "name": "payments",
      "target": "Payment",
      "cardinality": "one-to-many"
    },
    {
      "name": "reviews",
      "target": "Review",
      "cardinality": "one-to-many"
    }
  ]
}
```

### Payment

```json
{
  "name": "Payment",
  "label": "支付记录",
  "properties": [
    {
      "name": "paidAt",
      "label": "支付时间",
      "type": "datetime"
    },
    {
      "name": "status",
      "label": "支付状态",
      "type": "enum",
      "values": ["Pending", "Success", "Failed", "Refunded"]
    },
    {
      "name": "amount",
      "label": "支付金额",
      "type": "decimal"
    }
  ]
}
```

### Review

```json
{
  "name": "Review",
  "label": "评价",
  "properties": [
    {
      "name": "createdAt",
      "label": "评价时间",
      "type": "datetime"
    },
    {
      "name": "rating",
      "label": "评分",
      "type": "number"
    },
    {
      "name": "sentiment",
      "label": "情感",
      "type": "enum",
      "values": ["Positive", "Neutral", "Negative"]
    },
    {
      "name": "content",
      "label": "评价内容",
      "type": "text"
    }
  ]
}
```

## 派生属性

### `Order.isPaidAt(cutoffTime)`

含义：

> 订单在指定截止时间前是否已经成功付款。

规则：

```text
exists Payment where status = 'Success' and paidAt <= cutoffTime
```

### `Order.latestReview`

含义：

> 当前订单最后一条评价。

规则：

```text
maxBy Review.createdAt
```

### `Order.latestReviewIsPositive`

含义：

> 最后一条评价是否为好评。

规则：

```text
latestReview.rating >= 4 OR latestReview.sentiment = 'Positive'
```

## 验收标准

- 管理员可以创建对象类型。
- 管理员可以配置字段类型。
- 管理员可以配置对象关系。
- 管理员可以配置派生属性规则。
- 系统可以基于派生属性执行查询。

---

# 7.3 Mapping Engine 模块

## 功能描述

把底层数据源字段映射为 Ontology Object 属性。

## 示例

底层订单表：

```text
t_order.id
t_order.order_no
t_order.create_time
t_order.city
t_order.amount
```

映射到：

```text
Order.id
Order.orderNo
Order.createdAt
Order.fulfillmentCity
Order.totalAmount
```

## Mapping 配置示例

```json
{
  "objectType": "Order",
  "source": {
    "connectorId": "conn_order_db",
    "table": "t_order"
  },
  "idMapping": "id",
  "propertyMappings": {
    "orderNo": "order_no",
    "createdAt": "create_time",
    "fulfillmentCity": "city",
    "totalAmount": "amount",
    "status": "order_status"
  },
  "relationshipMappings": {
    "customer": {
      "sourceField": "customer_id",
      "targetObjectType": "Customer",
      "targetField": "externalId"
    }
  }
}
```

## 功能点

- 字段映射
- 类型转换
- 枚举值映射
- 关系映射
- Mapping 测试
- 同步到对象实例表

## 验收标准

- 管理员可手动配置字段映射。
- 系统可自动推荐字段映射。
- 用户可预览映射结果。
- 错误映射会给出提示。
- 映射完成后可生成 `object_instances`。

---

# 7.4 Object Query 模块

## 功能描述

提供统一业务对象查询接口。

## 查询接口

```http
POST /api/objects/query
```

## 请求示例

```json
{
  "objectType": "Order",
  "filter": {
    "createdAt": {
      "lt": "2025-01-14T19:00:00+08:00"
    },
    "fulfillmentCity": {
      "eq": "杭州市"
    },
    "isPaidAt": {
      "eq": true,
      "params": {
        "cutoffTime": "2025-01-15T11:00:00+08:00"
      }
    },
    "latestReviewIsPositive": {
      "eq": true
    }
  },
  "include": ["customer", "items", "payments", "latestReview"],
  "select": [
    "orderNo",
    "createdAt",
    "fulfillmentCity",
    "totalAmount",
    "customer.name",
    "items.productName",
    "items.quantity",
    "payments.paidAt",
    "latestReview.rating",
    "latestReview.content"
  ],
  "limit": 100
}
```

## 返回示例

```json
{
  "data": [
    {
      "id": "O-001",
      "objectType": "Order",
      "label": "订单 O-001",
      "properties": {
        "orderNo": "O-001",
        "createdAt": "2025-01-14T18:30:00+08:00",
        "fulfillmentCity": "杭州市",
        "totalAmount": 258.5
      },
      "relationships": {
        "customer": {
          "id": "C-001",
          "name": "张三"
        },
        "items": [
          {
            "productName": "商品 A",
            "quantity": 2,
            "price": 99
          }
        ],
        "payments": [
          {
            "paidAt": "2025-01-15T10:20:00+08:00",
            "amount": 258.5,
            "status": "Success"
          }
        ],
        "latestReview": {
          "rating": 5,
          "sentiment": "Positive",
          "content": "体验很好",
          "createdAt": "2025-01-15T10:50:00+08:00"
        }
      }
    }
  ],
  "meta": {
    "total": 1,
    "limit": 100
  }
}
```

## 验收标准

- 支持对象字段过滤。
- 支持派生属性过滤。
- 支持关联对象 include。
- 支持字段选择。
- 支持分页和排序。
- 支持权限自动注入。
- 查询结果必须稳定可复现。

---

# 7.5 自然语言查询模块

## 功能描述

将用户自然语言转换为 Object Query Plan。

## 输入示例

```text
昨天晚上19点前杭州市的订单中，截止今天上午11点已经付款且最后一条评价为好评的订单，给我明细
```

## 解析结果

```json
{
  "intent": "query_object_details",
  "objectType": "Order",
  "timeInterpretation": {
    "yesterday_19": "2025-01-14T19:00:00+08:00",
    "today_11": "2025-01-15T11:00:00+08:00"
  },
  "filters": [
    {
      "field": "createdAt",
      "operator": "lt",
      "value": "2025-01-14T19:00:00+08:00"
    },
    {
      "field": "fulfillmentCity",
      "operator": "eq",
      "value": "杭州市"
    },
    {
      "derivedProperty": "isPaidAt",
      "operator": "eq",
      "value": true,
      "params": {
        "cutoffTime": "2025-01-15T11:00:00+08:00"
      }
    },
    {
      "derivedProperty": "latestReviewIsPositive",
      "operator": "eq",
      "value": true
    }
  ],
  "output": "details"
}
```

## 功能点

- 识别业务对象
- 识别时间条件
- 识别地点条件
- 识别状态条件
- 识别派生语义
- 生成查询计划
- 查询前语义确认
- 不确定时反问

## 验收标准

- 不允许直接生成 SQL 执行。
- 必须先生成 Object Query Plan。
- Query Plan 必须通过 Ontology 校验。
- 不存在的对象、字段、关系必须报错。
- 多义语义必须反问。
- 查询结果必须来自 Object Query API。

---

# 7.6 Action Engine 模块

## 功能描述

支持在对象上执行受控业务动作。

## MVP Action

```text
Order.exportDetails
Order.createReviewFollowUpTask
Order.markAsRisk
Customer.createFollowUpTask
Task.complete
```

## Action 示例

```json
{
  "name": "createReviewFollowUpTask",
  "label": "创建评价跟进任务",
  "objectType": "Order",
  "inputSchema": {
    "assigneeId": {
      "type": "string",
      "ref": "Employee",
      "label": "负责人"
    },
    "dueDate": {
      "type": "date",
      "label": "截止日期"
    },
    "note": {
      "type": "string",
      "label": "备注"
    }
  },
  "preconditions": [
    {
      "field": "latestReviewIsPositive",
      "operator": "=",
      "value": false
    }
  ],
  "permission": "order.create_review_followup_task",
  "requiresConfirmation": true,
  "riskLevel": "medium"
}
```

## Action 生命周期

```text
Discover → Validate → Authorize → Preview → Confirm → Execute → Audit
```

## 验收标准

- 用户可查看某个对象可用动作。
- 执行动作前必须预览。
- 高风险动作必须确认。
- 无权限用户不能执行动作。
- Action 执行结果必须写入审计。
- Action 失败必须返回明确错误。

---

# 7.7 权限模块

## 功能描述

统一控制用户可见、可查、可执行范围。

## 权限维度

- 对象级权限
- 字段级权限
- 行级权限
- 动作级权限
- AI 工具权限

## 示例规则

销售只能看自己负责客户的订单：

```json
{
  "role": "sales",
  "action": "object.read",
  "objectType": "Order",
  "condition": {
    "field": "salesOwnerId",
    "operator": "=",
    "value": "{{user.id}}"
  }
}
```

客服不能看客户手机号：

```json
{
  "role": "customer_service",
  "action": "field.read",
  "objectType": "Customer",
  "field": "phone",
  "effect": "mask"
}
```

## 验收标准

- 查询时自动注入行级权限。
- 返回结果时自动处理字段脱敏。
- AI 查询也必须经过权限系统。
- 用户不能通过自然语言绕过权限。
- 权限拒绝时给出清晰提示。

---

# 7.8 审计模块

## 功能描述

记录平台中的关键查询、AI 工具调用和业务动作。

## 审计内容

- 用户是谁
- 查询了什么对象
- 使用了什么过滤条件
- 查看了哪些敏感字段
- AI 调用了哪些工具
- 执行了什么动作
- 动作结果是什么

## 审计记录示例

```json
{
  "actorId": "U-001",
  "actorType": "user",
  "operation": "object.query",
  "objectType": "Order",
  "queryPlan": {},
  "resultCount": 28,
  "source": "ai_chat",
  "createdAt": "2025-01-15T11:30:00+08:00"
}
```

## 验收标准

- 所有自然语言查询写入审计。
- 所有 Object Query 写入审计。
- 所有 Action Preview 写入审计。
- 所有 Action Execute 写入审计。
- 管理员可以检索审计日志。

---

# 8. 页面设计

## 8.1 AI 查询页面

### 页面元素

- 自然语言输入框
- 查询计划预览
- 查询结果表格
- 明细抽屉
- 导出按钮
- 后续动作按钮
- 审计提示

### 用户流程

```text
输入问题
  ↓
系统解析
  ↓
展示查询计划
  ↓
用户确认 / 修改
  ↓
执行查询
  ↓
展示明细
  ↓
导出 / 创建任务 / 查看详情
```

---

## 8.2 Ontology 管理页面

### 页面元素

- 对象列表
- 对象详情
- 字段配置
- 关系配置
- 派生属性配置
- Action 配置
- 版本记录

---

## 8.3 Mapping 配置页面

### 页面元素

- 数据源选择
- 源表选择
- 字段预览
- 目标对象选择
- 字段映射表
- 关系映射
- 测试映射
- 同步按钮

---

## 8.4 查询结果页面

### 表格字段示例

针对示例查询，默认返回：

```text
订单号
下单时间
城市
订单金额
客户名称
商品明细
付款时间
付款金额
最后评价时间
最后评分
评价内容
订单状态
负责人
```

### 操作

- 查看订单详情
- 查看客户详情
- 查看评价详情
- 导出 Excel
- 创建跟进任务
- 复制查询链接

---

# 9. 示例查询完整链路

## 用户输入

```text
昨天晚上19点前杭州市的订单中，截止今天上午11点已经付款且最后一条评价为好评的订单，给我明细
```

## Step 1：AI 解析

识别：

```text
对象：Order
时间条件：createdAt < 昨天 19:00
地点条件：fulfillmentCity = 杭州市
付款条件：isPaidAt(today 11:00) = true
评价条件：latestReviewIsPositive = true
输出：明细
```

## Step 2：Ontology 校验

校验：

- `Order` 是否存在
- `createdAt` 是否存在
- `fulfillmentCity` 是否存在
- `isPaidAt` 是否已定义
- `latestReviewIsPositive` 是否已定义
- `items/payments/reviews/customer` 关系是否存在

## Step 3：权限注入

例如当前用户只能看杭州区域：

```json
{
  "field": "region",
  "operator": "in",
  "value": ["杭州"]
}
```

## Step 4：生成 Object Query Plan

```json
{
  "objectType": "Order",
  "filter": {
    "createdAt": {
      "lt": "2025-01-14T19:00:00+08:00"
    },
    "fulfillmentCity": {
      "eq": "杭州市"
    },
    "isPaidAt": {
      "eq": true,
      "params": {
        "cutoffTime": "2025-01-15T11:00:00+08:00"
      }
    },
    "latestReviewIsPositive": {
      "eq": true
    }
  },
  "include": ["customer", "items", "payments", "latestReview"],
  "limit": 100
}
```

## Step 5：执行查询

Object Query Engine 编译为底层查询计划。

底层可以是：

- PostgreSQL SQL
- Elasticsearch 查询
- API 聚合
- 多源查询
- 物化对象查询

## Step 6：返回结果

系统返回结构化明细，AI 只负责解释，不编造数据。

## Step 7：审计

记录：

- 原始问题
- 查询计划
- 执行时间
- 结果数量
- 用户 ID
- 权限过滤条件
- 是否导出

---

# 10. 非功能需求

## 10.1 性能

MVP 指标：

- 10 万订单内普通查询响应小于 3 秒。
- 100 万订单内复杂查询响应小于 10 秒。
- AI 解析时间小于 5 秒。
- 导出任务可异步执行。
- 单租户支持 50 并发查询。

---

## 10.2 安全

- 所有 API 必须鉴权。
- 所有查询必须带 `tenant_id`。
- 敏感字段支持脱敏。
- AI 不允许直接访问数据库。
- Action 执行前必须权限校验。
- 高风险动作必须二次确认。

---

## 10.3 可用性

- 核心查询服务可用性目标 99.5%。
- 同步任务失败可重试。
- 查询失败应返回明确错误。
- AI 解析失败时允许用户手动修改查询条件。

---

## 10.4 可扩展性

- 新增对象不需要改核心查询引擎。
- 新增字段不需要改前端代码。
- 新增 Action 可以通过配置注册。
- 新增数据源通过 Connector 扩展。

---

# 11. 数据模型概要

## 11.1 核心表

```text
tenants
users
roles
permissions
connectors
sync_jobs
ontology_object_types
ontology_relationships
ontology_mappings
object_instances
action_definitions
action_runs
audit_logs
ai_conversations
ai_tool_calls
```

---

## 11.2 object_instances

MVP 推荐用 PostgreSQL JSONB 物化对象。

```sql
CREATE TABLE object_instances (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  object_type TEXT NOT NULL,
  external_id TEXT NOT NULL,
  label TEXT,
  properties JSONB NOT NULL,
  relationships JSONB,
  source_ref JSONB,
  search_text TEXT,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  UNIQUE (tenant_id, object_type, external_id)
);
```

---

# 12. AI 规则

## 12.1 AI 允许做什么

- 理解用户问题
- 生成 Object Query Plan
- 调用 Object Query Tool
- 总结查询结果
- 调用 Action Preview Tool
- 在用户确认后调用 Action Execute Tool

## 12.2 AI 禁止做什么

- 禁止直接访问数据库。
- 禁止直接生成 SQL 执行。
- 禁止绕过权限。
- 禁止编造字段。
- 禁止编造查询结果。
- 禁止未经确认执行业务动作。

---

# 13. 成功指标

## 13.1 产品指标

- 自然语言查询成功率 ≥ 80%
- 查询结果用户确认准确率 ≥ 90%
- 常见业务问题平均响应时间减少 70%
- 用户每周主动查询次数 ≥ 20 次 / 企业
- 查询后动作转化率 ≥ 20%

## 13.2 技术指标

- Object Query API 成功率 ≥ 99%
- AI 工具调用成功率 ≥ 95%
- 权限拦截准确率 100%
- 审计覆盖率 100%
- 同步任务成功率 ≥ 95%

---

# 14. 版本规划

## V1.0 MVP

目标：跑通订单智能查询闭环。

包括：

- 数据源接入
- Ontology 定义
- Mapping
- Object Query
- 自然语言查询
- 权限
- 审计
- 查询结果导出
- 简单任务 Action

---

## V1.1

增强：

- 更多对象模板
- 指标引擎
- 查询计划可视化
- AI 自动推荐 Mapping
- 多轮追问
- 查询模板保存

---

## V1.2

增强：

- 复杂 Action
- 审批流
- 企业微信 / 飞书通知
- 行业模板
- 订单风险模型
- 评价情感分析

---

## V2.0

增强：

- 图关系查询
- 实时数据同步
- 工作流编排
- 高级权限策略
- 私有化部署
- 多行业应用市场

---

# 15. MVP 优先级

## P0 必须做

- 登录与租户
- 数据源接入
- Ontology Object 定义
- Mapping 配置
- Object Query API
- 派生属性：`isPaidAt`
- 派生属性：`latestReview`
- 派生属性：`latestReviewIsPositive`
- 自然语言生成 Query Plan
- 权限过滤
- 审计日志
- 查询结果表格

---

## P1 应该做

- 查询计划预览
- 导出 Excel
- 创建任务 Action
- 字段脱敏
- 多轮反问
- 查询模板保存

---

## P2 可以后做

- 图谱可视化
- 复杂审批流
- 实时同步
- 低代码页面
- 高级指标中心
- 复杂预测模型

---

# 16. 核心结论

这个产品的核心不是：

```text
自然语言 → SQL
```

而是：

```text
自然语言
  → 业务意图
  → Ontology 语义校验
  → Object Query Plan
  → 权限注入
  → 查询执行
  → 结果明细
  → Action Preview
  → 用户确认执行
  → 审计留痕
```

第一版应该聚焦订单场景，把这类复杂问题稳定跑通：

> 昨天晚上 19 点前杭州市的订单中，截止今天上午 11 点已经付款且最后一条评价为好评的订单，给我明细。

只要这个问题能被准确、可解释、可审计地查询出来，就已经具备了区别于普通 BI 和 Text-to-SQL 的核心产品雏形。