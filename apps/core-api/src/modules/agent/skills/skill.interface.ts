export interface SkillContext {
  tenantId: string;
  userMessage?: string;
}

export interface AgentSkill {
  name: string;
  description: string;
  tools: string[];
  systemPrompt(context: SkillContext): string;
  /**
   * Returns true/false or a confidence score (0-1) for whether this skill
   * should be activated for the given context. If omitted, always active.
   */
  activationCondition?(context: SkillContext): boolean | number;
}
