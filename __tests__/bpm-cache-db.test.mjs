/**
 * SQLite (better-sqlite3) tests for BPM + scan cache: schema, CRUD, isolation, integrity.
 * Depends on dist/ — `npm test` runs `npm run build` first.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { setConfig } from '../dist/config.js';
import {
  closeBpmCacheDb,
  getBpmCache,
  getScanCache,
  setBpmCache,
  setScanCache,
} from '../dist/services/bpmCache.js';

const distMarker = fileURLToPath(new URL('../dist/services/bpmCache.js', import.meta.url));
if (!existsSync(distMarker)) {
  throw new Error('Missing dist/services/bpmCache.js — run npm run build');
}

function baseConfig(cacheDbPath) {
  return {
    library: { xml_path: '', folder_paths: [] },
    rekordbox: { auto_detect: false, db_path: '' },
    cache: { enabled: true, db_path: cacheDbPath },
    audio: {
      ffmpeg_path: '/usr/bin/ffmpeg',
      ffprobe_path: '/usr/bin/ffprobe',
      keyfinder_path: './bin/keyfinder-cli',
    },
    api_keys: {},
    limits: {
      max_search_results: 1000,
      max_batch_size: 100,
      query_timeout_ms: 30000,
    },
  };
}

describe('bpmCache SQLite', () => {
  let workDir;
  let dbPath;
  let audioPath;

  beforeEach(() => {
    closeBpmCacheDb();
    workDir = mkdtempSync(join(tmpdir(), 'bonk-bpm-db-'));
    dbPath = join(workDir, 'media-cache.test.sqlite');
    audioPath = join(workDir, 'test-audio.wav');
    writeFileSync(audioPath, Buffer.from('fake wav bytes for stat'));
    setConfig(baseConfig(dbPath));
  });

  afterEach(() => {
    closeBpmCacheDb();
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  test('creates schema and indexes on first use', () => {
    setBpmCache(audioPath, 128.5, 'aubio', 0.95, 'test-analyzer-v1');
    expect(existsSync(dbPath)).toBe(true);

    const ro = new Database(dbPath, { readonly: true, fileMustExist: true });
    const tables = ro
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all()
      .map((r) => r.name);
    expect(tables).toEqual(['bpm_analysis', 'scanned_tracks']);

    const indexes = ro
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
      .all()
      .map((r) => r.name);
    expect(indexes).toContain('idx_scanned_tracks_file_path');
    expect(indexes).toContain('idx_scanned_tracks_track_id');

    const integrity = ro.prepare('PRAGMA integrity_check').get();
    expect(integrity.integrity_check).toBe('ok');
    ro.close();
  });

  test('setBpmCache / getBpmCache round-trip', () => {
    setBpmCache(audioPath, 122, 'aubio', null, 'v1');
    const got = getBpmCache(audioPath);
    expect(got).not.toBeNull();
    expect(got.bpm).toBe(122);
    expect(got.source).toBe('aubio');
    expect(got.confidence).toBeNull();
    expect(got.analyzerVersion).toBe('v1');
    expect(typeof got.updatedAt).toBe('number');
  });

  test('getBpmCache returns null after file mtime changes (new cache key)', () => {
    setBpmCache(audioPath, 130, 'test', 0.5, 'v1');
    expect(getBpmCache(audioPath)).not.toBeNull();
    const t = new Date(Date.now() + 2000);
    utimesSync(audioPath, t, t);
    expect(getBpmCache(audioPath)).toBeNull();
  });

  test('setScanCache merges partial updates', () => {
    setScanCache(audioPath, {
      trackId: 'trk-1',
      key: '4A',
      genre: 'House',
      bpm: null,
      source: 'library-import',
      analyzerVersion: 'library-v1',
    });
    let row = getScanCache(audioPath);
    expect(row.trackId).toBe('trk-1');
    expect(row.key).toBe('4A');
    expect(row.genre).toBe('House');
    expect(row.bpm).toBeNull();

    setScanCache(audioPath, { bpm: 126 });
    row = getScanCache(audioPath);
    expect(row.trackId).toBe('trk-1');
    expect(row.key).toBe('4A');
    expect(row.bpm).toBe(126);
  });

  test('setBpmCache syncs scanned_tracks row for same file', () => {
    setBpmCache(audioPath, 135, 'aubio', 0.88, 'v2');
    const scan = getScanCache(audioPath);
    expect(scan).not.toBeNull();
    expect(scan.bpm).toBe(135);
    expect(scan.source).toBe('aubio');
    expect(scan.filePath).toBe(audioPath);
  });

  test('independent cache entries per file', () => {
    const audioB = join(workDir, 'b.wav');
    writeFileSync(audioB, Buffer.from('b'));
    setBpmCache(audioPath, 120, 's1', null, 'v1');
    setBpmCache(audioB, 140, 's2', null, 'v1');
    expect(getBpmCache(audioPath).bpm).toBe(120);
    expect(getBpmCache(audioB).bpm).toBe(140);
  });
});

describe('repo TEST DB cache file (optional)', () => {
  test('existing cacheDB.sqlite3 opens and passes integrity_check if present', () => {
    const repoRoot = fileURLToPath(new URL('..', import.meta.url));
    const fixture = join(repoRoot, 'TEST DB', 'cacheDB.sqlite3');
    if (!existsSync(fixture)) {
      return;
    }
    const ro = new Database(fixture, { readonly: true, fileMustExist: true });
    const integrity = ro.prepare('PRAGMA integrity_check').get();
    expect(integrity.integrity_check).toBe('ok');
    ro.close();
  });
});
