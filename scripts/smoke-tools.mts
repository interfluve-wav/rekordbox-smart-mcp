/**
 * One-shot smoke pass: exercises major tool modules after an explicit XML import
 * (`library_load`) — same first step as real MCP use (XML or `rekordbox_sync` import of master.db).
 * Run: npx tsx scripts/smoke-tools.mts
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';
import * as audioTools from '../src/tools/audio.js';
import * as djTools from '../src/tools/dj.js';
import * as lib from '../src/tools/library.js';
import * as playlistTools from '../src/tools/playlist.js';
import * as rekordboxTools from '../src/tools/rekordbox.js';
import * as supermemoryTools from '../src/tools/supermemory.js';
import * as trackTools from '../src/tools/track.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const xml = resolve(root, 'TEST DB/all-tools-export.xml');
const outDir = resolve(root, 'TEST DB/smoke-out');
const sampleTrackId = '139814141';

loadConfig(process.env.BONK_CONFIG_PATH);

type Row = { name: string; ok: boolean; detail?: string };
const rows: Row[] = [];

function row(name: string, ok: boolean, detail?: string) {
  rows.push({ name, ok, detail });
  console.log(ok ? 'OK ' : 'FAIL', name, detail ?? '');
}

mkdirSync(outDir, { recursive: true });

const load = await lib.loadLibrary(xml);
row('library_load', load.success, load.message);

const stats = await lib.getLibraryStats();
row(
  'library_stats',
  typeof stats.totalTracks === 'number' && stats.totalTracks > 0,
  `tracks=${stats.totalTracks}`,
);

const pl = await lib.listPlaylists();
row('library_listPlaylists', pl.total >= 0, `total=${pl.total}`);

const search = await lib.searchLibrary({ query: 'Demo', limit: 10 });
row('library_search', search.total >= 0, `hits=${search.total}`);

const fuzzy = await lib.fuzzySearchLibrary({ query: 'loop', limit: 5 });
row('library_fuzzySearch', fuzzy.total >= 0, `hits=${fuzzy.total}`);

const dup = await lib.findDuplicates();
row('library_findDuplicates', Array.isArray(dup.byLocation));

const miss = await lib.findMissingFiles();
row('library_findMissing', typeof miss.total === 'number');

const jsonPath = resolve(outDir, 'smoke-library.json');
const jex = await lib.exportLibraryJson(jsonPath);
row('library_exportJSON', jex.success === true, jex.outputPath);

const csvPath = resolve(outDir, 'smoke-library.csv');
const cex = await lib.exportLibraryCsv(csvPath);
row('library_exportCSV', cex.success === true, cex.outputPath);

const nat = await lib.searchNaturalLanguage({ query: 'house around 120 bpm', limit: 3 });
row('search_natlang', nat != null && typeof (nat as { total?: number }).total === 'number');

const kc = await lib.searchKeyCompatible({ key: '4A', limit: 3 });
row(
  'search_keyCompatible',
  kc != null && Array.isArray((kc as { tracks?: unknown[] }).tracks),
);

const tg = await trackTools.getTrack({ trackId: sampleTrackId });
row('track_get', tg.success === true, (tg as { track?: { Name?: string } }).track?.Name);

const tp = await trackTools.getTrackPlaylists(sampleTrackId);
row('track_playlists', tp.success === true && Array.isArray(tp.playlists));

const safeExport = resolve(outDir, 'smoke-rekordbox-export.xml');
const rx = await rekordboxTools.exportXML(safeExport);
row('rekordbox_exportXml', rx.success === true, (rx as { message?: string }).message);

const ri = await rekordboxTools.importXML(safeExport);
row('rekordbox_importXml', ri.success === true, (ri as { message?: string }).message);

try {
  await djTools.getRecentSessions(7);
  row('dj_getRecentSessions', true);
} catch (e) {
  row('dj_getRecentSessions', false, (e as Error).message);
}

const djPc = await djTools.getPlayCountAnalytics();
row('dj_getPlayCountAnalytics', djPc != null);

const djLp = await djTools.getListeningPatterns();
row('dj_getListeningPatterns', djLp != null);

const pc = await playlistTools.createPlaylist('Smoke Test Pl', undefined);
row('playlist_create', pc.success === true, (pc as { error?: string }).error);

if (pc.success) {
  const pa = await playlistTools.addTracksToPlaylist('Smoke Test Pl', [sampleTrackId], 'add');
  row('playlist_addTracks', pa.success === true);
  const pr = await playlistTools.removeTracksFromPlaylist('Smoke Test Pl', [sampleTrackId]);
  row('playlist_removeTracks', pr.success === true);
  const pd = await playlistTools.deletePlaylist('Smoke Test Pl', true);
  row('playlist_delete', pd.success === true);
} else {
  row('playlist_addTracks', false, 'skipped');
  row('playlist_removeTracks', false, 'skipped');
  row('playlist_delete', false, 'skipped');
}

const fakePath = resolve(outDir, 'nonexistent-audio.mp3');
const meta = await audioTools.getMetadata({ filePath: fakePath });
row(
  'audio_getMetadata (missing file)',
  meta.success === false && Boolean(meta.error),
  meta.error,
);

let smOk = false;
let smDetail = '';
try {
  const smSearch = await supermemoryTools.searchMemories({ query: 'bonk', limit: 1 });
  smOk = smSearch != null;
  smDetail = typeof smSearch === 'object' ? JSON.stringify(smSearch).slice(0, 120) : String(smSearch);
} catch (e) {
  smOk = false;
  smDetail = (e as Error).message;
}
row('supermemory_search', smOk, smDetail);

const passed = rows.filter((r) => r.ok).length;
const failed = rows.filter((r) => !r.ok);
console.log(`\n--- Smoke: ${passed}/${rows.length} checks passed`);
if (failed.length) {
  console.error('Failed:', failed.map((f) => f.name).join(', '));
  process.exit(1);
}
