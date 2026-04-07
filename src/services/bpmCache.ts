/**
 * BPM cache storage backed by SQLite.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, statSync } from 'fs';
import { dirname, resolve } from 'path';
import { createHash } from 'crypto';
import { getConfig } from '../config.js';

export interface BpmCacheEntry {
  bpm: number;
  source: string;
  confidence: number | null;
  analyzerVersion: string;
  updatedAt: number;
}

export interface ScanCacheEntry {
  trackId: string | null;
  filePath: string;
  bpm: number | null;
  key: string | null;
  genre: string | null;
  source: string | null;
  confidence: number | null;
  analyzerVersion: string | null;
  updatedAt: number;
}

let db: Database.Database | null = null;

/** Close the singleton DB handle (e.g. tests switching cache.db_path). */
export function closeBpmCacheDb(): void {
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    db = null;
  }
}

function getDb(): Database.Database {
  if (db) return db;
  const config = getConfig();
  const dbPath = resolve(config.cache.db_path);
  const parentDir = dirname(dbPath);
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS bpm_analysis (
      cache_key TEXT PRIMARY KEY,
      bpm REAL NOT NULL,
      source TEXT NOT NULL,
      confidence REAL,
      analyzer_version TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS scanned_tracks (
      cache_key TEXT PRIMARY KEY,
      track_id TEXT,
      file_path TEXT NOT NULL,
      bpm REAL,
      key TEXT,
      genre TEXT,
      source TEXT,
      confidence REAL,
      analyzer_version TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scanned_tracks_track_id ON scanned_tracks(track_id);
    CREATE INDEX IF NOT EXISTS idx_scanned_tracks_file_path ON scanned_tracks(file_path);
  `);
  return db;
}

function makeCacheKey(filePath: string): string {
  const resolved = resolve(filePath);
  const st = statSync(resolved);
  return createHash('sha256').update(`${resolved}\0${st.mtimeMs}\0bpm-cache-v1`).digest('hex');
}

export function getBpmCache(filePath: string): BpmCacheEntry | null {
  const cacheKey = makeCacheKey(filePath);
  const row = getDb()
    .prepare(
      `SELECT bpm, source, confidence, analyzer_version, updated_at
       FROM bpm_analysis
       WHERE cache_key = ?`,
    )
    .get(cacheKey) as
    | { bpm: number; source: string; confidence: number | null; analyzer_version: string; updated_at: number }
    | undefined;

  if (!row) return null;
  return {
    bpm: row.bpm,
    source: row.source,
    confidence: row.confidence,
    analyzerVersion: row.analyzer_version,
    updatedAt: row.updated_at,
  };
}

export function setBpmCache(
  filePath: string,
  bpm: number,
  source: string,
  confidence: number | null,
  analyzerVersion: string,
): void {
  const cacheKey = makeCacheKey(filePath);
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO bpm_analysis
       (cache_key, bpm, source, confidence, analyzer_version, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(cacheKey, bpm, source, confidence, analyzerVersion, Date.now());

  // Keep the unified scan cache in sync for cross-scan reuse.
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO scanned_tracks
       (cache_key, track_id, file_path, bpm, key, genre, source, confidence, analyzer_version, updated_at)
       VALUES (
         ?,
         COALESCE((SELECT track_id FROM scanned_tracks WHERE cache_key = ?), NULL),
         ?,
         ?,
         COALESCE((SELECT key FROM scanned_tracks WHERE cache_key = ?), NULL),
         COALESCE((SELECT genre FROM scanned_tracks WHERE cache_key = ?), NULL),
         ?,
         ?,
         ?,
         ?
       )`,
    )
    .run(cacheKey, cacheKey, resolve(filePath), bpm, cacheKey, cacheKey, source, confidence, analyzerVersion, Date.now());
}

export function getScanCache(filePath: string): ScanCacheEntry | null {
  const cacheKey = makeCacheKey(filePath);
  const row = getDb()
    .prepare(
      `SELECT track_id, file_path, bpm, key, genre, source, confidence, analyzer_version, updated_at
       FROM scanned_tracks
       WHERE cache_key = ?`,
    )
    .get(cacheKey) as
    | {
        track_id: string | null;
        file_path: string;
        bpm: number | null;
        key: string | null;
        genre: string | null;
        source: string | null;
        confidence: number | null;
        analyzer_version: string | null;
        updated_at: number;
      }
    | undefined;
  if (!row) return null;
  return {
    trackId: row.track_id,
    filePath: row.file_path,
    bpm: row.bpm,
    key: row.key,
    genre: row.genre,
    source: row.source,
    confidence: row.confidence,
    analyzerVersion: row.analyzer_version,
    updatedAt: row.updated_at,
  };
}

export function setScanCache(
  filePath: string,
  values: {
    trackId?: string | null;
    bpm?: number | null;
    key?: string | null;
    genre?: string | null;
    source?: string | null;
    confidence?: number | null;
    analyzerVersion?: string | null;
  },
): void {
  const cacheKey = makeCacheKey(filePath);
  const existing = getScanCache(filePath);
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO scanned_tracks
       (cache_key, track_id, file_path, bpm, key, genre, source, confidence, analyzer_version, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      cacheKey,
      values.trackId ?? existing?.trackId ?? null,
      resolve(filePath),
      values.bpm ?? existing?.bpm ?? null,
      values.key ?? existing?.key ?? null,
      values.genre ?? existing?.genre ?? null,
      values.source ?? existing?.source ?? null,
      values.confidence ?? existing?.confidence ?? null,
      values.analyzerVersion ?? existing?.analyzerVersion ?? null,
      Date.now(),
    );
}
