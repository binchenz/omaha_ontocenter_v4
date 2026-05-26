# Demo Guide

## Setup

Load the e-commerce demo dataset (takes ~3–5 minutes):

```bash
cd scripts
pnpm tsx demo-ecommerce/setup.ts
pnpm tsx demo-ecommerce/seed-base.ts
pnpm tsx demo-ecommerce/seed-signal.ts
```

Login at http://localhost:3000/login  
Email: `admin@demo-ecommerce.local` / Password: `demo2026`

## 5-Minute Script

### 0:00–0:30 — Opening

1. Log in, navigate to `/ontology`, briefly show the 5 object types and their relationships.
2. Say: "This is a pre-configured data model for an e-commerce operator. 20,000 orders, 5,000 customers. Let me ask a few questions in plain language."

### 0:30–1:30 — Q1: Category ranking

**Ask:** "What are the top 3 best-selling categories this month? What's the revenue for each?"

**Expected answer:**

| Category | Revenue |
|----------|---------|
| Beauty & Skincare | Highest |
| Electronics Accessories | Second |
| Sports & Outdoors | Third |

**Talking point:** "No SQL, no data engineer — just a question."

### 1:30–2:30 — Q2: Top products vs. ratings

**Ask:** "Show me the top 20 products by revenue and their average ratings."

**Expected:** 3 "viral products" in the top 20 with ratings below 3:
- Viral charging cable
- Viral snack product
- Viral sports bottle

**Talking point:** "This crosses 3 tables — products, order items, reviews. The insight: high sales ≠ good reputation. These 3 are potential return risks."

### 2:30–3:30 — Q3: Weekend vs. weekday

**Ask:** "How much higher is weekend order volume compared to weekdays? Is the average order value different?"

**Expected:**
- Weekend daily orders ~40–60% higher than weekdays
- Weekend AOV ~15–25% lower than weekdays

**Talking point:** "The Agent remembers context across the conversation. Insight: weekends are high-volume, low-value — push promotions, not premium products."

### 3:30–5:00 — Open Q&A

Say: "What business question do you care about most? Ask anything."

Let the audience ask a real question. This is the key moment — the first 3.5 minutes prove the platform can do *these things*; the last 1.5 minutes prove it can do *anything they need*.

**Common follow-ups:**

| Question | Supported? |
|----------|-----------|
| "High-value customer distribution by city" | ✓ |
| "Order trend over the past 7 days" | ✓ |
| "Products with highest return rates" | ⚠️ (possible, requires relationship traversal) |
| "Import this Excel file" | ✓ (triggers data-ingestion skill) |

If the audience is stuck, prompt: "Want to see derived properties? We can define 'high-value customer = monthly spend ≥ 1000' live, then filter by that label."

## Data Characteristics (for debugging)

Run `pnpm tsx demo-ecommerce/verify.ts` to confirm:

- **Scale**: 200 products / 5,000 customers / ~20,900 orders / ~61,000 items / ~8,900 reviews
- **Q1 story**: Snacks & beverages have the highest volume but lowest AOV
- **Q2 story**: ≥ 2 viral products in the top 20 with rating < 3.5
- **Q3 story**: Weekend daily order lift ≥ 40%, weekend AOV ≥ 15% lower than weekdays

If `verify.ts` fails, re-run `seed-signal.ts`.

## Reset

```sql
-- Quick reset (keep tenant, clear data)
DELETE FROM object_instances WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'demo-ecommerce');

-- Full teardown
DELETE FROM object_types WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'demo-ecommerce');
DELETE FROM users WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'demo-ecommerce');
DELETE FROM tenants WHERE slug = 'demo-ecommerce';
```
