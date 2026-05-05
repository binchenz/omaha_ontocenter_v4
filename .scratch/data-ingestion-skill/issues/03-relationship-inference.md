---
status: ready-for-agent
type: AFK
category: enhancement
created: 2026-05-05
---

# Relationship inference from existing ontology

## Parent

[Data Ingestion Skill PRD](../PRD.md)

## What to build

When inferring schema for a new file/table, the LLM receives the list of existing Object Types in the tenant's ontology. If a column name matches an existing type (e.g. `customer_id`, `客户名称` when a "客户" type exists), the LLM proposes a relationship in the confirmation plan. User can accept or reject each proposed relationship.

## Acceptance criteria

- [ ] DataIngestionSkill prompt includes rules for relationship detection (column name contains existing Object Type name + `_id`/`_name`/`Id`/`名称` suffix)
- [ ] `parse_file` tool result includes `existingTypes` field listing current tenant's Object Types (name + label)
- [ ] LLM proposes relationships in its schema inference output
- [ ] Confirmation plan displays relationship candidates clearly (e.g. "关联关系：→ 客户（通过'客户名称'列匹配）")
- [ ] If user confirms, `create_object_type` tool also creates the ObjectRelationship
- [ ] If user rejects a relationship ("那列不是客户，是收件人"), the column is kept as a plain string property
- [ ] Import correctly populates `relationships` JSONB on Object Instances by matching externalId/label of target type

## Blocked by

- [01-tracer-bullet-excel-import](./01-tracer-bullet-excel-import.md)
