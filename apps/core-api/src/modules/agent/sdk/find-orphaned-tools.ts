import { AgentSkill } from '../skills/skill.interface';

export function findOrphanedTools(toolNames: string[], skills: AgentSkill[]): string[] {
  const declared = new Set<string>();
  for (const skill of skills) {
    for (const name of skill.tools) declared.add(name);
  }
  return toolNames.filter(name => !declared.has(name));
}
