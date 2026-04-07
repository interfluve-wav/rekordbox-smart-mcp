/**
 * Setlist Tools – smart playlist composition and analysis for DJs
 */

import { getLibraryService } from '../services/library.js';
import { ensureBackupBeforeWrite } from './backup.js';
import type { Track } from '../types.js';

interface BuildSmartPlaylistInput {
  playlistName: string;
  rules: {
    energy_curve?: 'wave' | 'ramp-up' | 'ramp-down' | 'flat';
    min_duration_minutes?: number;
    max_tracks?: number;
    bpm_range?: { min?: number; max?: number };
    key_progression?: 'smooth' | 'mixed' | 'random';
    include_tracks?: string[];
    exclude_tracks?: string[];
    preferred_genres?: string[];
    avoid_artist_repeat?: boolean;
  };
}

interface SetlistAnalysisInput {
  playlist_name?: string;
  track_ids?: string[];
}

interface TransitionSuggestionInput {
  playlist_name?: string;
  track_ids?: string[];
  limit_per_track?: number;
}

function camelotDistance(a: string, b: string): number {
  if (!a || !b) return 12;
  const aNum = parseInt(a.slice(0, -1), 10);
  const aMode = a.slice(-1);
  const bNum = parseInt(b.slice(0, -1), 10);
  const bMode = b.slice(-1);
  if (aMode === bMode) {
    const diff = Math.abs(aNum - bNum);
    return Math.min(diff, 12 - diff);
  }
  // Mixed mode (A to B or B to A) is considered distance 1 if numbers match
  return aNum === bNum ? 1 : 7;
}

function estimateEnergy(track: Track): number {
  // Simple energy proxy: BPM * (rating factor)
  const bpm = Number(track.AverageBpm || 0);
  const rating = track.ratingByte ? track.ratingByte / 51 : 0.5; // normalize to 0-1
  // Weighted: 70% BPM, 30% rating
  const normalizedBpm = Math.min((bpm - 60) / (180 - 60), 1); // normalize 60-180 BPM to 0-1
  return normalizedBpm * 0.7 + rating * 0.3;
}

export async function buildSmartPlaylist(input: BuildSmartPlaylistInput): Promise<{
  success: boolean;
  playlist?: any;
  stats?: {
    trackCount: number;
    estimatedDurationMinutes: number;
    bpmRange: { min: number; max: number };
    keyDistribution: Record<string, number>;
    averageEnergy: number;
  };
  error?: string;
  backup?: string;
}> {
  try {
    const backupPath = await ensureBackupBeforeWrite();
    const service = getLibraryService();
    const allTracks = service.getAllTracks();

    // Apply filters
    let candidates = allTracks.filter((t) => {
      // Exclusions
      if (input.rules.exclude_tracks?.includes(t.TrackID)) return false;
      if (input.rules.include_tracks?.includes(t.TrackID)) return true; // always include

      // BPM range
      if (input.rules.bpm_range) {
        const bpm = Number(t.AverageBpm || 0);
        if (input.rules.bpm_range.min !== undefined && bpm < input.rules.bpm_range.min) return false;
        if (input.rules.bpm_range.max !== undefined && bpm > input.rules.bpm_range.max) return false;
      }

      // Genre preference
      if (input.rules.preferred_genres && input.rules.preferred_genres.length > 0) {
        const trackGenre = (t.Genre || '').toLowerCase();
        const match = input.rules.preferred_genres.some((g) => trackGenre.includes(g.toLowerCase()));
        if (!match) return false;
      }

      return true;
    });

    // Ensure included tracks are present (even if they don't match filters)
    const included = input.rules.include_tracks
      ?.map((id) => allTracks.find((t) => t.TrackID === id))
      .filter((t): t is Track => !!t) || [];

    // Score tracks
    const scoredTracks = candidates.map((track) => {
      const score = estimateEnergy(track);
      return { track, score };
    });

    // Sort by energy (initial ordering)
    scoredTracks.sort((a, b) => a.score - b.score);

    // Build ordered list respecting energy curve and constraints
    const selectedTracks: Track[] = [...included];
    const usedTrackIds = new Set(included.map((t) => t.TrackID));
    const usedArtists = new Set<string>();
    let currentIndex = 0;

    // Energy curve shaping
    const totalWanted = input.rules.max_tracks || 50;
    const minDuration = input.rules.min_duration_minutes;

    while (selectedTracks.length < totalWanted) {
      // Determine target energy for this position (0 to 1)
      const progress = selectedTracks.length / totalWanted;
      let targetEnergy: number;
      switch (input.rules.energy_curve) {
        case 'ramp-up':
          targetEnergy = progress;
          break;
        case 'ramp-down':
          targetEnergy = 1 - progress;
          break;
        case 'wave':
          // Sinusoidal: start low, peak at 25%, trough at 75%
          targetEnergy = 0.5 + 0.5 * Math.sin(2 * Math.PI * progress * 2 - Math.PI / 2);
          break;
        case 'flat':
        default:
          targetEnergy = 0.5 + (progress < 0.5 ? 0.2 : -0.2);
      }

      // Find best candidate near target energy that hasn't been used
      let bestCandidate: { track: Track; score: number } | null = null;
      let bestDistance = Infinity;

      for (const candidate of scoredTracks) {
        if (usedTrackIds.has(candidate.track.TrackID)) continue;

        // Artist diversity check
        if (input.rules.avoid_artist_repeat) {
          const artist = (candidate.track.Artist || '').toLowerCase();
          if (usedArtists.has(artist)) continue;
        }

        const distance = Math.abs(candidate.score - targetEnergy);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestCandidate = candidate;
        }
      }

      if (!bestCandidate) break; // no more candidates

      selectedTracks.push(bestCandidate.track);
      usedTrackIds.add(bestCandidate.track.TrackID);
      if (input.rules.avoid_artist_repeat) {
        usedArtists.add((bestCandidate.track.Artist || '').toLowerCase());
      }

      // Early exit if duration met
      if (minDuration) {
        const totalSec = selectedTracks.reduce((sum, t) => sum + Number(t.TotalTime || 0), 0);
        if (totalSec >= minDuration * 60) break;
      }
    }

    // Apply key progression smoothing if requested
    if (input.rules.key_progression === 'smooth' && selectedTracks.length > 1) {
      // Simple local reordering: try to swap adjacent tracks to improve harmonic distance
      let improved = true;
      let passes = 0;
      while (improved && passes < 3) {
        improved = false;
        for (let i = 0; i < selectedTracks.length - 2; i++) {
          const a = selectedTracks[i];
          const b = selectedTracks[i + 1];
          const c = selectedTracks[i + 2];
          const aKey = a.Key || a.Tonality || '';
          const bKey = b.Key || b.Tonality || '';
          const cKey = c.Key || c.Tonality || '';
          const distAB = camelotDistance(aKey, bKey);
          const distBC = camelotDistance(bKey, cKey);
          const distAC = camelotDistance(aKey, cKey);

          // If A->C is better than A->B + B->C, swap B and C
          if (distAC < distAB + distBC) {
            // Swap b and c
            selectedTracks[i + 1] = c;
            selectedTracks[i + 2] = b;
            improved = true;
          }
        }
        passes++;
      }
    }

    // Create playlist using service directly (avoid double-backup)
    const playlist = service.createPlaylist(input.playlistName);
    const trackIds = selectedTracks.map((t) => t.TrackID);
    service.addTracksToPlaylist(input.playlistName, trackIds, 'add');

    // Compute stats
    const totalDuration = selectedTracks.reduce((sum, t) => sum + Number(t.TotalTime || 0), 0);
    const bpms = selectedTracks.map((t) => Number(t.AverageBpm || 0)).filter((b) => b > 0);
    const keyDist: Record<string, number> = {};
    for (const t of selectedTracks) {
      const key = t.Key || t.Tonality || 'Unknown';
      keyDist[key] = (keyDist[key] || 0) + 1;
    }
    const avgEnergy = selectedTracks.reduce((sum, t) => sum + estimateEnergy(t), 0) / selectedTracks.length;

    return {
      success: true,
      playlist,
      stats: {
        trackCount: selectedTracks.length,
        estimatedDurationMinutes: Math.round(totalDuration / 60),
        bpmRange: { min: Math.min(...bpms), max: Math.max(...bpms) },
        keyDistribution: keyDist,
        averageEnergy: Number(avgEnergy.toFixed(3)),
      },
      backup: backupPath,
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function analyzeSetlist(input: SetlistAnalysisInput): Promise<{
  success: boolean;
  analysis?: {
    playlistName?: string;
    trackCount: number;
    totalDurationMinutes: number;
    avgBpm: number;
    bpmRange: { min: number; max: number };
    keyDistribution: Record<string, number>;
    genreDiversityScore: number;
    harmonicCompatibilityScore: number;
    energyCurve: Array<{ index: number; bpm: number; key?: string; transitionScore: number }>;
    gaps: Array<{ from: number; to: number; bpmJump: number; severity: 'low' | 'medium' | 'high' }>;
    artistConcentration: { topArtists: Array<{ artist: string; count: number }>; diversityScore: number };
    recommendations: string[];
  };
  error?: string;
}> {
  try {
    const service = getLibraryService();
    let tracks: Track[];

    if (input.track_ids) {
      tracks = input.track_ids.map((id) => service.getTrackById(id)).filter((t): t is Track => !!t);
    } else if (input.playlist_name) {
      const playlist = service.getPlaylistByName(input.playlist_name);
      if (!playlist) {
        return { success: false, error: `Playlist not found: ${input.playlist_name}` };
      }
      tracks = playlist.Entries.map((id) => service.getTrackById(id)).filter((t): t is Track => !!t);
    } else {
      return { success: false, error: 'Must provide either playlist_name or track_ids' };
    }

    if (tracks.length === 0) {
      return { success: false, error: 'No tracks found' };
    }

    // Basic stats
    const totalDuration = tracks.reduce((sum, t) => sum + Number(t.TotalTime || 0), 0);
    const bpms = tracks.map((t) => Number(t.AverageBpm || 0)).filter((b) => b > 0);
    const keyDist: Record<string, number> = {};
    for (const t of tracks) {
      const key = t.Key || t.Tonality || 'Unknown';
      keyDist[key] = (keyDist[key] || 0) + 1;
    }

    // Artist concentration
    const artistCounts: Record<string, number> = {};
    for (const t of tracks) {
      const a = (t.Artist || 'Unknown').toLowerCase();
      artistCounts[a] = (artistCounts[a] || 0) + 1;
    }
    const sortedArtists = Object.entries(artistCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const artistDiversity = 1 - (sortedArtists.reduce((sum, [, count]) => sum + count, 0) / tracks.length) * (1 - 1 / Math.sqrt(tracks.length));

    // Genre diversity (simple distinct count normalized)
    const genres = new Set(tracks.map((t) => t.Genre || 'Unknown'));
    const genreDiversity = genres.size / tracks.length;

    // Harmonic compatibility (consecutive tracks)
    let harmonicHits = 0;
    const energyCurve: Array<{ index: number; bpm: number; key?: string; transitionScore: number }> = [];
    const gaps: Array<{ from: number; to: number; bpmJump: number; severity: 'low' | 'medium' | 'high' }> = [];

    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      const bpm = Number(t.AverageBpm || 0);
      const key = t.Key || t.Tonality || '';
      energyCurve.push({ index: i, bpm, key, transitionScore: 0 });

      if (i > 0) {
        const prev = tracks[i - 1];
        const prevKey = prev.Key || prev.Tonality || '';
        const dist = camelotDistance(prevKey, key);
        const isCompatible = dist <= 1;
        if (isCompatible) harmonicHits++;
        energyCurve[i].transitionScore = isCompatible ? 1 : 0;

        const bpmDiff = Math.abs(bpm - Number(prev.AverageBpm || 0));
        if (bpmDiff > 20) {
          gaps.push({
            from: i - 1,
            to: i,
            bpmJump: Math.round(bpmDiff),
            severity: bpmDiff > 40 ? 'high' : bpmDiff > 20 ? 'medium' : 'low',
          });
        }
      }
    }
    const harmonicScore = tracks.length > 1 ? harmonicHits / (tracks.length - 1) : 1;

    // Recommendations
    const recommendations: string[] = [];
    if (harmonicScore < 0.6) {
      recommendations.push('Harmonic compatibility is low. Consider mixing tracks in compatible Camelot keys (±1).');
    }
    if (gaps.length > tracks.length * 0.3) {
      recommendations.push('Many large BPM jumps. Sort by BPM or add transitional tracks to smooth mixing.');
    }
    if (sortedArtists[0] && sortedArtists[0][1] > tracks.length * 0.3) {
      recommendations.push(`Artist "${sortedArtists[0][0]}" appears ${sortedArtists[0][1]} times – consider more variety.`);
    }
    if (genreDiversity < 0.5) {
      recommendations.push('Genre diversity is low. Mix in different styles to keep the set interesting.');
    }

    return {
      success: true,
      analysis: {
        playlistName: input.playlist_name,
        trackCount: tracks.length,
        totalDurationMinutes: Math.round(totalDuration / 60),
        avgBpm: Number((bpms.length ? bpms.reduce((a, b) => a + b, 0) / bpms.length : 0).toFixed(1)),
        bpmRange: { min: Math.min(...bpms), max: Math.max(...bpms) },
        keyDistribution: keyDist,
        genreDiversityScore: Number(genreDiversity.toFixed(2)),
        harmonicCompatibilityScore: Number(harmonicScore.toFixed(2)),
        energyCurve,
        gaps,
        artistConcentration: { topArtists: sortedArtists.map(([artist, count]) => ({ artist, count })), diversityScore: Number(artistDiversity.toFixed(2)) },
        recommendations,
      },
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function suggestTransitions(input: TransitionSuggestionInput): Promise<{
  success: boolean;
  suggestions?: Array<{
    currentTrack: { id: string; name: string; artist: string };
    nextTrack: { id: string; name: string; artist: string; bpm: number; key?: string };
    compatibilityScore: number;
    transitionType: 'perfect' | 'good' | 'acceptable' | 'poor';
    mixTip: string;
  }>;
  error?: string;
}> {
  try {
    const service = getLibraryService();
    let tracks: Track[];

    if (input.track_ids) {
      tracks = input.track_ids.map((id) => service.getTrackById(id)).filter((t): t is Track => !!t);
    } else if (input.playlist_name) {
      const playlist = service.getPlaylistByName(input.playlist_name);
      if (!playlist) {
        return { success: false, error: `Playlist not found: ${input.playlist_name}` };
      }
      tracks = playlist.Entries.map((id) => service.getTrackById(id)).filter((t): t is Track => !!t);
    } else {
      return { success: false, error: 'Must provide either playlist_name or track_ids' };
    }

    const limit = input.limit_per_track || 3;
    const allTracks = service.getAllTracks();
    const suggestions: Array<{
      currentTrack: { id: string; name: string; artist: string };
      nextTrack: { id: string; name: string; artist: string; bpm: number; key?: string };
      compatibilityScore: number;
      transitionType: 'perfect' | 'good' | 'acceptable' | 'poor';
      mixTip: string;
    }> = [];

    for (let i = 0; i < tracks.length - 1; i++) {
      const current = tracks[i];
      const candidates: Array<{ track: Track; score: number }> = [];

      for (const candidate of allTracks) {
        if (candidate.TrackID === current.TrackID) continue;
        // Already in set?
        if (tracks.some((t) => t.TrackID === candidate.TrackID)) continue;

        // Compute compatibility
        const currentKey = current.Key || current.Tonality || '';
        const candidateKey = candidate.Key || candidate.Tonality || '';
        const keyDist = camelotDistance(currentKey, candidateKey);
        const bpmDiff = Math.abs(Number(candidate.AverageBpm || 0) - Number(current.AverageBpm || 0));

        // Score: key compatibility (0-1), BPM proximity (0-1), rating bonus
        let score = 0;
        if (keyDist === 0) score += 0.6;
        else if (keyDist === 1) score += 0.4;
        else score += 0.1;

        // BPM proximity: max score at 0 diff, decays after 10 BPM diff
        const bpmScore = bpmDiff <= 5 ? 0.3 : bpmDiff <= 15 ? 0.2 : bpmDiff <= 30 ? 0.1 : 0;
        score += bpmScore;

        // Rating bonus
        if (candidate.ratingByte) {
          score += (candidate.ratingByte / 255) * 0.1;
        }

        candidates.push({ track: candidate, score });
      }

      candidates.sort((a, b) => b.score - a.score);
      const topCandidates = candidates.slice(0, limit);

      for (const { track: next, score } of topCandidates) {
        const currentKey = current.Key || current.Tonality || '';
        const nextKey = next.Key || next.Tonality || '';
        const keyDist = camelotDistance(currentKey, nextKey);
        const bpmDiff = Math.abs(Number(next.AverageBpm || 0) - Number(current.AverageBpm || 0));

        let transitionType: 'perfect' | 'good' | 'acceptable' | 'poor';
        let mixTip = '';

        if (keyDist === 0 && bpmDiff <= 5) {
          transitionType = 'perfect';
          mixTip = 'Perfect harmonic match – mix in any style, 32+ bars';
        } else if (keyDist <= 1 && bpmDiff <= 10) {
          transitionType = 'good';
          mixTip = 'Good harmonic compatibility – blend or cut at phrase';
        } else if (keyDist <= 2 || bpmDiff <= 20) {
          transitionType = 'acceptable';
          mixTip = bpmDiff > 20 ? 'Use echo/tape delay to mask BPM difference' : 'Mix with careful EQ';
        } else {
          transitionType = 'poor';
          mixTip = 'Hard transition – consider using a bridging track or effects';
        }

        suggestions.push({
          currentTrack: { id: current.TrackID, name: current.Name, artist: current.Artist },
          nextTrack: { id: next.TrackID, name: next.Name, artist: next.Artist, bpm: Number(next.AverageBpm), key: nextKey },
          compatibilityScore: Number(score.toFixed(3)),
          transitionType,
          mixTip,
        });
      }
    }

    return { success: true, suggestions };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
