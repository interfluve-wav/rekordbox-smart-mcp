/**
 * Mutation tools - undo/rollback functionality
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { getLibraryService } from '../services/library.js';
import { ensureBackupBeforeWrite } from './backup.js';
import { getConfig } from '../config.js';

const AUDIT_LOG_PATH = resolve('./audit/bonk-mutations.jsonl');

interface MutationEntry {
  timestamp: string;
  tool: string;
  canonicalTool: string;
  argsHash: string;
  args: unknown;
  result?: unknown;
  error?: string;
  backupPath?: string | null;
}

export async function mutationHistory(input: {
  limit?: number;
  tool?: string;
  since?: string;
}): Promise<{
  mutations: Array<{
    id: string;
    tool: string;
    timestamp: string;
    argsSummary: Record<string, unknown>;
    backupPath: string | null;
    error: string | null;
  }>;
  total: number;
}> {
  const limit = input.limit || 50;
  const toolFilter = input.tool?.toLowerCase();
  const since = input.since;

  if (!existsSync(AUDIT_LOG_PATH)) {
    return { mutations: [], total: 0 };
  }

  const content = readFileSync(AUDIT_LOG_PATH, 'utf-8');
  const lines = content.trim().split('\n').filter(Boolean);

  const mutations: Array<{
    id: string;
    tool: string;
    timestamp: string;
    argsSummary: Record<string, unknown>;
    backupPath: string | null;
    error: string | null;
  }> = [];

  // Read from end for efficiency
  const startIndex = Math.max(0, lines.length - limit * 2); // read extra to account for filtering
  for (let i = startIndex; i < lines.length; i++) {
    try {
      const entry = JSON.parse(lines[i]) as MutationEntry;

      // Filter by tool
      if (toolFilter && entry.tool.toLowerCase() !== toolFilter) {
        continue;
      }

      // Filter by since
      if (since && entry.timestamp < since) {
        continue;
      }

      // Create shallow args summary (avoid large nested objects)
      const argsSummary: Record<string, unknown> = {};
      if (entry.args && typeof entry.args === 'object') {
        for (const [key, value] of Object.entries(entry.args)) {
          if (value === undefined || value === null) {
            argsSummary[key] = value;
          } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            argsSummary[key] = value;
          } else if (Array.isArray(value)) {
            argsSummary[key] = `Array(${value.length})`;
          } else {
            argsSummary[key] = typeof value;
          }
        }
      }

      mutations.push({
        id: entry.timestamp,
        tool: entry.tool,
        timestamp: entry.timestamp,
        argsSummary,
        backupPath: entry.backupPath || null,
        error: entry.error || null,
      });

      if (mutations.length >= limit) break;
    } catch {
      // Skip malformed lines
      continue;
    }
  }

  // Reverse to show most recent first
  mutations.reverse();

  return {
    mutations,
    total: mutations.length,
  };
}

export async function mutationRollback(input: {
  mutationId: string;
  dryRun?: boolean;
}): Promise<{
  success: boolean;
  message: string;
  restoredFrom?: string;
  preRollbackBackup?: string;
  backup?: string;
}> {
  const { mutationId, dryRun = false } = input;

  if (!existsSync(AUDIT_LOG_PATH)) {
    return {
      success: false,
      message: 'No mutation log found',
    };
  }

  // Find the mutation entry by timestamp
  const content = readFileSync(AUDIT_LOG_PATH, 'utf-8');
  const lines = content.trim().split('\n').filter(Boolean);

  let targetEntry: MutationEntry | null = null;
  // Search from end for efficiency
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(lines[i]) as MutationEntry;
      if (entry.timestamp === mutationId) {
        targetEntry = entry;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!targetEntry) {
    return {
      success: false,
      message: `Mutation not found: ${mutationId}`,
    };
  }

  if (!targetEntry.backupPath) {
    return {
      success: false,
      message: `Cannot undo: no backup available for that operation (${mutationId})`,
    };
  }

  if (!existsSync(targetEntry.backupPath)) {
    return {
      success: false,
      message: `Backup file not found: ${targetEntry.backupPath}`,
    };
  }

  if (dryRun) {
    return {
      success: true,
      message: `Dry run: would restore from ${targetEntry.backupPath}`,
      restoredFrom: targetEntry.backupPath,
    };
  }

  try {
    // Create pre-rollback backup
    const preRollbackBackup = await ensureBackupBeforeWrite();

    // Load the backup XML into library
    const service = getLibraryService();
    service.loadFromXML(targetEntry.backupPath);

    return {
      success: true,
      message: `Rollback complete. Restored from ${targetEntry.backupPath}`,
      restoredFrom: targetEntry.backupPath,
      preRollbackBackup,
      backup: preRollbackBackup, // for logging
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Rollback failed: ${error.message}`,
    };
  }
}
