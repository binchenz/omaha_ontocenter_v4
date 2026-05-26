# Data Ingestion

## Demo Dataset

The `scripts/demo-ecommerce/` directory contains a self-contained e-commerce dataset for local development and demos.

```bash
cd scripts
pnpm tsx demo-ecommerce/setup.ts       # create tenant + ontology (idempotent)
pnpm tsx demo-ecommerce/seed-base.ts   # ~20k orders, ~2 min
pnpm tsx demo-ecommerce/seed-signal.ts # overlay demo story signals
pnpm tsx demo-ecommerce/verify.ts      # confirm data matches expected shape
```

Expected data after seeding: 200 products / 5,000 customers / ~20,900 orders / ~61,000 order items / ~8,900 reviews.

## IngestRecipe Pattern

For integrating your own data source, use the `IngestRecipe` pattern in `scripts/lib/`.

### Concepts

- **IngestRecipe** — a declarative per-ObjectType ingest spec: how to read source rows, map them to ObjectInstances, and resolve relationships.
- **IngestCtx** — context passed through every recipe run: Prisma client, tenant ID, source reader, and caches for external ID maps and entity resolution pools.
- **runRecipe** — the runner that executes a recipe: reads rows, resolves parent references, calls your `toInstance` mapper, and bulk-imports via `ObjectInstanceImporter`.

### Minimal example

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

### Parent references

Use `parentRef` to resolve a foreign key to a platform ID automatically:

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

The runner looks up `order_id` in the pre-loaded external ID map for `order` and writes `relationships.belongsTo` automatically.

## Connector-based Sync

For ongoing sync from an external database, use the Connector + Mapping system via the Agent UI:

1. Open the chat and say "connect to my database"
2. The Agent guides you through creating a Connector (host, port, credentials)
3. Define a Mapping between your source table and an ObjectType
4. Trigger a sync — the Agent calls `import_data` which runs a full or incremental sync

See [ADR-0006](../adr/0006-sync-model.md) for the full/incremental sync model.
