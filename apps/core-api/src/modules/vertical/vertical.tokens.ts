/**
 * DI token for the set of registered Verticals (ADR-0062). The core collects all `Vertical`
 * manifests provided under this token and fans their contributions into the agent seams
 * (AGENT_SKILLS, orchestrator drillGates, tool registry). Core provides an empty default;
 * the app wires concrete verticals (the reference vertical, and privately the AVC vertical).
 */
export const VERTICALS = 'VERTICALS';
