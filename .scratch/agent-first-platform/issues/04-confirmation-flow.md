---
status: ready-for-agent
category: enhancement
type: AFK
created: 2026-05-05
---

# Confirmation flow for write operations

## Parent

[Agent-First Platform PRD](../PRD.md)

## What to build

Implement the risk-based confirmation gate: when the agent's LLM selects a tool marked `requiresConfirmation: true`, the agent loop pauses, sends a `confirmation_request` SSE event to the frontend, and waits for user approval via `POST /agent/confirm`. If confirmed, the tool executes. If rejected, the rejection (with optional user comment) is fed back to the LLM as a tool result so the agent can adjust its approach.

This slice adds:
- `requiresConfirmation` boolean field on `AgentTool` interface
- Agent loop checks this flag before executing; if true, yields `confirmation_request` event and suspends
- `POST /agent/confirm` endpoint: `{ conversationId, confirmed, comment? }` — resumes the suspended agent loop
- Rejection path: LLM receives `{ "status": "rejected", "reason": "<user comment>" }` as tool result and continues reasoning
- A test write tool (e.g. `create_object_type_draft`) to verify the flow end-to-end

## Acceptance criteria

- [ ] A tool with `requiresConfirmation: true` triggers a `confirmation_request` SSE event before execution
- [ ] `POST /agent/confirm` with `{ confirmed: true }` resumes execution and the tool runs
- [ ] `POST /agent/confirm` with `{ confirmed: false, comment: "不是这个类型" }` feeds rejection to LLM, agent responds with adjusted plan
- [ ] Read-only tools (like `query_objects`) never trigger confirmation
- [ ] The confirmation state is persisted so that if the SSE connection drops, the pending confirmation can be resumed
- [ ] Agent does not proceed with write operations without explicit user confirmation

## Blocked by

- [01-tracer-bullet-single-turn-query](./01-tracer-bullet-single-turn-query.md)
