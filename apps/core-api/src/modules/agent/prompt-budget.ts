export const PROMPT_BUDGET_WARN = 6000;
export const PROMPT_BUDGET_ERROR = 8000;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 1.5);
}
