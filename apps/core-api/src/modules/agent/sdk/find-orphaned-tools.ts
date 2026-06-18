import { AgentSkill } from '../skills/skill.interface';

/** Tools registered in DI but declared by no skill — dead weight the LLM can never reach. */
export function findOrphanedTools(toolNames: string[], skills: AgentSkill[]): string[] {
  const declared = new Set<string>();
  for (const skill of skills) {
    for (const name of skill.tools) declared.add(name);
  }
  return toolNames.filter(name => !declared.has(name));
}

/**
 * The opposite landmine: a skill declares a tool name that is NOT registered in DI.
 * The orchestrator scopes the LLM's tool set to (registered tools ∩ skill-declared names),
 * so a dangling reference silently drops to zero — the capability looks present in the
 * skill but the Agent can never call it. This is exactly how render_chart spent its life
 * as a no-op (declared by research_qa, never in AGENT_TOOLS) while the chart panel stayed
 * blank. Validated at startup so the next such break fails fast instead of shipping dark.
 */
export function findDanglingToolRefs(toolNames: string[], skills: AgentSkill[]): string[] {
  const registered = new Set(toolNames);
  const dangling = new Set<string>();
  for (const skill of skills) {
    for (const name of skill.tools) {
      if (!registered.has(name)) dangling.add(`${skill.name}:${name}`);
    }
  }
  return [...dangling];
}
