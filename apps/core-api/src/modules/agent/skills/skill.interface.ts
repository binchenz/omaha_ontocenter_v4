import type { LlmOptions } from '../llm/llm-client.interface';

export interface SkillContext {
  tenantId: string;
  userMessage?: string;
}

export interface AgentSkill {
  name: string;
  description: string;
  tools: string[];
  /** Per-skill LLM options (model override, thinking mode). */
  llmOptions?: LlmOptions;
  systemPrompt(context: SkillContext): string;
}
