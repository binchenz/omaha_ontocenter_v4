---
name: ontocenter
description: Query and manage business data in the OntoCenter ontology platform. Use when the user wants to look up, filter, aggregate, or analyze structured business data, or when they want to create/modify object types.
allowed-tools: Bash(curl *)
---

## Connection

Base URL: `${ONTOCENTER_URL:-http://localhost:3001}`

Authenticate once per session:

```bash
ONTOCENTER_TOKEN=$(curl -s -X POST ${ONTOCENTER_URL:-http://localhost:3001}/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${ONTOCENTER_EMAIL:-admin@demo.com}\",\"password\":\"${ONTOCENTER_PASSWORD:-admin123}\",\"tenantSlug\":\"${ONTOCENTER_TENANT:-demo}\"}" \
  | jq -r '.accessToken')
```

All subsequent calls use: `-H "Authorization: Bearer $ONTOCENTER_TOKEN"`

## Instructions

When the user asks about business data:

1. **Discover schema first** — call GET /ontology/types to learn available object types and their filterable properties.
2. **Choose the right endpoint**:
   - Single/list lookup → POST /query/objects
   - Counts, averages, rankings → POST /query/aggregate
   - Schema changes → POST /ontology/types
3. **Construct filters** using operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `contains`, `in`.
4. **Present results** in a table or summary — don't dump raw JSON.

## Endpoints

### GET /ontology/types
Returns all object types with properties. Use to discover the data model.

### POST /query/objects
```json
{
  "objectType": "delivery_order",
  "filters": [{"field": "status", "operator": "eq", "value": "delivered"}],
  "sort": {"field": "totalTime", "direction": "desc"},
  "page": 1, "pageSize": 20
}
```
Returns `{ data: [...], meta: { total, page, pageSize, totalPages } }`.

### POST /query/aggregate
```json
{
  "objectType": "delivery_order",
  "filters": [{"field": "totalDistance", "operator": "gt", "value": 5}],
  "groupBy": ["deliveryMode"],
  "metrics": [{"kind": "avg", "field": "totalTime", "alias": "avgTime"}, {"kind": "count", "alias": "n"}],
  "orderBy": [{"kind": "metric", "by": "avgTime", "direction": "desc"}],
  "maxGroups": 10
}
```
Metric kinds: `count`, `countDistinct`, `sum`, `avg`, `min`, `max`.
Returns `{ groups: [{ key: {...}, metrics: {...} }], truncated, nextPageToken }`.

### POST /ontology/types
```json
{
  "name": "warehouse",
  "label": "仓库",
  "description": "存储和分发商品的仓库设施",
  "properties": [
    {"name": "city", "type": "string", "label": "城市", "filterable": true, "description": "仓库所在城市"},
    {"name": "capacity", "type": "number", "label": "容量", "filterable": true, "description": "最大存储量", "unit": "吨"}
  ]
}
```
Property types: `string`, `number`, `boolean`, `date`, `json`.
Optional semantic fields: `description` (business meaning), `unit` (measurement unit for numbers).
The LLM uses these to understand ambiguous queries (e.g., "大的仓库" → filters by capacity).

## Constraints

- Always include `"Content-Type: application/json"` on POST requests.
- Filter values must match the property type (number for numeric fields, string for text).
- `pageSize` max is 100. Use pagination for large result sets.
- `maxGroups` max is 500 for aggregation.
- The `in` operator takes an array: `{"field": "status", "operator": "in", "value": ["pending", "delivered"]}`.
