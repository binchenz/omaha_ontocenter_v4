/**
 * demo-ecommerce: verify
 *
 * Runs the 3 demo questions as raw SQL and prints results so we can confirm
 * each "story" shows up before the live demo.
 *
 * Expected signals:
 *   Q1: 零食饮料 has highest order count, 美妆护肤 has highest revenue,
 *       家居日用 has lowest AOV — ranked list should feel natural
 *   Q2: top-20 by revenue includes at least one SKU whose average rating < 3.5
 *       (ideally 3 of them: 网红充电线, 爆款网红零食, 爆款运动水杯)
 *   Q3: weekend order count ≥ 1.4x weekday count per day,
 *       weekend AOV < weekday AOV by ≥ 15%
 *
 * Usage:
 *   cd scripts && pnpm tsx demo-ecommerce/verify.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { PrismaClient } from '@omaha/db';

const TENANT_SLUG = 'demo-ecommerce';

async function main() {
  const prisma = new PrismaClient();
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: TENANT_SLUG } });
  const tenantId = tenant.id;

  console.log('\n=== Q1: Category sales ranking ===');
  const q1 = await prisma.$queryRawUnsafe<any[]>(`
    SELECT
      oi.properties->>'category' AS category,
      count(DISTINCT o.id)::int AS order_count,
      sum((oi.properties->>'subtotal')::numeric)::numeric(12,2) AS revenue,
      avg((o.properties->>'totalAmount')::numeric)::numeric(12,2) AS avg_order_value
    FROM object_instances oi
    JOIN object_instances o ON o.id = (oi.relationships->>'order_items')::uuid
    WHERE oi.tenant_id = $1::uuid AND oi.object_type = 'orderItem'
      AND o.tenant_id = $1::uuid AND o.object_type = 'order'
      AND o.deleted_at IS NULL AND oi.deleted_at IS NULL
    GROUP BY oi.properties->>'category'
    ORDER BY revenue DESC
  `, tenantId);
  console.table(q1.map(r => ({
    category: r.category,
    orders: Number(r.order_count),
    revenue: Number(r.revenue),
    avg_order_value: Number(r.avg_order_value),
  })));

  console.log('\n=== Q2: Top-20 products by revenue vs their average rating ===');
  const q2 = await prisma.$queryRawUnsafe<any[]>(`
    WITH product_sales AS (
      SELECT
        p.id AS product_id,
        p.properties->>'name' AS name,
        p.properties->>'category' AS category,
        sum((oi.properties->>'subtotal')::numeric) AS revenue,
        count(oi.id)::int AS order_lines
      FROM object_instances p
      JOIN object_instances oi ON (oi.relationships->>'orderItem_product')::uuid = p.id
      WHERE p.tenant_id = $1::uuid AND p.object_type = 'product'
        AND oi.tenant_id = $1::uuid AND oi.object_type = 'orderItem'
        AND p.deleted_at IS NULL AND oi.deleted_at IS NULL
      GROUP BY p.id, p.properties->>'name', p.properties->>'category'
    ),
    product_ratings AS (
      SELECT
        p.id AS product_id,
        avg((r.properties->>'rating')::numeric) AS avg_rating,
        count(r.id)::int AS review_count
      FROM object_instances p
      JOIN object_instances oi ON (oi.relationships->>'orderItem_product')::uuid = p.id
      JOIN object_instances o  ON (oi.relationships->>'order_items')::uuid = o.id
      JOIN object_instances r  ON (r.relationships->>'order_review')::uuid = o.id
      WHERE p.tenant_id = $1::uuid AND p.object_type = 'product'
        AND r.tenant_id = $1::uuid AND r.object_type = 'review'
      GROUP BY p.id
    )
    SELECT
      ps.name,
      ps.category,
      ps.revenue::numeric(12,2) AS revenue,
      ps.order_lines,
      round(COALESCE(pr.avg_rating, 0)::numeric, 2) AS avg_rating,
      COALESCE(pr.review_count, 0) AS review_count
    FROM product_sales ps
    LEFT JOIN product_ratings pr USING (product_id)
    ORDER BY ps.revenue DESC
    LIMIT 20
  `, tenantId);
  console.table(q2.map(r => ({
    name: r.name,
    category: r.category,
    revenue: Number(r.revenue),
    orders: Number(r.order_lines),
    avg_rating: Number(r.avg_rating),
    reviews: Number(r.review_count),
  })));

  const lowRated = q2.filter(r => Number(r.avg_rating) > 0 && Number(r.avg_rating) < 3.5);
  console.log(`\n→ Top-20 products with avg rating < 3.5: ${lowRated.length}`);
  lowRated.forEach(r => console.log(`   - ${r.name} (rating ${Number(r.avg_rating)})`));

  console.log('\n=== Q3: Weekday vs weekend order pattern ===');
  const q3 = await prisma.$queryRawUnsafe<any[]>(`
    SELECT
      CASE WHEN properties->>'weekday' IN ('周六', '周日') THEN '周末' ELSE '工作日' END AS day_type,
      count(*)::int AS order_count,
      avg((properties->>'totalAmount')::numeric)::numeric(10,2) AS avg_order_value,
      sum((properties->>'totalAmount')::numeric)::numeric(12,2) AS total_revenue
    FROM object_instances
    WHERE tenant_id = $1::uuid AND object_type = 'order' AND deleted_at IS NULL
    GROUP BY day_type
    ORDER BY day_type
  `, tenantId);
  console.table(q3.map(r => ({
    day_type: r.day_type,
    orders: Number(r.order_count),
    avg_order_value: Number(r.avg_order_value),
    revenue: Number(r.total_revenue),
  })));

  // Days-per-period ratio (weekend = 2/7, weekday = 5/7 of days)
  const weekend = q3.find(r => r.day_type === '周末');
  const weekday = q3.find(r => r.day_type === '工作日');
  if (weekend && weekday) {
    const weekendDailyOrders = Number(weekend.order_count) / (30 * 2 / 7);
    const weekdayDailyOrders = Number(weekday.order_count) / (30 * 5 / 7);
    const lift = ((weekendDailyOrders - weekdayDailyOrders) / weekdayDailyOrders) * 100;
    const aovDiff = ((Number(weekend.avg_order_value) - Number(weekday.avg_order_value)) / Number(weekday.avg_order_value)) * 100;
    console.log(`\n→ Weekend daily order lift: ${lift.toFixed(1)}%`);
    console.log(`→ Weekend AOV diff vs weekday: ${aovDiff.toFixed(1)}%`);
  }

  console.log('\n=== Total volumes ===');
  for (const t of ['product', 'customer', 'order', 'orderItem', 'review']) {
    const n = await prisma.objectInstance.count({
      where: { tenantId, objectType: t, deletedAt: null },
    });
    console.log(`  ${t}: ${n}`);
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('[verify] failed:', err);
  process.exit(1);
});
