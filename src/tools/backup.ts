/**
 * Shared mutation safety helpers.
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { getLibraryService } from '../services/library.js';

/**
 * Create a timestamped XML backup before any write operation.
 * Throws on failure so callers fail closed.
 */
export async function ensureBackupBeforeWrite(): Promise<string> {
  const service = getLibraryService();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = resolve(`./bonk-backup-${timestamp}.xml`);

  const xml = service.exportToXML();
  const dir = dirname(backupPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(backupPath, xml, 'utf-8');
  return backupPath;
}
