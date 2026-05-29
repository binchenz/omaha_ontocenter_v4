export interface SkillContext {
  tenantId: string;
  userMessage?: string;
}

export interface AgentSkill {
  name: string;
  description: string;
  tools: string[];
  systemPrompt(context: SkillContext): string;
}
