/**
 * Track Tools - MCP tools for track operations
 */

import { getLibraryService } from '../services/library.js';
import type { TrackGetInput, TrackUpdateInput } from '../types.js';
import { ensureBackupBeforeWrite } from './backup.js';

/**
 * Get a track by ID
 * 
 * @example
 * await tools.track_get({ 
 *   trackId: "12345",
 *   include: { metadata: true, albumArt: true }
 * })
 */
export async function getTrack(input: TrackGetInput): Promise<{ success: boolean; track?: any; error?: string }> {
  const service = getLibraryService();
  const track = service.getTrackById(input.trackId);

  if (!track) {
    return { success: false, error: `Track not found: ${input.trackId}` };
  }

  // Filter fields based on include
  let result: any = {};

  if (input.include?.metadata !== false) {
    result = { ...track };
  } else {
    result.TrackID = track.TrackID;
    result.Name = track.Name;
    result.Artist = track.Artist;
  }

  // Remove large fields unless requested
  if (!input.include?.albumArt) {
    delete result.AlbumArt;
  }

  if (!input.include?.waveform) {
    delete result.waveform;
  }

  if (!input.include?.cues) {
    delete result.CuePoints;
  }

  if (!input.include?.tags) {
    delete result.tags;
  }

  return { success: true, track: result };
}

/**
 * Update a track's metadata
 * 
 * @example
 * await tools.track_update({
 *   trackId: "12345",
 *   updates: { artist: "New Artist", year: "2024" }
 * })
 */
export async function updateTrack(input: TrackUpdateInput): Promise<{ success: boolean; message: string; backup?: string }> {
  const service = getLibraryService();

  // Map field names
  const updates: any = {};

  if (input.updates.title !== undefined) updates.Name = input.updates.title;
  if (input.updates.artist !== undefined) updates.Artist = input.updates.artist;
  if (input.updates.album !== undefined) updates.Album = input.updates.album;
  if (input.updates.genre !== undefined) updates.Genre = input.updates.genre;
  if (input.updates.year !== undefined) updates.Year = input.updates.year;
  if (input.updates.bpm !== undefined) updates.AverageBpm = input.updates.bpm;
  if (input.updates.key !== undefined) updates.Tonality = input.updates.key;
  if (input.updates.rating !== undefined) {
    // Convert 0-5 stars to rating byte
    updates.Rating = input.updates.rating > 0 ? String(input.updates.rating * 51) : '0';
    updates.ratingByte = input.updates.rating > 0 ? input.updates.rating * 51 : 0;
  }
  if (input.updates.comments !== undefined) updates.Comments = input.updates.comments;
  if (input.updates.remixer !== undefined) updates.Remixer = input.updates.remixer;
  if (input.updates.label !== undefined) updates.Label = input.updates.label;

  let backupPath: string;
  try {
    backupPath = await ensureBackupBeforeWrite();
  } catch (error: any) {
    return { success: false, message: `Backup failed: ${error.message || String(error)}` };
  }

  const success = service.updateTrack(input.trackId, updates);

  if (!success) {
    return { success: false, message: `Track not found: ${input.trackId}` };
  }

  return { success: true, message: `Updated track ${input.trackId}`, backup: backupPath };
}

/**
 * Get playlists containing a track
 */
export async function getTrackPlaylists(trackId: string): Promise<{ success: boolean; playlists?: any[] }> {
  const service = getLibraryService();
  const playlists = service.getPlaylistsForTrack(trackId);

  return { success: true, playlists };
}

/**
 * Batch update multiple tracks
 */
export async function batchUpdateTracks(
  updates: Array<{ trackId: string; updates: Partial<TrackUpdateInput['updates']> }>
): Promise<{ success: number; failed: number; errors: string[]; backup?: string }> {
  let backupPath: string;
  try {
    backupPath = await ensureBackupBeforeWrite();
  } catch (error: any) {
    return { success: 0, failed: updates.length, errors: [`Backup failed: ${error.message || String(error)}`] };
  }

  let success = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const { trackId, updates: trackUpdates } of updates) {
    const result = await updateTrack({ trackId, updates: trackUpdates });
    if (result.success) {
      success++;
    } else {
      failed++;
      errors.push(`${trackId}: ${result.message}`);
    }
  }

  return { success, failed, errors, backup: backupPath };
}
