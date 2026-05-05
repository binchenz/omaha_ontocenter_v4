---
status: ready-for-agent
type: AFK
category: enhancement
created: 2026-05-05
---

# Tracer bullet: update Object Type via conversation

## Parent

[Ontology Design Skill PRD](../PRD.md)

## What to build

The thinnest end-to-end path: user says "给客户类型加一个行业字段", agent calls `update_object_type` tool (with confirmation), Object Type is updated in the database.

This slice introduces:
- `update_object_type` tool — calls OntologyService.updateObjectType (requiresConfirmation: true)
- `OntologyDesignSkill` — system prompt with CRUD workflow + optimization suggestion rules
- Wire into AgentModule

## Acceptance criteria

- [ ] User says "给客户加一个行业字段" → agent presents confirmation plan
- [ ] After confirmation, Object Type in DB has the new property
- [ ] User says "把客户的区域设为可排序" → agent updates sortable flag
- [ ] Existing Object Instances are NOT modified
- [ ] `get_ontology_schema` reflects the changes immediately after update
- [ ] Build passes, existing tests pass

## Blocked by

None — can start immediately
