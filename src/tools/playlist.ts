/**
 * Playlist Tools - MCP tools for playlist management
 */

import { getLibraryService } from '../services/library.js';
import type { SearchFilters } from '../types.js';
import { ensureBackupBeforeWrite } from './backup.js';
import { loadLibrary, searchLibrary } from './library.js';

/**
 * Backup the library before making changes
 */
async function backupLibrary(): Promise<string> {
  try {
    return await ensureBackupBeforeWrite();
  } catch (error) {
    throw new Error(`Backup failed: ${error}`);
  }
}

/**
 * Create a new playlist
 */
export async function createPlaylist(name: string, parentName?: string): Promise<{
  success: boolean;
  playlist?: any;
  backup?: string;
  error?: string;
}> {
  try {
    const backupPath = await backupLibrary();
    const service = getLibraryService();
    const playlist = service.createPlaylist(name, parentName);
    return {
      success: true,
      backup: backupPath,
      playlist,
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Add tracks to a playlist
 */
export async function addTracksToPlaylist(
  playlistName: string,
  trackIds: string[],
  mode: 'add' | 'replace' = 'add'
): Promise<{
  success: boolean;
  added?: number;
  backup?: string;
  error?: string;
}> {
  try {
    const backupPath = await backupLibrary();
    const service = getLibraryService();
    const added = service.addTracksToPlaylist(playlistName, trackIds, mode);

    return {
      success: true,
      added,
      backup: backupPath,
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Batch add tracks to multiple playlists.
 */
export async function addTracksToPlaylistsBatch(
  operations: Array<{ playlistName: string; trackIds: string[]; mode?: 'add' | 'replace' }>
): Promise<{
  success: number;
  failed: number;
  results: Array<{ playlistName: string; success: boolean; added?: number; error?: string }>;
}> {
  let success = 0;
  let failed = 0;
  const results: Array<{ playlistName: string; success: boolean; added?: number; error?: string }> = [];

  for (const op of operations) {
    const result = await addTracksToPlaylist(op.playlistName, op.trackIds, op.mode || 'add');
    if (result.success) {
      success++;
      results.push({ playlistName: op.playlistName, success: true, added: result.added || 0 });
    } else {
      failed++;
      results.push({ playlistName: op.playlistName, success: false, error: result.error || 'Unknown error' });
    }
  }

  return { success, failed, results };
}

/**
 * Remove tracks from a playlist
 */
export async function removeTracksFromPlaylist(
  playlistName: string,
  trackIds: string[]
): Promise<{
  success: boolean;
  removed?: number;
  backup?: string;
  error?: string;
}> {
  try {
    const backupPath = await backupLibrary();
    const service = getLibraryService();
    const removed = service.removeTracksFromPlaylist(playlistName, trackIds);

    return {
      success: true,
      removed,
      backup: backupPath,
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Delete a playlist
 */
export async function deletePlaylist(
  playlistName: string,
  force: boolean = false
): Promise<{
  success: boolean;
  backup?: string;
  error?: string;
}> {
  if (!force) {
    return {
      success: false,
      error: 'Confirmation required. Set force=true to delete.',
    };
  }

  try {
    const backupPath = await backupLibrary();
    const service = getLibraryService();
    const deleted = service.deletePlaylist(playlistName);
    if (!deleted) {
      return { success: false, error: `Playlist not found: ${playlistName}` };
    }

    return {
      success: true,
      backup: backupPath,
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Rename a playlist
 */
export async function renamePlaylist(
  oldName: string,
  newName: string
): Promise<{
  success: boolean;
  backup?: string;
  error?: string;
}> {
  try {
    const backupPath = await backupLibrary();
    const service = getLibraryService();
    service.renamePlaylist(oldName, newName);

    return {
      success: true,
      backup: backupPath,
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Duplicate a playlist
 */
export async function duplicatePlaylist(
  playlistName: string,
  newName?: string
): Promise<{
  success: boolean;
  playlist?: any;
  backup?: string;
  error?: string;
}> {
  try {
    const backupPath = await backupLibrary();
    const service = getLibraryService();
    const playlist = service.duplicatePlaylist(playlistName, newName);

    return {
      success: true,
      backup: backupPath,
      playlist,
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Export playlist to separate XML
 */
export async function exportPlaylist(playlistName: string): Promise<{
  success: boolean;
  xml?: string;
  trackCount?: number;
  error?: string;
}> {
  try {
    const service = getLibraryService();
    const playlist = service.getPlaylistByName(playlistName);
    if (!playlist) {
      return { success: false, error: `Playlist not found: ${playlistName}` };
    }
    if (playlist.Type !== '1') {
      return { success: false, error: `Target is not a playlist: ${playlistName}` };
    }

    return {
      success: true,
      trackCount: playlist.Entries.length,
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Create a playlist and fill it with every track matching the same filters as library_search.
 */
export async function createPlaylistFromSearch(input: {
  playlistName: string;
  filters: SearchFilters;
  xmlPath?: string;
}): Promise<{
  success: boolean;
  playlistName?: string;
  totalMatched?: number;
  added?: number;
  backupCreate?: string;
  backupAdd?: string;
  error?: string;
  message?: string;
}> {
  const name = (input.playlistName || '').trim();
  if (!name) {
    return { success: false, error: 'playlistName is required' };
  }
  const filters = input.filters;
  if (!filters || typeof filters !== 'object' || !Object.keys(filters).length) {
    return { success: false, error: 'filters must include at least one field' };
  }

  if (input.xmlPath) {
    const loaded = await loadLibrary({ xmlPath: input.xmlPath });
    if (!loaded.success) {
      return { success: false, error: loaded.message };
    }
  }

  const pageSize = 500;
  let offset = 0;
  const ids: string[] = [];
  let total = 0;

  for (;;) {
    const page = await searchLibrary({ filters, limit: pageSize, offset });
    total = page.total;
    for (const t of page.tracks) {
      if (t.TrackID) ids.push(t.TrackID);
    }
    if (page.tracks.length === 0 || ids.length >= total) break;
    offset += page.tracks.length;
  }

  if (total === 0) {
    return {
      success: false,
      error: 'No tracks matched the filters; playlist was not created.',
      totalMatched: 0,
    };
  }

  const created = await createPlaylist(name);
  if (!created.success) {
    return {
      success: false,
      error: created.error,
      totalMatched: total,
      message: `Matched ${total} tracks but could not create playlist.`,
    };
  }

  const added = await addTracksToPlaylist(name, ids, 'replace');
  if (!added.success) {
    return {
      success: false,
      error: added.error,
      totalMatched: total,
      backupCreate: created.backup,
      message: `Playlist was created but adding tracks failed.`,
    };
  }

  return {
    success: true,
    playlistName: name,
    totalMatched: total,
    added: added.added,
    backupCreate: created.backup,
    backupAdd: added.backup,
    message: `Playlist "${name}" now has ${added.added} track(s) (${total} matched).`,
  };
}
