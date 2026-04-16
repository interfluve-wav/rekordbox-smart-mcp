/**
 * Library Service - Manages the track library and search
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import { RekordboxParser } from './xmlParser.js';
import type { Track, Playlist, RekordboxLibrary, SearchFilters, SearchOptions } from '../types.js';
import { getConfig } from '../config.js';
import { setScanCache } from './bpmCache.js';

const CACHE_DIR = resolve(homedir(), '.bonk');
const CACHE_FILE = resolve(CACHE_DIR, 'library-state.json');

/**
 * Normalize Rekordbox BPM: if the raw value is > 180, halve it.
 * Rekordbox stores BPM at 2x actual tempo for ~27% of tracks (dubstep,
 * drum-and-bass, and other half-tempo genres). Threshold of 180 BPM
 * is well above any realistic DJ-library track tempo.
 * See: https://github.com/interfluve-wav/dj-metadata-paper
 */
function normalizeBpm(rawBpm: number): number {
  if (Number.isFinite(rawBpm) && rawBpm > 180) {
    return rawBpm / 2;
  }
  return rawBpm;
}

export class LibraryService {
  private library: RekordboxLibrary | null = null;
  private parser: RekordboxParser;
  private searchIndex: Map<string, Track> = new Map();
  private static readonly IGNORED_STOCK_TRACK_NAMES = new Set(['NOISE', 'SINEWAVE', 'SIREN', 'HORN']);
  private static readonly IGNORED_ARTISTS = new Set(['REKORDBOX']);
  // Optional: add location prefixes to ignore (e.g., ['/path/to/Sampler/']). Default empty.
  private static readonly IGNORED_LOCATION_PREFIXES: string[] = [];

  constructor() {
    this.parser = new RekordboxParser();
    // Try to restore from cache on startup so state survives across stdio restarts
    this.loadFromCache();
  }

  /**
   * Load library from Rekordbox XML file
   */
  loadFromXML(xmlPath: string): void {
    const resolvedPath = resolve(xmlPath);
    if (!existsSync(resolvedPath)) {
      throw new Error(`XML file not found: ${resolvedPath}`);
    }

    console.error(`[library] Loading from ${resolvedPath}`);
    this.library = this.sanitizeLibrary(this.parser.parseFromFile(resolvedPath));
    this.syncScanCacheFromTracks(this.library.tracks);
    this.rebuildSearchIndex();
    console.error(`[library] Loaded ${this.library.tracks.length} tracks, ${this.library.playlists.length} playlists`);
    this.saveToCache();
  }

  /**
   * Load library from in-memory data.
   */
  loadFromData(library: RekordboxLibrary): void {
    this.library = this.sanitizeLibrary(library);
    this.syncScanCacheFromTracks(this.library.tracks);
    this.rebuildSearchIndex();
    console.error(`[library] Loaded ${this.library.tracks.length} tracks, ${this.library.playlists.length} playlists`);
    this.saveToCache();
  }

  /**
   * Remove known Rekordbox stock sampler sounds and clean playlist entries.
   */
  private sanitizeLibrary(library: RekordboxLibrary): RekordboxLibrary {
    const ignoredTrackIds = new Set<string>();
    const tracks = library.tracks.filter((track) => {
      const normalizedName = (track.Name || '').trim().toUpperCase();
      const normalizedArtist = (track.Artist || '').trim().toUpperCase();
      const normalizedLocation = this.normalizeLocation(track.Location);
      const isIgnoredByLocation = LibraryService.IGNORED_LOCATION_PREFIXES.some((prefix) =>
        normalizedLocation.startsWith(prefix),
      );
      const isIgnored =
        LibraryService.IGNORED_STOCK_TRACK_NAMES.has(normalizedName) ||
        LibraryService.IGNORED_ARTISTS.has(normalizedArtist) ||
        isIgnoredByLocation;
      if (isIgnored) {
        ignoredTrackIds.add(track.TrackID);
      }
      return !isIgnored;
    });

    const sanitizePlaylists = (playlists: Playlist[]): Playlist[] =>
      playlists.map((playlist) => ({
        ...playlist,
        Entries: playlist.Entries.filter((trackId) => !ignoredTrackIds.has(trackId)),
        Children: sanitizePlaylists(playlist.Children),
      }));

    return {
      tracks,
      playlists: sanitizePlaylists(library.playlists),
    };
  }

  private normalizeLocation(location?: string): string {
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

  private syncScanCacheFromTracks(tracks: Track[]): void {
    for (const track of tracks) {
      const filePath = this.normalizeLocation(track.Location);
      if (!filePath || !existsSync(filePath)) continue;
      const rawBpm = Number(track.AverageBpm || '');
      const bpm = normalizeBpm(rawBpm);
      setScanCache(filePath, {
        trackId: track.TrackID || null,
        key: track.Key || track.Tonality || null,
        genre: track.Genre || null,
        bpm: Number.isFinite(bpm) && bpm > 0 ? bpm : null,
        source: 'library-import',
        analyzerVersion: 'library-v1',
      });
    }
  }

  /**
   * Rebuild the search index for fast lookups
   */
  private rebuildSearchIndex(): void {
    if (!this.library) return;

    this.searchIndex.clear();
    for (const track of this.library.tracks) {
      this.searchIndex.set(track.TrackID, track);
    }
  }

  /**
   * Persist library state to cache file so it survives across stdio process restarts.
   */
  private saveToCache(): void {
    if (!this.library) return;
    try {
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(CACHE_FILE, JSON.stringify(this.library), 'utf-8');
      console.error(`[library] Cached ${this.library.tracks.length} tracks to ${CACHE_FILE}`);
    } catch (err) {
      console.error(`[library] Failed to write cache: ${err}`);
    }
  }

  /**
   * Load library state from cache file. Returns true if cache was found and loaded.
   */
  private loadFromCache(): boolean {
    if (!existsSync(CACHE_FILE)) return false;
    try {
      const data = JSON.parse(readFileSync(CACHE_FILE, 'utf-8')) as RekordboxLibrary;
      if (!data?.tracks?.length) return false;
      this.library = data;
      this.rebuildSearchIndex();
      this.syncScanCacheFromTracks(this.library.tracks);
      console.error(`[library] Restored ${this.library.tracks.length} tracks from cache`);
      return true;
    } catch (err) {
      console.error(`[library] Failed to load cache: ${err}`);
      return false;
    }
  }

  /**
   * Get all tracks
   */
  getAllTracks(): Track[] {
    return this.library?.tracks || [];
  }

  /**
   * Get all playlists
   */
  getAllPlaylists(): Playlist[] {
    return this.library?.playlists || [];
  }

  /**
   * Find playlist by name (depth-first)
   */
  getPlaylistByName(name: string): Playlist | undefined {
    if (!this.library) return undefined;
    return this.findPlaylistByName(this.library.playlists, name);
  }

  private findPlaylistByName(nodes: Playlist[], name: string): Playlist | undefined {
    for (const node of nodes) {
      if (node.Name === name) return node;
      const child = this.findPlaylistByName(node.Children, name);
      if (child) return child;
    }
    return undefined;
  }

  /**
   * Create a new playlist under root or a specific parent folder.
   */
  createPlaylist(name: string, parentName?: string): Playlist {
    if (!this.library) {
      throw new Error('No library loaded');
    }
    if (!name?.trim()) {
      throw new Error('Playlist name is required');
    }
    if (this.getPlaylistByName(name)) {
      throw new Error(`Playlist already exists: ${name}`);
    }

    const playlist: Playlist = {
      Name: name,
      Type: '1',
      KeyType: '0',
      Entries: [],
      Children: [],
    };

    const parent = parentName ? this.getPlaylistByName(parentName) : undefined;
    if (parentName && !parent) {
      throw new Error(`Parent playlist/folder not found: ${parentName}`);
    }
    if (parent && parent.Type === '1') {
      throw new Error('Cannot create a child under a normal playlist (parent must be a folder)');
    }

    if (parent) {
      parent.Children.push(playlist);
      return playlist;
    }

    const root = this.getPlaylistByName('ROOT');
    if (root && root.Type === '0') {
      root.Children.push(playlist);
    } else {
      this.library.playlists.push(playlist);
    }

    return playlist;
  }

  /**
   * Add/replace tracks in a playlist.
   */
  addTracksToPlaylist(playlistName: string, trackIds: string[], mode: 'add' | 'replace' = 'add'): number {
    if (!this.library) {
      throw new Error('No library loaded');
    }
    const playlist = this.getPlaylistByName(playlistName);
    if (!playlist) {
      throw new Error(`Playlist not found: ${playlistName}`);
    }
    if (playlist.Type !== '1') {
      throw new Error(`Target is not a playlist: ${playlistName}`);
    }

    const validIds = trackIds.filter((id) => !!this.getTrackById(id));
    if (mode === 'replace') {
      playlist.Entries = [...new Set(validIds)];
      return playlist.Entries.length;
    }

    const beforeCount = playlist.Entries.length;
    const merged = new Set(playlist.Entries);
    for (const id of validIds) merged.add(id);
    playlist.Entries = Array.from(merged);
    return playlist.Entries.length - beforeCount;
  }

  /**
   * Remove tracks from a playlist.
   */
  removeTracksFromPlaylist(playlistName: string, trackIds: string[]): number {
    if (!this.library) {
      throw new Error('No library loaded');
    }
    const playlist = this.getPlaylistByName(playlistName);
    if (!playlist) {
      throw new Error(`Playlist not found: ${playlistName}`);
    }
    if (playlist.Type !== '1') {
      throw new Error(`Target is not a playlist: ${playlistName}`);
    }

    const removeSet = new Set(trackIds);
    const before = playlist.Entries.length;
    playlist.Entries = playlist.Entries.filter((id) => !removeSet.has(id));
    return before - playlist.Entries.length;
  }

  /**
   * Delete playlist by name.
   */
  deletePlaylist(playlistName: string): boolean {
    if (!this.library) {
      throw new Error('No library loaded');
    }
    return this.removePlaylistByName(this.library.playlists, playlistName);
  }

  private removePlaylistByName(nodes: Playlist[], name: string): boolean {
    const idx = nodes.findIndex((n) => n.Name === name);
    if (idx >= 0) {
      nodes.splice(idx, 1);
      return true;
    }
    for (const node of nodes) {
      if (this.removePlaylistByName(node.Children, name)) return true;
    }
    return false;
  }

  /**
   * Rename playlist.
   */
  renamePlaylist(oldName: string, newName: string): void {
    if (!this.library) {
      throw new Error('No library loaded');
    }
    if (this.getPlaylistByName(newName)) {
      throw new Error(`Playlist already exists: ${newName}`);
    }
    const playlist = this.getPlaylistByName(oldName);
    if (!playlist) {
      throw new Error(`Playlist not found: ${oldName}`);
    }
    playlist.Name = newName;
  }

  /**
   * Duplicate playlist.
   */
  duplicatePlaylist(playlistName: string, newName?: string): Playlist {
    if (!this.library) {
      throw new Error('No library loaded');
    }
    const source = this.getPlaylistByName(playlistName);
    if (!source) {
      throw new Error(`Playlist not found: ${playlistName}`);
    }
    if (source.Type !== '1') {
      throw new Error(`Can only duplicate normal playlists: ${playlistName}`);
    }
    const targetName = newName || `${playlistName} (Copy)`;
    if (this.getPlaylistByName(targetName)) {
      throw new Error(`Playlist already exists: ${targetName}`);
    }
    const copy = this.createPlaylist(targetName);
    copy.Entries = [...source.Entries];
    return copy;
  }

  /**
   * Get track by ID
   */
  getTrackById(trackId: string): Track | undefined {
    return this.searchIndex.get(trackId);
  }

  /**
   * Search tracks with filters
   */
  search(options: SearchOptions = {}): { tracks: Track[]; total: number } {
    if (!this.library) {
      return { tracks: [], total: 0 };
    }

    const { filters = {}, sort, limit = 100, offset = 0 } = options;
    const config = getConfig();

    let results = [...this.library.tracks];

    // Apply filters
    results = this.applyFilters(results, filters);

    // Apply sorting
    if (sort) {
      results = this.applySort(results, sort.column, sort.direction || 'asc');
    }

    const total = results.length;

    // Apply pagination
    results = results.slice(offset, offset + limit);

    // Enforce limit
    if (results.length > config.limits.max_search_results) {
      results = results.slice(0, config.limits.max_search_results);
    }

    return { tracks: results, total };
  }

  /**
   * Apply search filters
   */
  private applyFilters(tracks: Track[], filters: SearchFilters): Track[] {
    if (!filters || Object.keys(filters).length === 0) {
      return tracks;
    }

    return tracks.filter((track) => {
      // Text query search
      if (filters.query) {
        const query = filters.query.toLowerCase();
        const searchable = [
          track.Name,
          track.Artist,
          track.Album,
          track.Genre,
        ].filter(Boolean).join(' ').toLowerCase();

        if (!searchable.includes(query)) {
          return false;
        }
      }

      // Genre filter
      if (filters.genre) {
        const genres = Array.isArray(filters.genre) ? filters.genre : [filters.genre];
        if (!genres.some((g) => track.Genre?.toLowerCase().includes(g.toLowerCase()))) {
          return false;
        }
      }

      // Artist filter
      if (filters.artist && !track.Artist?.toLowerCase().includes(filters.artist.toLowerCase())) {
        return false;
      }

      // Album filter
      if (filters.album && !track.Album?.toLowerCase().includes(filters.album.toLowerCase())) {
        return false;
      }

      // BPM range
      if (filters.bpm) {
        const bpm = normalizeBpm(parseFloat(track.AverageBpm || '0'));
        if (filters.bpm.min !== undefined && bpm < filters.bpm.min) return false;
        if (filters.bpm.max !== undefined && bpm > filters.bpm.max) return false;
      }

      // Key filter
      if (filters.key && track.Key?.toLowerCase() !== filters.key.toLowerCase()) {
        return false;
      }

      // Year range
      if (filters.year) {
        const year = parseInt(track.Year || '0');
        if (filters.year.min !== undefined && year < filters.year.min) return false;
        if (filters.year.max !== undefined && year > filters.year.max) return false;
      }

      // Rating range
      if (filters.rating) {
        const rating = parseInt(track.Rating || '0');
        if (filters.rating.min !== undefined && rating < filters.rating.min) return false;
        if (filters.rating.max !== undefined && rating > filters.rating.max) return false;
      }

      // Missing files only
      if (filters.missing === true && !track.isMissing) {
        return false;
      }

      // Has album art
      if (filters.hasArt === true && !(track as any).AlbumArt) {
        return false;
      }

      if (filters.hasComments === true && !(track.Comments || '').trim()) {
        return false;
      }

      if (filters.hasGenre === true && !(track.Genre || '').trim()) {
        return false;
      }

      return true;
    });
  }

  /**
   * Apply sorting
   */
  private applySort(tracks: Track[], column: string, direction: 'asc' | 'desc'): Track[] {
    return tracks.sort((a, b) => {
      let valA: string | number | undefined;
      let valB: string | number | undefined;

      switch (column) {
        case 'title':
          valA = a.Name;
          valB = b.Name;
          break;
        case 'artist':
          valA = a.Artist;
          valB = b.Artist;
          break;
        case 'album':
          valA = a.Album;
          valB = b.Album;
          break;
        case 'bpm':
          valA = normalizeBpm(parseFloat(a.AverageBpm || '0'));
          valB = normalizeBpm(parseFloat(b.AverageBpm || '0'));
          break;
        case 'key':
          valA = a.Key || a.Tonality;
          valB = b.Key || b.Tonality;
          break;
        case 'rating':
          valA = parseInt(a.Rating || '0');
          valB = parseInt(b.Rating || '0');
          break;
        case 'dateAdded':
          valA = a.DateAdded;
          valB = b.DateAdded;
          break;
        case 'genre':
          valA = a.Genre;
          valB = b.Genre;
          break;
        default:
          valA = (a as any)[column];
          valB = (b as any)[column];
      }

      if (valA === valB) return 0;
      if (valA === undefined || valA === null) return 1;
      if (valB === undefined || valB === null) return -1;

      if (typeof valA === 'string') {
        return direction === 'asc'
          ? valA.localeCompare(valB as string)
          : (valB as string).localeCompare(valA);
      }

      return direction === 'asc' ? (valA as number) - (valB as number) : (valB as number) - (valA as number);
    });
  }

  /**
   * Update a track's metadata
   */
  updateTrack(trackId: string, updates: Partial<Track>): boolean {
    if (!this.library) return false;

    const trackIndex = this.library.tracks.findIndex((t) => t.TrackID === trackId);
    if (trackIndex === -1) return false;

    this.library.tracks[trackIndex] = {
      ...this.library.tracks[trackIndex],
      ...updates,
    };

    // Update search index
    this.searchIndex.set(trackId, this.library.tracks[trackIndex]);

    return true;
  }

  /**
   * Get playlists containing a track
   */
  getPlaylistsForTrack(trackId: string): Playlist[] {
    if (!this.library) return [];

    const playlists: Playlist[] = [];
    const searchPlaylist = (nodes: Playlist[]) => {
      for (const playlist of nodes) {
        if (playlist.Entries.includes(trackId)) {
          playlists.push(playlist);
        }
        if (playlist.Children.length > 0) {
          searchPlaylist(playlist.Children);
        }
      }
    };

    searchPlaylist(this.library.playlists);
    return playlists;
  }

  /**
   * Get library statistics
   */
  getStats(): {
    totalTracks: number;
    totalPlaylists: number;
    genres: string[];
    artists: string[];
    bpmRange: { min: number; max: number };
    keyDistribution: Record<string, number>;
  } {
    if (!this.library) {
      return {
        totalTracks: 0,
        totalPlaylists: 0,
        genres: [],
        artists: [],
        bpmRange: { min: 0, max: 0 },
        keyDistribution: {},
      };
    }

    const genres = [...new Set(this.library.tracks.map((t) => t.Genre).filter(Boolean))] as string[];
    const artists = [...new Set(this.library.tracks.map((t) => t.Artist).filter(Boolean))] as string[];

    const bpms = this.library.tracks
      .map((t) => normalizeBpm(parseFloat(t.AverageBpm || '0')))
      .filter((b) => b > 0);

    const keyDistribution: Record<string, number> = {};
    for (const track of this.library.tracks) {
      const key = track.Key || track.Tonality || 'Unknown';
      keyDistribution[key] = (keyDistribution[key] || 0) + 1;
    }

    return {
      totalTracks: this.library.tracks.length,
      totalPlaylists: this.countPlaylists(this.library.playlists),
      genres: genres.sort(),
      artists: artists.sort(),
      bpmRange: {
        min: bpms.length > 0 ? Math.min(...bpms) : 0,
        max: bpms.length > 0 ? Math.max(...bpms) : 0,
      },
      keyDistribution,
    };
  }

  private countPlaylists(playlists: Playlist[]): number {
    let count = playlists.length;
    for (const p of playlists) {
      count += this.countPlaylists(p.Children);
    }
    return count;
  }

  /**
   * Export library to XML
   */
  exportToXML(): string {
    if (!this.library) {
      throw new Error('No library loaded');
    }
    return this.parser.exportToXML(this.library);
  }
}

// Singleton instance
let libraryService: LibraryService | null = null;

export function getLibraryService(): LibraryService {
  if (!libraryService) {
    libraryService = new LibraryService();
  }
  return libraryService;
}

export function setLibraryService(service: LibraryService): void {
  libraryService = service;
}
