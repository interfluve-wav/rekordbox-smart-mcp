/**
 * DJ Analytics Tools - MCP tools for DJ history and session analytics
 */

import { getLibraryService } from '../services/library.js';
import {
  getRecentSessionsFromDb,
  getSessionTracksFromDb,
  getHistoryStatsFromDb,
} from '../services/rekordboxHistory.js';

/**
 * Get DJ session history
 * 
 * Note: Requires direct Rekordbox DB access for full history.
 * This is a placeholder for XML-based libraries.
 */
export async function getRecentSessions(days: number = 30): Promise<{
  success: boolean;
  sessions?: any[];
  message?: string;
}> {
  const result = await getRecentSessionsFromDb(days);
  if (!result.ok) {
    return { success: false, message: result.error || 'Failed to fetch recent sessions' };
  }
  return { success: true, sessions: result.data || [] };
}

/**
 * Get tracks from a session
 */
export async function getSessionTracks(sessionId: string): Promise<{
  success: boolean;
  tracks?: any[];
  message?: string;
}> {
  const result = await getSessionTracksFromDb(sessionId);
  if (!result.ok) {
    return { success: false, message: result.error || 'Failed to fetch session tracks' };
  }
  return { success: true, tracks: result.data || [] };
}

/**
 * Get DJ history statistics
 */
export async function getHistoryStats(): Promise<{
  success: boolean;
  stats?: any;
  message?: string;
}> {
  const result = await getHistoryStatsFromDb();
  if (!result.ok) {
    return { success: false, message: result.error || 'Failed to fetch history stats' };
  }
  return { success: true, stats: result.data || {} };
}

/**
 * Get play count analytics
 */
export async function getPlayCountAnalytics(): Promise<{
  success: boolean;
  topTracks?: Array<{ trackId: string; playCount: number }>;
  totalPlays?: number;
}> {
  const service = getLibraryService();
  const tracks = service.getAllTracks();

  const withPlayCount = tracks
    .filter((t) => t.PlayCount && parseInt(t.PlayCount || '0') > 0)
    .map((t) => ({
      trackId: t.TrackID,
      name: t.Name,
      artist: t.Artist,
      playCount: parseInt(t.PlayCount || '0'),
    }))
    .sort((a, b) => b.playCount - a.playCount)
    .slice(0, 100);

  const totalPlays = withPlayCount.reduce((sum, t) => sum + t.playCount, 0);

  return {
    success: true,
    topTracks: withPlayCount,
    totalPlays,
  };
}

/**
 * Get listening patterns
 */
export async function getListeningPatterns(): Promise<{
  success: boolean;
  patterns?: {
    averageBpm: number;
    dominantGenres: string[];
    dominantKeys: string[];
    averageRating: number;
    totalDuration: number;
  };
}> {
  const service = getLibraryService();
  const stats = service.getStats();

  if (stats.totalTracks === 0) {
    return { success: false, patterns: undefined };
  }

  // Calculate average BPM
  const bpms = service
    .getAllTracks()
    .map((t) => parseFloat(t.AverageBpm || '0'))
    .filter((b) => b > 0);

  const averageBpm = bpms.length > 0
    ? Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length)
    : 0;

  // Get top genres
  const genreCounts: Record<string, number> = {};
  for (const track of service.getAllTracks()) {
    if (track.Genre) {
      genreCounts[track.Genre] = (genreCounts[track.Genre] || 0) + 1;
    }
  }
  const dominantGenres = Object.entries(genreCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([g]) => g);

  // Calculate average rating
  const ratings = service
    .getAllTracks()
    .map((t) => parseInt(t.Rating || '0'))
    .filter((r) => r > 0);
  const averageRating = ratings.length > 0
    ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
    : 0;

  // Total duration in seconds
  const totalDuration = service
    .getAllTracks()
    .reduce((sum, t) => sum + (parseInt(t.TotalTime || '0') || 0), 0);

  return {
    success: true,
    patterns: {
      averageBpm,
      dominantGenres,
      dominantKeys: Object.entries(stats.keyDistribution)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([k]) => k),
      averageRating,
      totalDuration,
    },
  };
}
