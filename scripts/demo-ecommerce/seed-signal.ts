/**
 * demo-ecommerce: seed-signal
 *
 * Plants 3 "stories" into the base data so demo questions have non-trivial answers.
 *
 * Story 1 (Q1 support): category sales ranking — base data already satisfies
 *   because 零食饮料 has cheapest products but highest-volume weekend purchases.
 *   No extra signal needed.
 *
 * Story 2 (Q2): 3 high-volume SKUs with low average rating.
 *   - Pick 3 cheap "cheap viral" products (充电线, 零食, 水杯)
 *   - Boost their order frequency
 *   - Pin their reviews to rating 1-3
 *
 * Story 3 (Q3): weekend amplification.
 *   - Already seeded via CategoryConfig.weekendBoost.
 *   - Additionally boost weekend orders count by +60% and lower their average AOV.
 *
 * Must run AFTER seed-base.ts.
 *
 * Usage:
 *   cd scripts && pnpm tsx demo-ecommerce/seed-signal.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { PrismaClient } from '@omaha/db';
import { ViewManagerService } from '../../apps/core-api/src/modules/ontology/view-manager.service';
import { ecommerceOntology } from './ontology';
import { rng, makeHelpers, WEEKDAYS } from './rand';

const TENANT_SLUG = 'demo-ecommerce';

const rand = rng(99);
const { randInt, round2 } = makeHelpers(rand);

async function main() {
  const prisma = new PrismaClient();
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: TENANT_SLUG } });
  const tenantId = tenant.id;

  // ---------------------------------------------------------------
  // Story 2: three "cheap viral" SKUs with low ratings
  // ---------------------------------------------------------------
  console.log('[seed-signal] planting Story 2: cheap viral low-rated products…');

  const allProducts = await prisma.objectInstance.findMany({
    where: { tenantId, objectType: 'product' },
  });

  // Pick 3 specific SKUs from different categories to mark as viral-but-bad
  const viralCandidates = [
    { category: '数码配件', priceTarget: 99,  namePrefix: '网红充电线', ratingMax: 3 },
    { category: '零食饮料', priceTarget: 49,  namePrefix: '爆款网红零食', ratingMax: 3 },
    { category: '运动户外', priceTarget: 129, namePrefix: '爆款运动水杯', ratingMax: 3 },
  ];

  const viralProducts: Array<{ id: string; sku: string; category: string; priceTarget: number; ratingMax: number }> = [];
  for (const cand of viralCandidates) {
    const match = allProducts.find(p => {
      const props = p.properties as any;
      return props.category === cand.category;
    });
    if (!match) continue;

    // Rename this product to be identifiable
    const props = match.properties as any;
    const newName = `${cand.namePrefix}(${props.sku})`;
    await prisma.objectInstance.update({
      where: { id: match.id },
      data: {
        label: newName,
        properties: { ...props, name: newName, price: cand.priceTarget },
        searchText: `${props.sku} ${newName} ${cand.category}`,
      },
    });
    viralProducts.push({
      id: match.id,
      sku: props.sku,
      category: cand.category,
      priceTarget: cand.priceTarget,
      ratingMax: cand.ratingMax,
    });
    console.log(`[seed-signal]   ${cand.namePrefix} → ${props.sku}`);
  }

  // Now inject many extra orders featuring these viral products with low ratings
  console.log('[seed-signal]   injecting high-volume orders for viral SKUs…');

  // Find any customer to pin these orders to (distribute across many)
  const customers = await prisma.objectInstance.findMany({
    where: { tenantId, objectType: 'customer' },
    select: { id: true, externalId: true, label: true, properties: true },
  });

  // Find the next order number to avoid collisions
  const existingOrders = await prisma.objectInstance.count({
    where: { tenantId, objectType: 'order' },
  });
  let orderCounter = existingOrders + 1;
  let itemCounter = await prisma.objectInstance.count({
    where: { tenantId, objectType: 'orderItem' },
  }) + 1;
  let reviewCounter = await prisma.objectInstance.count({
    where: { tenantId, objectType: 'review' },
  }) + 1;

  const now = Date.now();
  // Inject 300 extra orders per viral product — 900 total. This pushes them into top-20 by sales.
  for (const viral of viralProducts) {
    for (let i = 0; i < 300; i++) {
      const c = customers[randInt(0, customers.length - 1)];
      const dayOffset = randInt(0, 29);
      const orderTime = new Date(now - dayOffset * 86400000 + randInt(0, 86400) * 1000);
      const weekday = WEEKDAYS[orderTime.getDay() === 0 ? 6 : orderTime.getDay() - 1];
      const quantity = randInt(1, 2);
      const subtotal = round2(viral.priceTarget * quantity);
      const orderNo = `O-${String(orderCounter++).padStart(6, '0')}`;
      const status = 'paid';

      const order = await prisma.objectInstance.create({
        data: {
          tenantId,
          objectType: 'order',
          externalId: orderNo,
          label: orderNo,
          properties: {
            orderNo,
            orderDate: orderTime.toISOString(),
            weekday,
            totalAmount: subtotal,
            status,
          },
          relationships: { customer_orders: c.id },
        },
      });

      const itemNo = `OI-${String(itemCounter++).padStart(7, '0')}`;
      await prisma.objectInstance.create({
        data: {
          tenantId,
          objectType: 'orderItem',
          externalId: itemNo,
          label: itemNo,
          properties: {
            quantity,
            unitPrice: viral.priceTarget,
            subtotal,
            category: viral.category,
          },
          relationships: {
            order_items: order.id,
            orderItem_product: viral.id,
          },
        },
      });

      // Always attach a low review (1-3 stars) — this is the signal
      const reviewNo = `R-${String(reviewCounter++).padStart(6, '0')}`;
      const rating = randInt(1, viral.ratingMax);
      await prisma.objectInstance.create({
        data: {
          tenantId,
          objectType: 'review',
          externalId: reviewNo,
          label: reviewNo,
          properties: {
            rating,
            reviewedAt: new Date(orderTime.getTime() + 3 * 86400000).toISOString(),
            hasImage: rand() < 0.15,
          },
          relationships: { order_review: order.id },
        },
      });
    }
  }
  console.log(`[seed-signal]   injected ${viralProducts.length * 300} viral orders`);

  // ---------------------------------------------------------------
  // Story 3: weekend amplification (boost weekend orders ~60%, lower AOV)
  // ---------------------------------------------------------------
  console.log('[seed-signal] planting Story 3: weekend amplification…');

  // Strategy: inject extra weekend-only orders with lower AOV products (零食, 家居)
  const cheapPool = allProducts.filter(p => {
    const props = p.properties as any;
    return (props.category === '零食饮料' || props.category === '家居日用') && props.price < 100;
  });

  // Inject 2000 weekend orders, averaging ~60 yuan AOV
  let weekendInjected = 0;
  for (let i = 0; i < 2000; i++) {
    // Pick a day 0-29 back, then snap to weekend if weekday
    const dayOffset = randInt(0, 29);
    const base = new Date(now - dayOffset * 86400000);
    const day = base.getDay(); // 0=Sun, 6=Sat
    if (day !== 0 && day !== 6) {
      // snap to nearest weekend day
      const toSat = day <= 6 ? 6 - day : 0;
      base.setDate(base.getDate() + toSat);
    }
    base.setHours(randInt(10, 22), randInt(0, 59), 0, 0);
    const weekday = WEEKDAYS[base.getDay() === 0 ? 6 : base.getDay() - 1];

    const c = customers[randInt(0, customers.length - 1)];
    const picks = 1 + Math.floor(rand() * 2); // 1-2 items
    const chosen: typeof cheapPool = [];
    const used = new Set<string>();
    for (let k = 0; k < picks; k++) {
      let p;
      let tries = 0;
      do { p = cheapPool[randInt(0, cheapPool.length - 1)]; tries++; } while (used.has(p.id) && tries < 5);
      used.add(p.id);
      chosen.push(p);
    }

    const total = round2(chosen.reduce((s, p) => s + (p.properties as any).price, 0));
    const orderNo = `O-${String(orderCounter++).padStart(6, '0')}`;

    const order = await prisma.objectInstance.create({
      data: {
        tenantId,
        objectType: 'order',
        externalId: orderNo,
        label: orderNo,
        properties: {
          orderNo,
          orderDate: base.toISOString(),
          weekday,
          totalAmount: total,
          status: 'paid',
        },
        relationships: { customer_orders: c.id },
      },
    });

    for (const p of chosen) {
      const props = p.properties as any;
      const itemNo = `OI-${String(itemCounter++).padStart(7, '0')}`;
      await prisma.objectInstance.create({
        data: {
          tenantId,
          objectType: 'orderItem',
          externalId: itemNo,
          label: itemNo,
          properties: {
            quantity: 1,
            unitPrice: props.price,
            subtotal: props.price,
            category: props.category,
          },
          relationships: {
            order_items: order.id,
            orderItem_product: p.id,
          },
        },
      });
    }
    weekendInjected++;
  }
  console.log(`[seed-signal]   injected ${weekendInjected} extra weekend orders`);

  // ---------------------------------------------------------------
  // Refresh views
  // ---------------------------------------------------------------
  console.log('[seed-signal] refreshing materialized views…');
  const viewManager = new ViewManagerService(prisma as any);
  for (const t of ecommerceOntology.objectTypes) {
    await viewManager.refresh(tenantId, t.name);
  }

  console.log('[seed-signal] done.');
  await prisma.$disconnect();
}

main().catch(err => {
  console.error('[seed-signal] failed:', err);
  process.exit(1);
});
