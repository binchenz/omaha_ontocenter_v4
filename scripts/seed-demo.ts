/**
 * seed:demo — minimal demo tenant
 *
 * Seeds a small, self-contained tenant for demos and smoke tests:
 *   - Ontology: Product (name, price, category) + Order (externalId, quantity,
 *     totalAmount, orderDate) with an Order→Product relationship.
 *   - Data: 5 electronics products + 10 orders spread across products over the
 *     last 30 days.
 *
 * Uses the IngestRecipe pattern (scripts/lib/run-recipe.ts): source rows are
 * staged into ctx.sourceData up-front, then each recipe maps rows to instances
 * and the shared importer writes them. Orders link to products via parentRef,
 * which resolves the product externalId to its platform id and writes
 * relationships.belongsTo automatically.
 *
 * Deterministic and idempotent — re-running upserts the same tenant/ontology
 * and re-imports the same externalIds (update-in-place, no duplicates).
 *
 * Usage (from repo root):
 *   pnpm seed:demo
 *
 * Note: requires a reachable database (DATABASE_URL in .env). This script is
 * not run as part of CI.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { PrismaClient } from '@omaha/db';
import type { OntologySpec } from './lib/ontology-bootstrap';
import { bootstrapOntology } from './lib/ontology-bootstrap';
import { bootstrapTenant } from './lib/tenant-bootstrap';
import { createIngestCtx } from './lib/ingest-ctx';
import { importInstances } from './lib/object-instance-importer';
import { runRecipe, tallyResults, hasErrors, type IngestRecipe } from './lib/run-recipe';
import { ViewManagerService } from '../apps/core-api/src/modules/ontology/view-manager.service';

const TENANT_SLUG = 'demo';
const ADMIN_EMAIL = 'admin@demo.local';
const DEFAULT_PASSWORD = 'demo2026';

// ---------------------------------------------------------------------------
// Ontology
// ---------------------------------------------------------------------------

const demoOntology: OntologySpec = {
  objectTypes: [
    {
      name: 'product',
      label: 'Product',
      properties: [
        { name: 'name', type: 'string', label: 'Name', required: true, filterable: true },
        { name: 'price', type: 'number', label: 'Price', required: true, filterable: true, sortable: true },
        { name: 'category', type: 'string', label: 'Category', required: true, filterable: true },
      ],
    },
    {
      name: 'order',
      label: 'Order',
      properties: [
        { name: 'externalId', type: 'string', label: 'Order ID', required: true, filterable: true },
        { name: 'quantity', type: 'number', label: 'Quantity', required: true, filterable: true, sortable: true },
        { name: 'totalAmount', type: 'number', label: 'Total Amount', required: true, filterable: true, sortable: true },
        { name: 'orderDate', type: 'date', label: 'Order Date', required: true, filterable: true, sortable: true },
      ],
    },
  ],
  relationships: [
    { sourceType: 'order', targetType: 'product', name: 'product', cardinality: 'many-to-many' },
  ],
};

// ---------------------------------------------------------------------------
// Source data — staged into ctx.sourceData, then read by the recipes.
// ---------------------------------------------------------------------------

interface ProductRow {
  externalId: string;
  name: string;
  category: string;
  price: number;
}

interface OrderRow {
  externalId: string;
  productExternalId: string;
  quantity: number;
  totalAmount: number;
  orderDate: string;
}

const PRODUCTS: ProductRow[] = [
  { externalId: 'P-001', name: 'Laptop', category: 'electronics', price: 1299.0 },
  { externalId: 'P-002', name: 'Phone', category: 'electronics', price: 899.0 },
  { externalId: 'P-003', name: 'Headphones', category: 'electronics', price: 199.0 },
  { externalId: 'P-004', name: 'Tablet', category: 'electronics', price: 649.0 },
  { externalId: 'P-005', name: 'Watch', category: 'electronics', price: 399.0 },
];

const PRODUCT_PRICE = new Map(PRODUCTS.map((p) => [p.externalId, p.price]));

// 10 orders spread across the 5 products over the last 30 days. Deterministic:
// each order names its product, quantity, and a day offset back from "now".
function buildOrders(): OrderRow[] {
  const specs: Array<{ product: string; quantity: number; daysAgo: number }> = [
    { product: 'P-001', quantity: 1, daysAgo: 28 },
    { product: 'P-002', quantity: 2, daysAgo: 25 },
    { product: 'P-003', quantity: 3, daysAgo: 21 },
    { product: 'P-004', quantity: 1, daysAgo: 18 },
    { product: 'P-005', quantity: 2, daysAgo: 14 },
    { product: 'P-001', quantity: 1, daysAgo: 11 },
    { product: 'P-003', quantity: 1, daysAgo: 8 },
    { product: 'P-002', quantity: 1, daysAgo: 5 },
    { product: 'P-005', quantity: 4, daysAgo: 3 },
    { product: 'P-004', quantity: 2, daysAgo: 1 },
  ];

  const now = Date.now();
  return specs.map((s, i) => {
    const orderDate = new Date(now - s.daysAgo * 86400000).toISOString();
    const price = PRODUCT_PRICE.get(s.product) ?? 0;
    return {
      externalId: `O-${String(i + 1).padStart(3, '0')}`,
      productExternalId: s.product,
      quantity: s.quantity,
      totalAmount: Number((price * s.quantity).toFixed(2)),
      orderDate,
    };
  });
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

const productRecipe: IngestRecipe<ProductRow> = {
  objectType: 'product',
  read: (ctx) => (ctx.sourceData['product'] ?? []) as ProductRow[],
  toInstance: (row) => ({
    externalId: row.externalId,
    label: row.name,
    properties: { name: row.name, price: row.price, category: row.category },
    searchText: `${row.name} ${row.category}`,
  }),
};

const orderRecipe: IngestRecipe<OrderRow> = {
  objectType: 'order',
  read: (ctx) => (ctx.sourceData['order'] ?? []) as OrderRow[],
  // parentRef resolves productExternalId → product platform id and writes
  // relationships.belongsTo on each order instance.
  parentRef: { objectType: 'product', sourceField: 'productExternalId' },
  toInstance: (row) => ({
    externalId: row.externalId,
    label: row.externalId,
    properties: {
      externalId: row.externalId,
      quantity: row.quantity,
      totalAmount: row.totalAmount,
      orderDate: row.orderDate,
    },
  }),
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const prisma = new PrismaClient();

  console.log('[seed:demo] bootstrapping tenant…');
  const tenant = await bootstrapTenant({
    prisma,
    slug: TENANT_SLUG,
    name: 'Demo',
    adminEmail: ADMIN_EMAIL,
    generatePassword: () => DEFAULT_PASSWORD,
  });
  console.log(`[seed:demo]   tenantId=${tenant.tenantId}`);
  if (tenant.adminCreated) {
    console.log(`[seed:demo]   admin created: ${tenant.adminEmail} / ${tenant.initialPassword}`);
  } else {
    console.log(`[seed:demo]   admin already exists: ${tenant.adminEmail} (password unchanged)`);
  }

  console.log('[seed:demo] bootstrapping ontology…');
  const ont = await bootstrapOntology(prisma, tenant.tenantId, demoOntology);
  console.log(
    `[seed:demo]   types created=${ont.typesCreated} updated=${ont.typesUpdated} relationships=${ont.relationshipsCreated}`,
  );

  console.log('[seed:demo] creating materialized views…');
  const viewManager = new ViewManagerService(prisma as any);
  for (const t of demoOntology.objectTypes) {
    await viewManager.createOrReplace(tenant.tenantId, t.name, t.properties);
  }

  // Stage source data, then run recipes. Products must import before orders so
  // the orderRecipe's parentRef can resolve product platform ids.
  const orders = buildOrders();
  const ctx = createIngestCtx(prisma, tenant.tenantId, null, {
    product: PRODUCTS,
    order: orders,
  });

  console.log('[seed:demo] importing instances…');
  const productResult = await runRecipe(productRecipe, ctx, importInstances);
  const orderResult = await runRecipe(orderRecipe, ctx, importInstances);

  const tally = tallyResults([productResult, orderResult]);
  console.log(
    `[seed:demo]   imported=${tally.imported} updated=${tally.updated} skipped=${tally.skipped} errors=${tally.errors}`,
  );

  console.log('[seed:demo] refreshing materialized views…');
  for (const t of demoOntology.objectTypes) {
    await viewManager.refresh(tenant.tenantId, t.name);
  }

  await prisma.$disconnect();

  if (hasErrors(tally)) {
    console.error('[seed:demo] completed with row-level errors — see warnings above.');
    process.exit(1);
  }

  console.log(`[seed:demo] done. tenant slug: ${TENANT_SLUG}`);
  console.log(`[seed:demo] login: ${ADMIN_EMAIL} / ${DEFAULT_PASSWORD}`);
  console.log(`[seed:demo] seeded ${PRODUCTS.length} products + ${orders.length} orders`);
}

main().catch((err) => {
  console.error('[seed:demo] failed:', err);
  process.exit(1);
});
