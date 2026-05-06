export function formatToolResultForLlm(payload: unknown): string {
  return `<data>${JSON.stringify(payload)}</data>`;
}
