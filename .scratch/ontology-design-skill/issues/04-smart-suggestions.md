---
status: ready-for-agent
type: AFK
category: enhancement
created: 2026-05-05
---

# Smart optimization suggestions

## Parent

[Ontology Design Skill PRD](../PRD.md)

## What to build

Agent proactively suggests ontology optimizations:
1. During queries: if a non-filterable field is used as filter, suggest marking it filterable
2. On demand: user says "帮我看看本体有什么可以优化的", agent reviews all types and suggests improvements

## Acceptance criteria

- [ ] QuerySkill prompt updated: when query uses non-filterable field, agent mentions optimization opportunity in response
- [ ] User says "帮我看看本体有什么可以优化的" → agent reviews types and lists suggestions (unfilterable fields used in queries, missing sortable on date fields, etc.)
- [ ] Suggestions are actionable: user can say "好的，帮我加上" and agent executes the update

## Blocked by

- [01-tracer-bullet-update-type](./01-tracer-bullet-update-type.md)
