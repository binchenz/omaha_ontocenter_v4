# ADR-0052: Tool Registry — Module Self-Registration

## Status

Accepted

## Context

Adding a new Agent Tool currently requires three edits in `AgentModule`:
1. Import the class
2. Add it to `providers`
3. Add it to the `AGENT_TOOLS` factory `inject` array

Tools that live in other modules (ActionModule's `CreateActionTool`, DataImportModule's `ExecuteImportTool`) must additionally be exported from their home module and then listed in AgentModule's inject — even though AgentModule has no domain knowledge of them. This creates tight coupling and scattering: the "this tool exists" fact is encoded in multiple files across multiple modules.

## Decision

Introduce a `ToolRegistryModule` that holds the `AGENT_TOOLS` injection token and exposes a `forFeature(...toolClasses)` static method. Each domain module self-registers its own tools:

```typescript
// action.module.ts
@Module({
  imports: [ToolRegistryModule.forFeature(CreateActionTool, ExecuteActionTool)],
  providers: [CreateActionTool, ExecuteActionTool, ...],
})
export class ActionModule {}
```

AgentModule injects `AGENT_TOOLS` to get the full array — it no longer lists individual tools.

### Design choices locked in the grilling session:

1. **Ownership = module self-registration (Option B)**: each domain module pushes its tools into the registry. AgentModule is no longer the owner of cross-module tool lists.

2. **Skills stay as pure value objects**: instantiated with `new`, no DI, no registry. Dynamic data flows through `SkillContext`, not injected services.

3. **Token lives in ToolRegistryModule (Option B)**: avoids circular dependency between AgentModule and tool-owning modules. `AGENT_TOOLS` moves from `agent.tokens.ts` to `tool-registry/tool-registry.tokens.ts`.

4. **Tools carry no Surface metadata**: the Skill layer's `tools: string[]` remains the sole surface→tool mapping. The registry is a pure collection point with no filtering responsibility.

5. **API shape = `forFeature(...classes)`**: returns a DynamicModule that registers each class as both a provider and a `multi: true` AGENT_TOOLS contributor.

## Consequences

- Adding a tool = 2 edits in one module (file + forFeature param)
- Removing a tool = same 2 edits
- AgentModule's provider list shrinks from ~22 tool entries to zero
- Tool unit tests don't need to import AgentModule
- No runtime discovery/scanning overhead — registration is static at module init
- Skills are unaffected (no interface change)

## Amendment (2026-06-13): `multi: true` is non-functional in NestJS — use DiscoveryService

The original implementation above (`multi: true` AGENT_TOOLS contributors) **does not work**. NestJS, unlike Angular, has no concept of `multi` providers: a provider registered with `{ provide: AGENT_TOOLS, useExisting/useFactory: ..., multi: true }` silently resolves to a **single object**, not an array. Empirically verified across `useExisting + multi` and `useFactory + multi`, same-module and cross-module — all yield one object. Consequence: `AGENT_TOOLS` resolved to a single tool and `AgentBootstrap.onModuleInit` crashed on `this.tools.map is not a function`, breaking app boot. The mechanism was never boot-verified when first written.

### Corrected mechanism (DiscoveryService auto-collection)

- `ToolRegistryModule.providers(...classes)` no longer creates providers. It **marks** each tool class with an `IS_AGENT_TOOL` metadata flag (`Reflect.defineMetadata`) as a side effect and returns `[]`. The owning module still lists the tool classes in its own `providers` array explicitly.
- `ToolRegistryModule` is `@Global()` and provides `AGENT_TOOLS` via a `ToolCollector` (backed by `@nestjs/core` `DiscoveryService` + `ModuleRef`).
- `ToolCollector.collect()` scans all provider wrappers, filters to those whose metatype carries `IS_AGENT_TOOL`, and **force-resolves** each via `ModuleRef.resolve(metatype, { strict: false })` — `.get()` only returns already-instantiated singletons, so `.resolve()` is required to be independent of instantiation order. Results are deduped by tool `name` (a tool provided by two modules, e.g. `read_file_preview`, collapses to one).
- `AGENT_TOOLS` is a **stable array reference** filled in place at `onApplicationBootstrap` (after every module's providers exist). Runtime consumers (`OrchestratorService`) hold that reference and read it per request, long after the fill.
- `AgentBootstrap` moved from `OnModuleInit` to `OnApplicationBootstrap` and collects fresh (awaiting the async `collect()`), so its orphan check is independent of provider/hook ordering.

### Revised consequences

- Adding a tool = list the class in the owning module's `providers` + pass it to `ToolRegistryModule.providers(...)` (the marker). Still ~2 edits in one module.
- There **is** runtime discovery/scanning overhead now (one pass at bootstrap), contrary to the original "no runtime discovery" claim — the tradeoff for a mechanism that actually works.
- Every collected tool must still be declared by some skill or `AgentBootstrap` throws at bootstrap. New tool families need a skill (e.g. `DataPipelineSkill` declares `create_transform_config`/`list_transform_configs`).
- Choices 1–4 from the original decision still hold; only choice 5 (`forFeature` + `multi`) is superseded.
