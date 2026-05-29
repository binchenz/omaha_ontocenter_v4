import * as fs from 'fs';
import * as path from 'path';

/**
 * LLM prompt/response debug dump.
 *
 * When LLM_DEBUG=1, every LLM call writes a JSON file capturing the exact
 * assembled request (model + messages + tools) and the raw API response.
 * This is the prompt-debugging tool: when the Agent picks the wrong field
 * or tool, you can read the file and see exactly what the schema summary,
 * tool definitions, and history looked like at decision time.
 *
 * Files are named by timestamp + sequence so the latest call sorts last:
 *   .llm-debug/2026-05-29T18-30-00-123Z-0001.json
 *
 * Disabled by default (no-op unless LLM_DEBUG=1) — zero production overhead.
 */

const DEBUG_DIR = process.env.LLM_DEBUG_DIR || '.llm-debug';
let seq = 0;
let dirReady = false;

export function isLlmDebugEnabled(): boolean {
  return process.env.LLM_DEBUG === '1' || process.env.LLM_DEBUG === 'true';
}

export interface LlmDebugRecord {
  request: {
    model: string;
    messages: unknown;
    tools?: unknown;
  };
  response?: unknown;
  error?: string;
  durationMs: number;
  promptTokens?: number;
}

export function dumpLlmCall(record: LlmDebugRecord): void {
  if (!isLlmDebugEnabled()) return;
  try {
    if (!dirReady) {
      fs.mkdirSync(DEBUG_DIR, { recursive: true });
      dirReady = true;
    }
    seq += 1;
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(DEBUG_DIR, `${ts}-${String(seq).padStart(4, '0')}.json`);
    fs.writeFileSync(file, JSON.stringify(record, null, 2), 'utf8');
  } catch {
    // Debug dump must never break the request path — swallow all errors.
  }
}
