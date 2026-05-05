export const PROMPT_BUDGET_WARN = 4000;
export const PROMPT_BUDGET_ERROR = 5000;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 1.5);
}
