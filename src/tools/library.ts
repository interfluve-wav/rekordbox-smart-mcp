/**
 * Library Tools - MCP tools for library search and management
 */

import { getLibraryService } from '../services/library.js';
import type { SearchInput, SearchOutput, Track } from '../types.js';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { getConfig } from '../config.js';
import { ensureBackupBeforeWrite } from './backup.js';

const CAMELOT_CODES = ['1A', '2A', '3A', '4A', '5A', '6A', '7A', '8A', '9A', '10A', '11A', '12A', '1B', '2B', '3B', '4B', '5B', '6B', '7B', '8B', '9B', '10B', '11B', '12B'] as const;
type CamelotCode = (typeof CAMELOT_CODES)[number];

const KEY_TO_CAMELOT: Record<string, CamelotCode> = {
  'abm': '1A', 'g#m': '1A',
  'ebm': '2A', 'd#m': '2A',
  'bbm': '3A', 'a#m': '3A',
  'fm': '4A',
  'cm': '5A',
  'gm': '6A',
  'dm': '7A',
  'am': '8A',
  'em': '9A',
  'bm': '10A',
  'f#m': '11A', 'gbm': '11A',
  'c#m': '12A', 'dbm': '12A',
  'b': '1B',
  'f#': '2B', 'gb': '2B',
  'db': '3B', 'c#': '3B',
  'ab': '4B', 'g#': '4B',
  'eb': '5B', 'd#': '5B',
  'bb': '6B', 'a#': '6B',
  'f': '7B',
  'c': '8B',
  'g': '9B',
  'd': '10B',
  'a': '11B',
  'e': '12B',
};

function normalizeKey(input?: string): string {
  return (input || '').trim().toLowerCase().replace(/\s+/g, '');
}

function toCamelot(input?: string): CamelotCode | null {
  const normalized = normalizeKey(input);
  if (!normalized) return null;
  const camelotMatch = normalized.match(/^(1[0-2]|[1-9])[ab]$/i);
  if (camelotMatch) return normalized.toUpperCase() as CamelotCode;
  return KEY_TO_CAMELOT[normalized] || null;
}

function adjacentCamelot(code: CamelotCode): CamelotCode[] {
  const num = parseInt(code.slice(0, -1), 10);
  const mode = code.slice(-1) as 'A' | 'B';
  const prev = num === 1 ? 12 : num - 1;
  const next = num === 12 ? 1 : num + 1;
  return [`${prev}${mode}` as CamelotCode, `${next}${mode}` as CamelotCode, `${num}${mode === 'A' ? 'B' : 'A'}` as CamelotCode];
}

/**
 * Search the music library
 * 
 * @example
 * // Search for tracks with query
 * await tools.library_search({ query: "Daft Punk" })
 * 
 * // Search with filters
 * await tools.library_search({ 
 *   filters: { genre: "House", bpm: { min: 120, max: 130 } },
 *   sort: { column: "bpm", direction: "asc" }
 * })
 */
export async function searchLibrary(input: SearchInput): Promise<SearchOutput> {
  const service = getLibraryService();

  const result = service.search({
    filters: {
      query: input.query,
      genre: input.filters?.genre,
      artist: input.filters?.artist,
      album: input.filters?.album,
      bpm: input.filters?.bpm,
      key: input.filters?.key,
      year: input.filters?.year,
      rating: input.filters?.rating,
      playlist: input.filters?.playlist,
      missing: input.filters?.missing,
      hasArt: input.filters?.hasArt,
      hasComments: input.filters?.hasComments,
      hasGenre: input.filters?.hasGenre,
    },
    sort: input.sort ? {
      column: input.sort.column as any,
      direction: input.sort.direction,
    } : undefined,
    limit: input.limit || 100,
    offset: input.offset || 0,
  });

  return {
    tracks: result.tracks,
    total: result.total,
    offset: input.offset || 0,
  };
}

/**
 * Get library statistics
 */
export async function getLibraryStats(): Promise<{
  totalTracks: number;
  totalPlaylists: number;
  genres: string[];
  artists: string[];
  bpmRange: { min: number; max: number };
  keyDistribution: Record<string, number>;
}> {
  const service = getLibraryService();
  return service.getStats();
}

/**
 * List all playlists
 */
export async function listPlaylists(): Promise<{ playlists: any[]; total: number }> {
  const service = getLibraryService();
  const playlists = service.getAllPlaylists();
  return { playlists, total: playlists.length };
}

/**
 * Load library from Rekordbox XML file
 */
export async function loadLibrary(input: { xmlPath?: string } = {}): Promise<{ success: boolean; message: string; backup?: string }> {
  try {
    const backupPath = await ensureBackupBeforeWrite();
    const config = getConfig();
    const xmlPath = input.xmlPath || config.library.default_xml_path;

    if (!xmlPath) {
      return {
        success: false,
        message: 'No XML path provided and no default set. Please provide xmlPath to library_load or set default via library_setDefaultPath.'
      };
    }

    const service = getLibraryService();
    service.loadFromXML(xmlPath);

    // Set as default if explicit path was provided
    if (input.xmlPath) {
      try {
        const { setDefaultXmlPath } = await import('../config.js');
        const result = setDefaultXmlPath(input.xmlPath);
        if (result.success) {
          console.error(`[config] ${result.message}`);
        }
      } catch (err) {
        // Config update failed, but load succeeded – continue
        console.error(`[config] Warning: could not persist default path: ${(err as Error).message}`);
      }
    }

    return {
      success: true,
      message: `Loaded library with ${service.getAllTracks().length} tracks`,
      backup: backupPath,
    };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

/**
 * Set the default XML library path. This path will be used by library_load when no explicit path is provided.
 */
export async function setDefaultXmlPath(xmlPath: string): Promise<{ success: boolean; message: string }> {
  try {
    const { setDefaultXmlPath: setConfigDefault } = await import('../config.js');
    const result = setConfigDefault(xmlPath);
    return result;
  } catch (err: any) {
    return { success: false, message: err.message || String(err) };
  }
}

function normalizeLocation(location?: string): string {
  if (!location) return '';
  const normalized = location
    .replace(/^file:\/\/localhost/i, '')
    .replace(/^file:\/\//i, '')
    .trim();
  try {
    return decodeURIComponent(normalized);
  } catch {
    return normalized;
  }
}

export async function findMissingFiles(): Promise<{ total: number; missing: Track[] }> {
  const service = getLibraryService();
  const tracks = service.getAllTracks();
  const missing = tracks.filter((track) => {
    const loc = normalizeLocation(track.Location);
    return !!loc && !existsSync(loc);
  });
  return { total: missing.length, missing };
}

export async function findDuplicates(): Promise<{
  byLocation: Array<{ key: string; tracks: Track[] }>;
  byArtistTitle: Array<{ key: string; tracks: Track[] }>;
}> {
  const service = getLibraryService();
  const tracks = service.getAllTracks();

  const byLocationMap = new Map<string, Track[]>();
  const byArtistTitleMap = new Map<string, Track[]>();

  for (const track of tracks) {
    const locKey = normalizeLocation(track.Location).toLowerCase();
    if (locKey) {
      const arr = byLocationMap.get(locKey) || [];
      arr.push(track);
      byLocationMap.set(locKey, arr);
    }

    const atKey = `${(track.Artist || '').toLowerCase()}::${(track.Name || '').toLowerCase()}`;
    if (track.Artist || track.Name) {
      const arr = byArtistTitleMap.get(atKey) || [];
      arr.push(track);
      byArtistTitleMap.set(atKey, arr);
    }
  }

  return {
    byLocation: [...byLocationMap.entries()]
      .filter(([, list]) => list.length > 1)
      .map(([key, list]) => ({ key, tracks: list })),
    byArtistTitle: [...byArtistTitleMap.entries()]
      .filter(([, list]) => list.length > 1)
      .map(([key, list]) => ({ key, tracks: list })),
  };
}

function scoreFuzzy(query: string, text: string): number {
  const q = query.toLowerCase().trim();
  const t = text.toLowerCase();
  if (!q || !t) return 0;
  if (t.includes(q)) return 100 - (t.indexOf(q) * 0.1);

  let qi = 0;
  let matchCount = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      matchCount += 1;
      qi += 1;
    }
  }
  return (matchCount / q.length) * 60;
}

export async function fuzzySearchLibrary(input: {
  query: string;
  limit?: number;
}): Promise<{ total: number; tracks: Array<Track & { _score: number }> }> {
  const service = getLibraryService();
  const tracks = service.getAllTracks();
  const limit = input.limit || 50;
  const query = input.query || '';

  const scored = tracks
    .map((track) => {
      const text = [track.Name, track.Artist, track.Album, track.Genre].filter(Boolean).join(' ');
      const _score = scoreFuzzy(query, text);
      return { ...track, _score };
    })
    .filter((track) => track._score > 15)
    .sort((a, b) => b._score - a._score);

  return { total: scored.length, tracks: scored.slice(0, limit) };
}

export async function searchNaturalLanguage(input: {
  query: string;
  limit?: number;
  offset?: number;
  xmlPath?: string;
}): Promise<SearchOutput & { mode: 'library' }> {
  const service = getLibraryService();
  const currentTracks = service.getAllTracks();
  if (input.xmlPath) {
    service.loadFromXML(input.xmlPath);
  } else if (currentTracks.length === 0) {
    const configuredPath = getConfig().library.xml_path;
    if (configuredPath) {
      service.loadFromXML(configuredPath);
    }
  }
  const rawQuery = (input.query || '').trim();
  const normalized = rawQuery.toLowerCase();

  let bpmRange: { min?: number; max?: number } | undefined;
  const rangeMatch = normalized.match(/\b(\d{2,3})\s*(?:-|to)\s*(\d{2,3})\b/);
  if (rangeMatch) {
    const a = parseInt(rangeMatch[1], 10);
    const b = parseInt(rangeMatch[2], 10);
    bpmRange = { min: Math.min(a, b), max: Math.max(a, b) };
  } else {
    const aroundMatch = normalized.match(/\b(?:around|~)\s*(\d{2,3})\s*bpm?\b/);
    if (aroundMatch) {
      const center = parseInt(aroundMatch[1], 10);
      bpmRange = { min: center - 3, max: center + 3 };
    }
  }

  const knownGenres = new Set(service.getStats().genres.map((genre) => genre.toLowerCase()));
  const genreTokens = normalized
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const matchedGenres = genreTokens.filter((token) => knownGenres.has(token));
  const genre = matchedGenres.length === 1 ? matchedGenres[0] : matchedGenres.length > 1 ? matchedGenres : undefined;

  const stripped = rawQuery
    .replace(/\b\d{2,3}\s*(?:-|to)\s*\d{2,3}\b/gi, ' ')
    .replace(/\b(?:around|~)\s*\d{2,3}\s*bpm?\b/gi, ' ')
    .split(/[,\n]/)
    .filter((part) => !knownGenres.has(part.trim().toLowerCase()))
    .join(' ')
    .trim();

  const result = await searchLibrary({
    query: stripped || undefined,
    filters: {
      bpm: bpmRange,
      genre,
    },
    limit: input.limit || 50,
    offset: input.offset || 0,
  });
  return { ...result, mode: 'library' };
}

export async function searchKeyCompatible(input: {
  key: string;
  includeEnergyAdjacent?: boolean;
  limit?: number;
  offset?: number;
  xmlPath?: string;
}): Promise<{ total: number; offset: number; compatibleKeys: string[]; tracks: Track[] }> {
  const service = getLibraryService();
  const currentTracks = service.getAllTracks();
  if (input.xmlPath) {
    service.loadFromXML(input.xmlPath);
  } else if (currentTracks.length === 0) {
    const configuredPath = getConfig().library.xml_path;
    if (configuredPath) {
      service.loadFromXML(configuredPath);
    }
  }
  const source = toCamelot(input.key);
  if (!source) {
    return { total: 0, offset: input.offset || 0, compatibleKeys: [], tracks: [] };
  }
  const compatibles = new Set<CamelotCode>([source]);
  for (const key of adjacentCamelot(source)) compatibles.add(key);
  if (input.includeEnergyAdjacent) {
    for (const key of [...compatibles]) {
      for (const neighbor of adjacentCamelot(key)) compatibles.add(neighbor);
    }
  }
  const compatibleKeys = [...compatibles];
  const allTracks = service.getAllTracks();
  const matched = allTracks.filter((track) => {
    const trackKey = toCamelot(track.Key || track.Tonality);
    return !!trackKey && compatibles.has(trackKey);
  });
  const offset = input.offset || 0;
  const limit = input.limit || 50;
  return {
    total: matched.length,
    offset,
    compatibleKeys,
    tracks: matched.slice(offset, offset + limit),
  };
}

function tracksToCsv(tracks: Track[]): string {
  const columns = ['TrackID', 'Name', 'Artist', 'Album', 'Genre', 'AverageBpm', 'Key', 'Rating', 'Location'];
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const rows = [columns.join(',')];
  for (const track of tracks) {
    rows.push(
      columns
        .map((col) => escape((track as any)[col]))
        .join(','),
    );
  }
  return rows.join('\n');
}

export async function exportLibraryCsv(outputPath?: string): Promise<{ success: boolean; csv?: string; outputPath?: string; message?: string }> {
  const service = getLibraryService();
  const tracks = service.getAllTracks();
  const csv = tracksToCsv(tracks);
  if (!outputPath) {
    return { success: true, csv, message: `Generated CSV for ${tracks.length} tracks` };
  }
  const resolvedPath = resolve(outputPath);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  writeFileSync(resolvedPath, csv, 'utf-8');
  return { success: true, outputPath: resolvedPath, message: `Exported CSV to ${resolvedPath}` };
}

export async function exportLibraryJson(outputPath?: string): Promise<{ success: boolean; json?: string; outputPath?: string; message?: string }> {
  const service = getLibraryService();
  const payload = JSON.stringify({ tracks: service.getAllTracks(), playlists: service.getAllPlaylists() }, null, 2);
  if (!outputPath) {
    return { success: true, json: payload, message: 'Generated JSON export in-memory' };
  }
  const resolvedPath = resolve(outputPath);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  writeFileSync(resolvedPath, payload, 'utf-8');
  return { success: true, outputPath: resolvedPath, message: `Exported JSON to ${resolvedPath}` };
}
