# Wire new modules + remove dead code

## What to build

Register `TypeResolver` and `ImportEngine` in `agent.module.ts`, update all tool injections to use the new modules, consolidate `UPLOAD_DIR` imports, and remove dead code left over from the refactor.

## Acceptance criteria

- [ ] `TypeResolver` registered as a provider in `AgentModule`
- [ ] `ImportEngine` registered as a provider in `AgentModule`
- [ ] `ImportDataTool` injection updated (depends on `ImportEngine`, not `OntologySdkService`)
- [ ] `ParseFileTool` imports `UPLOAD_DIR` from `ImportEngine` (not its own constant)
- [ ] `FileController` imports `UPLOAD_DIR` from `ImportEngine` (not its own constant)
- [ ] Dead `PrismaService` injection removed from `DeleteObjectTypeTool`
- [ ] `pnpm --filter @omaha/core-api build` passes with zero errors
- [ ] All existing tests pass (agent.service.spec, file-parser.spec, deepseek-llm-client.spec)
- [ ] All new tests from slices #1-#4 pass

## Blocked by

- Slice #3 (ImportEngine)
- Slice #4 (OntologySdk refactor)
