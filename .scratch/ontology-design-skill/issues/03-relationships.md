---
status: ready-for-agent
type: AFK
category: enhancement
created: 2026-05-05
---

# Create and delete Relationships via conversation

## Parent

[Ontology Design Skill PRD](../PRD.md)

## What to build

`create_relationship` and `delete_relationship` tools. User can say "在订单和产品之间建立多对多关系" or "删掉订单和产品的关系".

## Acceptance criteria

- [ ] User says "在订单和产品之间建立多对多关系" → agent confirms → relationship created
- [ ] User says "删掉订单和产品的关系" → agent confirms → relationship deleted
- [ ] `get_ontology_schema` reflects relationship changes
- [ ] Agent validates that both Object Types exist before creating relationship
- [ ] Agent shows cardinality options if not specified ("一对多还是多对多？")

## Blocked by

- [01-tracer-bullet-update-type](./01-tracer-bullet-update-type.md)
