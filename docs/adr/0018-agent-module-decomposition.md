---
status: accepted
---

# Agent module decomposition: Conversation / Orchestrator / Skills / SDK

The agent module is split into four bounded responsibilities: **Conversation** (session lifecycle, message persistence, context window), **Orchestrator** (LLM calls, tool-call loop, skill activation), **Skills** (independent units with own tools and activation conditions), and **SDK** (ontology operation facade for skills). Skills cannot call each other; shared capabilities live in the SDK layer.

The SDK is further split into Core SDK (read/write object instances, query, ontology metadata — available to all skills) and Infrastructure SDK (connectors, index management — injected only to skills that need them).

Migration is incremental (strangler fig): extract SDK first, then Conversation, then Orchestrator/Skills last. Each step must pass existing tests before proceeding.

## Considered options

- **Horizontal split by scenario** (query agent vs ingestion agent vs admin agent): rejected because the product hasn't reached multi-agent complexity. Premature split would introduce coordination overhead (agent-to-agent routing, shared state) without clear benefit. Revisit when skill count exceeds ~15 or when distinct agent personas emerge.
- **Keep as single module, enforce boundaries via linting**: rejected because the module already has 10 subdirectories (dto, sse, tools, llm, confirmation, sdk, connector, skills, conversation, __tests__) importing across 4 sibling modules (auth, ontology, permission, query). Lint rules would fight the existing coupling rather than resolve it.

## Consequences

- Skill developers only need to understand the SDK interface, not orchestrator internals. Lowers onboarding cost.
- Platform team (1-2 people) owns Orchestrator + Conversation + SDK; skill development parallelises across the rest of the team.
- SDK interface becomes a stability contract — breaking changes require versioning or migration support.
