---
status: ready-for-agent
type: AFK
category: enhancement
created: 2026-05-05
---

# Delete Object Type with soft-delete cascade

## Parent

[Ontology Design Skill PRD](../PRD.md)

## What to build

`delete_object_type` tool that removes the Object Type definition and soft-deletes all associated Object Instances. Agent shows impact in confirmation plan ("将同时软删除 N 条数据").

## Acceptance criteria

- [ ] User says "删掉供应商类型" → agent shows confirmation with instance count
- [ ] After confirmation, Object Type is deleted from DB
- [ ] All Object Instances of that type have `deletedAt` set (soft-deleted)
- [ ] Soft-deleted instances no longer appear in queries
- [ ] Agent refuses to delete if type is referenced by a Relationship (suggests deleting relationship first)

## Blocked by

- [01-tracer-bullet-update-type](./01-tracer-bullet-update-type.md)
