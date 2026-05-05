---
status: ready-for-agent
created: 2026-05-05
---

# PRD: Ontology Design Skill

## Problem Statement

用户通过数据接入 skill 导入数据后，可能需要调整本体结构：添加遗漏的属性、修改 filterable/sortable 标记、建立类型间的关系、删除不需要的类型。当前只能通过 REST API（OntologyController）手动操作，非技术用户无法使用。

## Solution

实现 Ontology Design Skill，让用户通过对话管理本体结构。Agent 不仅执行 CRUD 操作，还能主动建议优化（如标记 filterable、建立关系）。

## User Stories

1. As a business owner, I want to say "给客户类型加一个'行业'字段", so that I can extend my data model without technical help.
2. As a business owner, I want to say "把客户的区域字段设为可排序", so that I can sort query results by region.
3. As a business owner, I want to say "删掉供应商类型", so that I can clean up unused types.
4. As a business owner, I want the agent to warn me "将同时软删除 10 条供应商数据" before deleting a type, so that I understand the impact.
5. As a business owner, I want to say "在订单和产品之间建立多对多关系", so that I can query orders with their products.
6. As a business owner, I want to say "删掉订单和产品的关系", so that I can fix incorrect relationships.
7. As a business owner, I want to say "帮我看看本体有什么可以优化的", so that the agent reviews my schema and suggests improvements.
8. As a business owner, I want the agent to suggest "区域字段经常用于过滤，要标记为 filterable 吗？" when I query with a non-filterable field, so that I learn about optimization opportunities naturally.
9. As a business owner, I want to say "把客户的电话字段改名为联系电话", so that labels are more descriptive.
10. As a business owner, I want to say "看看我现在有哪些对象类型", so that I can understand my current ontology.

## Implementation Decisions

- **Reuse `create_object_type` tool** from data ingestion skill
- **New tools**: `update_object_type` (confirmation required), `delete_object_type` (confirmation required), `create_relationship` (confirmation required), `delete_relationship` (confirmation required)
- **Schema-only changes**: modifying a type does NOT touch existing Object Instance data (JSONB is schema-less)
- **Delete cascades to soft-delete**: deleting a type soft-deletes all its Object Instances
- **Smart suggestions**: mixed trigger — user can ask for review, agent also suggests during queries when it notices non-filterable fields being filtered
- **`get_ontology_schema` tool** already exists and serves the "show me my types" use case

## Testing Decisions

- Unit test: `update_object_type` tool correctly calls OntologyService.updateObjectType
- Unit test: `delete_object_type` tool soft-deletes associated Object Instances
- Integration: agent suggests filterable optimization when querying with non-filterable field (via prompt behavior — verified end-to-end)

## Out of Scope

- Derived Property management (expression editing) — complex, separate feature
- Object Type versioning/migration — schema changes are additive only
- Ontology graph visualization — requires frontend graph component
- Undo/revert schema changes
