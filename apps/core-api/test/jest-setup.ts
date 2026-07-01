// Jest global setup (unit tests). Runs once before the test framework is installed.
//
// EXPOSE_SYSTEM_PROMPT: production defaults OFF (the orchestrator no longer streams the
// assembled system prompt to the client — see ADR-0024 amendment 2026-07-01). Several specs
// assert on the `system_prompt` event as the only channel to verify prompt assembly / tenant
// identity injection, so we opt them into the emit here rather than editing each spec. This
// mirrors the production debug affordance (EXPOSE_SYSTEM_PROMPT=1) the ADR preserved.
process.env.EXPOSE_SYSTEM_PROMPT = '1';
