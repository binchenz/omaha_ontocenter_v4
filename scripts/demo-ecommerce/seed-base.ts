/**
 * demo-ecommerce: seed-base
 *
 * Generates base-layer data with plausible random distributions.
 * Story planting happens in seed-signal.ts — this file is pure noise.
 *
 * Volumes (per README):
 *   - 200 products (5 categories)
 *   - 5,000 customers (8 cities, 4 tiers)
 *   - 20,000 orders (past 30 days)
 *   - 60,000 order items (avg 3 per order)
 *   - 8,000 reviews (~40% of orders)
 *
 * Deterministic: uses a seeded PRNG so re-runs produce identical data.
 *
 * Usage:
 *   cd scripts && pnpm tsx demo-ecommerce/seed-base.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { PrismaClient } from '@omaha/db';
import { ViewManagerService } from '../../apps/core-api/src/modules/ontology/view-manager.service';
import { CATEGORIES, CITIES, TIERS, ecommerceOntology } from './ontology';
import { rng, makeHelpers, WEEKDAYS } from './rand';

const TENANT_SLUG = 'demo-ecommerce';

const rand = rng(42);
const { randInt, randFloat, round2, pickWeighted } = makeHelpers(rand);

async function main() {
  const prisma = new PrismaClient();
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: TENANT_SLUG } });
  const tenantId = tenant.id;

  console.log('[seed-base] clearing existing instances…');
  for (const t of ecommerceOntology.objectTypes) {
    await prisma.objectInstance.deleteMany({ where: { tenantId, objectType: t.name } });
  }

  // --- PRODUCTS ------------------------------------------------------------
  console.log('[seed-base] generating products…');
  const products: Array<{ id: string; externalId: string; sku: string; name: string; category: string; price: number }> = [];
  let productCounter = 1;
  for (const cat of CATEGORIES) {
    for (let i = 0; i < cat.productCount; i++) {
      const sku = `SKU-${String(productCounter).padStart(4, '0')}`;
      const price = round2(randFloat(cat.priceMin, cat.priceMax));
      const name = `${cat.name}-${sku.slice(-4)}`;
      const listedAt = new Date(2026, 3, randInt(1, 30)).toISOString();
      const inst = await prisma.objectInstance.create({
        data: {
          tenantId,
          objectType: 'product',
          externalId: sku,
          label: name,
          properties: { sku, name, category: cat.name, price, listedAt },
          relationships: {},
          searchText: `${sku} ${name} ${cat.name}`,
        },
      });
      products.push({ id: inst.id, externalId: sku, sku, name, category: cat.name, price });
      productCounter++;
    }
  }
  console.log(`[seed-base]   ${products.length} products`);

  // --- CUSTOMERS ----------------------------------------------------------
  console.log('[seed-base] generating customers…');
  const customers: Array<{ id: string; externalId: string; tier: string; city: string; nickname: string }> = [];
  for (let i = 1; i <= 5000; i++) {
    const city = pickWeighted(CITIES).name;
    const tier = pickWeighted(TIERS).name;
    const externalId = `C-${String(i).padStart(5, '0')}`;
    const nickname = `客户${i}`;
    const registeredAt = new Date(2025 + randInt(0, 1), randInt(0, 11), randInt(1, 28)).toISOString();
    const inst = await prisma.objectInstance.create({
      data: {
        tenantId,
        objectType: 'customer',
        externalId,
        label: nickname,
        properties: { externalId, nickname, city, tier, registeredAt },
        relationships: {},
        searchText: `${externalId} ${nickname} ${city} ${tier}`,
      },
    });
    customers.push({ id: inst.id, externalId, tier, city, nickname });
    if (i % 500 === 0) console.log(`[seed-base]     ${i}/5000`);
  }
  console.log(`[seed-base]   ${customers.length} customers`);

  // --- ORDERS + ORDER ITEMS + REVIEWS -------------------------------------
  console.log('[seed-base] generating orders, items, reviews…');
  // 30 days ending today
  const daysBack = 30;
  const now = Date.now();

  const orderCountTarget = 20000;
  let orderCounter = 1;
  let itemCounter = 1;
  let reviewCounter = 1;

  // Pre-group products by category to avoid repeated full-array scans
  const productsByCategory = new Map<string, typeof products>();
  for (const cat of CATEGORIES) {
    productsByCategory.set(cat.name, products.filter(p => p.category === cat.name));
  }

  // Precompute customer → monthly order count using tier mean
  const tierMean = new Map(TIERS.map(t => [t.name, t.monthlyOrderMean]));
  const customerOrderCounts: Array<{ c: typeof customers[0]; n: number }> = customers
    .map(c => ({ c, n: Math.max(0, Math.round(rand() * tierMean.get(c.tier)! * 2)) }));

  // Normalize to hit target total
  const totalRaw = customerOrderCounts.reduce((s, x) => s + x.n, 0);
  const scale = orderCountTarget / totalRaw;
  customerOrderCounts.forEach(x => { x.n = Math.round(x.n * scale); });

  for (const { c, n } of customerOrderCounts) {
    for (let i = 0; i < n; i++) {
      const dayOffset = randInt(0, daysBack - 1);
      const orderTime = new Date(now - dayOffset * 86400000 + randInt(0, 86400) * 1000);
      const weekday = WEEKDAYS[orderTime.getDay() === 0 ? 6 : orderTime.getDay() - 1];

      // Determine category distribution for this order based on weekday signal
      const isWeekend = weekday === '周六' || weekday === '周日';

      // Pick 1-5 items for this order
      const itemCount = Math.min(5, Math.max(1, Math.round(randFloat(1, 4))));
      const pickedItems: Array<{ product: typeof products[0]; quantity: number }> = [];
      const usedProductIds = new Set<string>();
      for (let k = 0; k < itemCount; k++) {
        const catWeights = CATEGORIES.map(cat => isWeekend ? cat.weekendBoost : 1 / cat.weekendBoost);
        let r = rand() * catWeights.reduce((s, w) => s + w, 0);
        let catIdx = 0;
        for (; catIdx < catWeights.length - 1; catIdx++) {
          if ((r -= catWeights[catIdx]) <= 0) break;
        }
        const catName = CATEGORIES[catIdx].name;
        const catProducts = productsByCategory.get(catName)!;
        const candidates = catProducts.filter(p => !usedProductIds.has(p.id));
        if (candidates.length === 0) continue;
        const product = candidates[randInt(0, candidates.length - 1)];
        usedProductIds.add(product.id);
        const quantity = randInt(1, 3);
        pickedItems.push({ product, quantity });
      }

      if (pickedItems.length === 0) continue;

      const totalAmount = round2(
        pickedItems.reduce((s, x) => s + x.product.price * x.quantity, 0),
      );
      const orderNo = `O-${String(orderCounter).padStart(6, '0')}`;
      const orderDate = orderTime.toISOString();
      const status = rand() < 0.05 ? 'refunded' : rand() < 0.2 ? 'shipped' : 'paid';

      const order = await prisma.objectInstance.create({
        data: {
          tenantId,
          objectType: 'order',
          externalId: orderNo,
          label: orderNo,
          properties: { orderNo, orderDate, weekday, totalAmount, status },
          relationships: { customer_orders: c.id },
          searchText: `${orderNo} ${c.nickname}`,
        },
      });

      for (const item of pickedItems) {
        const subtotal = round2(item.product.price * item.quantity);
        const itemNo = `OI-${String(itemCounter++).padStart(7, '0')}`;
        await prisma.objectInstance.create({
          data: {
            tenantId,
            objectType: 'orderItem',
            externalId: itemNo,
            label: itemNo,
            properties: {
              quantity: item.quantity,
              unitPrice: item.product.price,
              subtotal,
              category: item.product.category,
            },
            relationships: {
              order_items: order.id,
              orderItem_product: item.product.id,
            },
          },
        });
      }

      // Review: ~40% chance
      if (rand() < 0.4 && status !== 'refunded') {
        const cat = CATEGORIES.find(c => c.name === pickedItems[0].product.category)!;
        const ratingRaw = cat.baseRatingMean + randFloat(-0.8, 0.8);
        const rating = Math.max(1, Math.min(5, Math.round(ratingRaw)));
        const reviewNo = `R-${String(reviewCounter++).padStart(6, '0')}`;
        const reviewedAt = new Date(orderTime.getTime() + randInt(1, 7) * 86400000).toISOString();
        await prisma.objectInstance.create({
          data: {
            tenantId,
            objectType: 'review',
            externalId: reviewNo,
            label: reviewNo,
            properties: { rating, reviewedAt, hasImage: rand() < 0.3 },
            relationships: { order_review: order.id },
          },
        });
      }

      orderCounter++;
      if (orderCounter % 2000 === 0) console.log(`[seed-base]     ${orderCounter} orders`);
    }
  }

  console.log(`[seed-base]   ${orderCounter - 1} orders, ${itemCounter - 1} items, ${reviewCounter - 1} reviews`);

  // Refresh all materialized views so queries hit them
  console.log('[seed-base] refreshing materialized views…');
  const viewManager = new ViewManagerService(prisma as any);
  for (const t of ecommerceOntology.objectTypes) {
    await viewManager.refresh(tenantId, t.name);
  }

  console.log('[seed-base] done.');
  await prisma.$disconnect();
}

main().catch(err => {
  console.error('[seed-base] failed:', err);
  process.exit(1);
});
