/**
 * Mutation audit logging (append-only JSONL).
 */

import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { createHash } from 'crypto';

type AuditPayload = {
  tool: string;
  canonicalTool: string;
  args: unknown;
  result?: unknown;
  error?: string;
  backupPath?: string | null;
};

const AUDIT_LOG_PATH = resolve('./audit/bonk-mutations.jsonl');

function ensureAuditDir(): void {
  const dir = dirname(AUDIT_LOG_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function hashArgs(args: unknown): string {
  try {
    return createHash('sha256').update(JSON.stringify(args ?? {})).digest('hex');
  } catch {
    return 'unhashable';
  }
}

export function logMutation(payload: AuditPayload): void {
  try {
    ensureAuditDir();
    const entry = {
      timestamp: new Date().toISOString(),
      tool: payload.tool,
      canonicalTool: payload.canonicalTool,
      argsHash: hashArgs(payload.args),
      args: payload.args ?? {},
      result: payload.result ?? null,
      error: payload.error ?? null,
      backupPath: payload.backupPath ?? null,
    };
    appendFileSync(AUDIT_LOG_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (error) {
    console.error(`[audit] Failed to write mutation log: ${(error as Error).message}`);
  }
}
