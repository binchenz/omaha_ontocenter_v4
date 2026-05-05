---
status: ready-for-agent
category: enhancement
type: AFK
created: 2026-05-05
---

# Ontology schema tool + skill registry

## Parent

[Agent-First Platform PRD](../PRD.md)

## What to build

Add the `get_ontology_schema` tool so the agent can inspect the tenant's ontology (available Object Types, their properties, relationships) before deciding how to query. Introduce the Skill interface and SkillRegistry so tools are grouped by domain capability, and the query skill's system prompt is dynamically assembled from the ontology context.

This slice adds:
- `AgentSkill` interface: `{ name, description, tools[], systemPrompt(context) }`
- `SkillRegistry` that loads all registered skills and provides their combined prompt + tool definitions
- `query` skill — migrates the `buildSystemPrompt()` logic from `nl-query.service.ts`, exposes `query_objects` + `get_ontology_schema` tools
- `get_ontology_schema` tool — calls `OntologySdkService.getSchema()`, returns types/properties/relationships in a structured format the LLM can reason about
- Agent loop uses SkillRegistry to assemble system prompt and available tools (full injection of all skills)

## Acceptance criteria

- [ ] Asking "我有哪些数据类型" returns a text response listing the tenant's Object Types with their labels
- [ ] Asking "客户有哪些字段" returns the Customer type's properties and relationships
- [ ] The query skill's system prompt includes the full ontology schema (types, properties with filterable/sortable flags, relationships)
- [ ] Adding a new skill only requires creating a TypeScript file implementing `AgentSkill` and registering it in the SkillRegistry
- [ ] Agent correctly uses `get_ontology_schema` tool when it needs to understand the data model before querying

## Blocked by

- [01-tracer-bullet-single-turn-query](./01-tracer-bullet-single-turn-query.md)
