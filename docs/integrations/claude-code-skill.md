# OntoCenter Query Skill

Use this skill when the user wants to query or analyze business data stored in an OntoCenter instance.

## Prerequisites

The OntoCenter API must be running. Default: `http://localhost:3001`.

## Authentication

Before making any API call, get a JWT token:

```bash
TOKEN=$(curl -s -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@demo.com","password":"admin123","tenantSlug":"demo"}' \
  | jq -r '.accessToken')
```

Use this token in all subsequent requests as `Authorization: Bearer $TOKEN`.

## Scenarios

### Scenario 1: "What object types exist?"

Fetch the ontology schema to understand what data is available:

```bash
curl -s http://localhost:3001/ontology/types \
  -H "Authorization: Bearer $TOKEN" | jq '.[].name'
```

This returns all object types with their properties. Use this first to understand the data model before querying.

### Scenario 2: "Query specific objects with filters"

Use POST /query/objects. Example: find all delivered orders over 5km:

```bash
curl -s -X POST http://localhost:3001/query/objects \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "objectType": "delivery_order",
    "filters": [
      {"field": "status", "operator": "eq", "value": "delivered"},
      {"field": "totalDistance", "operator": "gt", "value": 5}
    ],
    "sort": {"field": "totalTime", "direction": "desc"},
    "page": 1,
    "pageSize": 20
  }'
```

Filter operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `contains`, `in`.

### Scenario 3: "Aggregate and analyze data"

Use POST /query/aggregate. Example: average delivery time by mode:

```bash
curl -s -X POST http://localhost:3001/query/aggregate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "objectType": "delivery_order",
    "groupBy": ["deliveryMode"],
    "metrics": [
      {"kind": "avg", "field": "totalTime", "alias": "avgTime"},
      {"kind": "count", "alias": "n"}
    ],
    "orderBy": [{"kind": "metric", "by": "avgTime", "direction": "desc"}]
  }'
```

Metric kinds: `count`, `countDistinct`, `sum`, `avg`, `min`, `max`.

### Scenario 4: "Create a new object type"

Use POST /ontology/types. Example: create a "warehouse" type:

```bash
curl -s -X POST http://localhost:3001/ontology/types \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "warehouse",
    "label": "仓库",
    "properties": [
      {"name": "name", "type": "string", "label": "名称", "filterable": true},
      {"name": "capacity", "type": "number", "label": "容量", "filterable": true, "sortable": true},
      {"name": "city", "type": "string", "label": "城市", "filterable": true}
    ]
  }'
```

Property types: `string`, `number`, `boolean`, `date`, `json`.

### Scenario 5: "Ask a natural language question"

Use POST /agent/chat (returns SSE stream). Example:

```bash
curl -s -N -X POST http://localhost:3001/agent/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "哪个中转站等待时间最长？"}'
```

The response is a Server-Sent Events stream. Each line starts with `data: ` followed by a JSON event.

## Tips

- Always fetch the schema first (Scenario 1) to know what objectTypes and properties are available.
- Use `contains` operator for fuzzy text matching.
- Aggregation supports `maxGroups` for pagination and `pageToken` for fetching next pages.
- All numeric properties support `gt`, `gte`, `lt`, `lte` operators.
- The `in` operator accepts an array value for matching multiple values.
