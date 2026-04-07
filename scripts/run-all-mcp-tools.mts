/**
 * Invoke every tool handler the MCP server exposes (see src/index.ts switch).
 * Uses TEST DB fixtures; mutations run with cwd = TEST DB/mcp-all-tools-out so backups stay there.
 *
 * Step 1 loads the in-memory library from **either** Rekordbox XML or `master.db`
 * (`library_load` vs `rekordbox_sync` import). By default this sweep **does not** run
 * `rekordbox_sync` **import from** `master.db` (avoids pyrekordbox DB library sync). Use
 * `TEST DB/all-tools-export.xml` for step 1. Set `MCP_INCLUDE_DB_SYNC=1` to restore
 * the old behavior: `master.db` when present, `MCP_FIRST_IMPORT=auto|xml|db`, and the
 * second `rekordbox_sync` import block. `rekordbox_sync` **export to XML** still runs
 * (not a DB write). DJ history tools (`dj_*`) may still read `TEST DB/master.db` if present.
 *
 * Run: npx tsx scripts/run-all-mcp-tools.mts
 * Recommended (pyrekordbox for DB): PATH="$PWD/TEST DB/.venv/bin:$PATH" npx tsx scripts/run-all-mcp-tools.mts
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeBpmCacheDb } from '../src/services/bpmCache.js';
import { getLibraryService } from '../src/services/library.js';
import * as audioTools from '../src/tools/audio.js';
import * as djTools from '../src/tools/dj.js';
import * as lib from '../src/tools/library.js';
import * as playlistTools from '../src/tools/playlist.js';
import * as rekordboxTools from '../src/tools/rekordbox.js';
import * as setlistTools from '../src/tools/setlist.js';
import * as trackTools from '../src/tools/track.js';
import { loadConfig, setConfig } from '../src/config.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testDbDir = join(root, 'TEST DB');
const xmlPath = join(testDbDir, 'all-tools-export.xml');
const masterDbPath = join(testDbDir, 'master.db');
const venvBin = join(testDbDir, '.venv', 'bin');
const outDir = join(testDbDir, 'mcp-all-tools-out');

function writeMinimalWav16(path: string): void {
  const sampleRate = 8000;
  const seconds = 0.25;
  const numSamples = Math.floor(sampleRate * seconds);
  const bitsPerSample = 16;
  const blockAlign = 2;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  writeFileSync(path, buf);
}

function summarize(value: unknown): string {
  try {
    const s = JSON.stringify(value);
    return s.length > 160 ? `${s.slice(0, 157)}...` : s;
  } catch {
    return String(value);
  }
}

let thrown = 0;
let ran = 0;

async function invoke(name: string, fn: () => Promise<unknown>): Promise<void> {
  ran++;
  try {
    const result = await fn();
    console.log(`OK  ${name} ${summarize(result)}`);
  } catch (e) {
    thrown++;
    console.log(`ERR ${name} ${(e as Error).message}`);
  }
}

/** Missing optional credentials — not counted as a hard failure */
async function invokeSoft(name: string, fn: () => Promise<unknown>): Promise<void> {
  ran++;
  try {
    const result = await fn();
    console.log(`OK  ${name} ${summarize(result)}`);
  } catch (e) {
    const msg = (e as Error).message;
    if (/API key missing|supermemory/i.test(msg)) {
      console.log(`SKIP ${name} (${msg})`);
      return;
    }
    thrown++;
    console.log(`ERR ${name} ${msg}`);
  }
}

const tomlPath = join(root, 'rekordbox-smart-mcp.toml');
const envPath = process.env.BONK_CONFIG_PATH;
const initial = loadConfig(
  existsSync(tomlPath) ? tomlPath : envPath ? resolve(envPath) : undefined,
);

if (existsSync(join(venvBin, 'python3'))) {
  process.env.PATH = `${venvBin}:${process.env.PATH || ''}`;
}

mkdirSync(outDir, { recursive: true });
const prevCwd = process.cwd();
process.chdir(outDir);

closeBpmCacheDb();
setConfig({
  ...initial,
  rekordbox: {
    ...initial.rekordbox,
    db_path: existsSync(masterDbPath) ? masterDbPath : initial.rekordbox.db_path,
    auto_detect: false,
  },
  cache: {
    ...initial.cache,
    db_path: join(testDbDir, 'mcp-all-tools-media-cache.sqlite'),
  },
});

const hasMasterDb = existsSync(masterDbPath);
const hasXml = existsSync(xmlPath);
const firstImport = (process.env.MCP_FIRST_IMPORT || 'auto').toLowerCase();
const includeDbSync =
  process.env.MCP_INCLUDE_DB_SYNC === '1' || process.env.MCP_INCLUDE_DB_SYNC === 'true';
let startedWithDb = false;

if (includeDbSync) {
  if (firstImport === 'db') {
    if (!hasMasterDb) {
      console.error('MCP_FIRST_IMPORT=db but TEST DB/master.db is missing');
      process.exit(1);
    }
  } else if (firstImport === 'xml') {
    if (!hasXml) {
      console.error('MCP_FIRST_IMPORT=xml but XML fixture is missing');
      process.exit(1);
    }
  } else if (!hasMasterDb && !hasXml) {
    console.error('Need at least one of: TEST DB/master.db or TEST DB/all-tools-export.xml');
    process.exit(1);
  }
} else {
  if (firstImport === 'db') {
    console.error('MCP_FIRST_IMPORT=db requires MCP_INCLUDE_DB_SYNC=1');
    process.exit(1);
  }
  if (!hasXml) {
    console.error(
      'Default sweep skips rekordbox_sync import from master.db; need TEST DB/all-tools-export.xml. Set MCP_INCLUDE_DB_SYNC=1 to use master.db for library import.',
    );
    process.exit(1);
  }
}

const wavPath = resolve(outDir, 'mcp-sweep.wav');
writeMinimalWav16(wavPath);

const runId = `mcp-all-${Date.now()}`;
const plA = `MCP Sweep A ${runId}`;
let sessionIdForDj = '0';

console.error(
  `[mcp-all-tools] cwd=${outDir} xml=${xmlPath} master.db=${hasMasterDb} first=${firstImport} includeDbSync=${includeDbSync}`,
);

// --- Step 1: load library (XML by default; master.db import only with MCP_INCLUDE_DB_SYNC=1) ---
if (includeDbSync && (firstImport === 'db' || (firstImport === 'auto' && hasMasterDb))) {
  startedWithDb = true;
  await invoke('rekordbox_sync (step 1: import master.db)', () =>
    rekordboxTools.sync({ action: 'import', source: masterDbPath }),
  );
} else {
  await invoke('library_load (step 1: import XML)', () => lib.loadLibrary(xmlPath));
}

const tracksAfterLoad = getLibraryService().getAllTracks();
if (!tracksAfterLoad.length) {
  console.error('No tracks after library_load');
  process.exit(1);
}
const trackId = tracksAfterLoad[0].TrackID;

await invoke('library_stats', () => lib.getLibraryStats());
await invoke('library_listPlaylists', () => lib.listPlaylists());
await invoke('library_search', () => lib.searchLibrary({ query: 'Demo', limit: 5 }));
await invoke('library_findMissing', () => lib.findMissingFiles());
await invoke('library_findDuplicates', () => lib.findDuplicates());
await invoke('library_fuzzySearch', () => lib.fuzzySearchLibrary({ query: 'loop', limit: 3 }));
await invoke('search_keyCompatible', () => lib.searchKeyCompatible({ key: '4A', limit: 3 }));
await invoke('library_exportJSON', () => lib.exportLibraryJson(resolve(outDir, 'export-all.json')));

await invoke('track_get', () => trackTools.getTrack({ trackId }));
await invoke('track_playlists', () => trackTools.getTrackPlaylists(trackId));

await invoke('track_update', async () => {
  const cur = await trackTools.getTrack({ trackId });
  const orig = (cur.track?.Comments as string) || '';
  const step1 = await trackTools.updateTrack({
    trackId,
    updates: { comments: `mcp-sweep-${runId}` },
  });
  if (!step1.success) return step1;
  return trackTools.updateTrack({ trackId, updates: { comments: orig } });
});

await invoke('track_updateBatch', () =>
  trackTools.batchUpdateTracks([
    { trackId, updates: { comments: 'batch-ok' } },
    { trackId: 'definitely-missing-id-xyz', updates: { comments: 'x' } },
  ]),
);

await invoke('audio_bpmGetCached', () => audioTools.getCachedBpm(wavPath));
await invoke('audio_bpmCacheSet', () =>
  audioTools.setCachedBpm(wavPath, 128, 'mcp-sweep', 0.9, 'sweep-v1'),
);

if (hasXml) {
  await invoke('rekordbox_importXml', () => rekordboxTools.importXML(xmlPath));
} else {
  console.log('SKIP rekordbox_importXml (no XML fixture)');
}
await invoke('rekordbox_exportXml', () => rekordboxTools.exportXML(resolve(outDir, 'rekordbox-export.xml')));

await invoke('rekordbox_sync', () =>
  rekordboxTools.sync({
    action: 'export',
    destination: resolve(outDir, 'sync-export.xml'),
  }),
);

await invoke('dj_getRecentSessions', () => djTools.getRecentSessions(365));
const recent = await djTools.getRecentSessions(365 * 5);
if (recent.success && recent.sessions?.length) {
  sessionIdForDj = String(recent.sessions[0].id);
}
await invoke('dj_getSessionTracks', () => djTools.getSessionTracks(sessionIdForDj));
await invoke('dj_getHistoryStats', () => djTools.getHistoryStats());
await invoke('dj_getPlayCountAnalytics', () => djTools.getPlayCountAnalytics());
await invoke('dj_getListeningPatterns', () => djTools.getListeningPatterns());

await invoke('playlist_create', () => playlistTools.createPlaylist(plA, undefined));
await invoke('playlist_addTracks', () => playlistTools.addTracksToPlaylist(plA, [trackId], 'add'));
await invoke('playlist_removeTracks', () =>
  playlistTools.removeTracksFromPlaylist(plA, [trackId]),
);
await invoke('playlist_rename', () => playlistTools.renamePlaylist(plA, `${plA} Renamed`));
await invoke('playlist_delete', () =>
  playlistTools.deletePlaylist(`${plA} Renamed`, true),
);

// Setlist tools: build a smart playlist, analyze it, and get transition suggestions
const smartPl = `Smart Setlist ${runId}`;
await invoke('playlist_buildSmart', () =>
  setlistTools.buildSmartPlaylist({
    playlistName: smartPl,
    rules: { energy_curve: 'wave', max_tracks: 10, bpm_range: { min: 120, max: 140 }, avoid_artist_repeat: true },
  }),
);
await invoke('setlist_analyze', () => setlistTools.analyzeSetlist({ playlist_name: smartPl }));
await invoke('setlist_suggestTransitions', () =>
  setlistTools.suggestTransitions({ playlist_name: smartPl, limit_per_track: 2 }),
);

if (includeDbSync && hasMasterDb && !startedWithDb) {
  await invoke('rekordbox_sync (import master.db, after XML path)', () =>
    rekordboxTools.sync({ action: 'import', source: masterDbPath }),
  );
} else if (!includeDbSync) {
  console.log('SKIP rekordbox_sync import master.db (set MCP_INCLUDE_DB_SYNC=1 to test)');
} else if (!hasMasterDb) {
  console.log('SKIP rekordbox_sync import db (no TEST DB/master.db)');
}

process.chdir(prevCwd);

for (const f of readdirSync(outDir)) {
  if (f.startsWith('bonk-backup-') && f.endsWith('.xml')) {
    try {
      rmSync(join(outDir, f), { force: true });
    } catch {
      /* ignore */
    }
  }
}

console.error(`\n--- MCP tools invoked: ${ran}, throws: ${thrown}`);
process.exit(thrown > 0 ? 1 : 0);
