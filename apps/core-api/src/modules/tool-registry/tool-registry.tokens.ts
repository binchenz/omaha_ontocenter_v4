export const AGENT_TOOLS = 'AGENT_TOOLS';
export const AGENT_SKILLS = 'AGENT_SKILLS';

/**
 * Metadata marker stamped on AgentTool provider classes (ADR-0052).
 * DiscoveryService scans the container for providers carrying this key and
 * aggregates their instances into AGENT_TOOLS. Replaces the non-functional
 * `multi: true` approach (NestJS does not support Angular-style multi-providers).
 */
export const IS_AGENT_TOOL = 'IS_AGENT_TOOL';
