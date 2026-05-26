# 数据接入

## 演示数据集

`scripts/demo-ecommerce/` 目录包含一个自包含的电商数据集，用于本地开发和演示。

```bash
cd scripts
pnpm tsx demo-ecommerce/setup.ts       # 创建租户 + 本体结构（幂等）
pnpm tsx demo-ecommerce/seed-base.ts   # 生成约 2 万条订单，约 2 分钟
pnpm tsx demo-ecommerce/seed-signal.ts # 叠加演示故事信号
pnpm tsx demo-ecommerce/verify.ts      # 验证数据符合预期
```

seed 完成后预期数据量：200 个商品 / 5000 个客户 / 约 20900 个订单 / 约 61000 个订单行 / 约 8900 条评价。

## IngestRecipe 模式

如需接入自己的数据源，使用 `scripts/lib/` 中的 IngestRecipe 模式。

### 核心概念

- **IngestRecipe** — 声明式的单对象类型接入规格：如何读取源数据行、映射为 ObjectInstance、解析关系。
- **IngestCtx** — 贯穿整个 recipe 执行过程的上下文：Prisma client、租户 ID、数据源 reader、外部 ID 映射缓存和实体解析池。
- **runRecipe** — 执行器：读取数据行、解析父级引用、调用 `toInstance` 映射函数、批量导入。

### 最小示例

```typescript
import { PrismaClient } from '@omaha/db';
import { createIngestCtx } from './lib/ingest-ctx';
import { runRecipe, IngestRecipe } from './lib/run-recipe';
import { objectInstanceImporter } from './lib/object-instance-importer';

interface ProductRow { id: number; name: string; price: number; }

const productRecipe: IngestRecipe<ProductRow> = {
  objectType: 'product',
  read: (ctx) => ctx.sourceData['products'] as ProductRow[],
  toInstance: (row) => ({
    externalId: String(row.id),
    label: row.name,
    properties: { name: row.name, price: row.price },
  }),
};

const prisma = new PrismaClient();
const ctx = createIngestCtx(prisma, 'your-tenant-id', null, {
  products: await fetchProductsFromYourSource(),
});

await runRecipe(productRecipe, ctx, objectInstanceImporter);
```

### 父级引用

使用 `parentRef` 自动将外键解析为平台 ID：

```typescript
const orderItemRecipe: IngestRecipe<ItemRow> = {
  objectType: 'order_item',
  read: (ctx) => ctx.sourceData['items'] as ItemRow[],
  parentRef: { objectType: 'order', sourceField: 'order_id' },
  toInstance: (row) => ({
    externalId: String(row.id),
    label: `Item ${row.id}`,
    properties: { quantity: row.qty, unitPrice: row.price },
  }),
};
```

执行器会自动在 `order` 的外部 ID 映射表中查找 `order_id`，并将 `relationships.belongsTo` 写入实例。

## Connector 持续同步

如需从外部数据库持续同步，通过 Agent 界面使用 Connector + Mapping 体系：

1. 打开聊天，说"连接我的数据库"
2. Agent 引导你创建 Connector（主机、端口、凭据）
3. 定义 Mapping，将源表字段映射到 ObjectType 属性
4. 触发同步 — Agent 调用 `import_data` 工具执行全量或增量同步

同步模型详见 [ADR-0006](../adr/0006-sync-model.md)。
