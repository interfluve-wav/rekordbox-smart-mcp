#!/usr/bin/env node
/**
 * Quick manual smoke test for rekordbox-smart-mcp
 * Tests core functionality with a real XML file
 */
import { getLibraryService } from './src/services/library.js';
import { loadConfig } from './src/config.js';
import * as libraryTools from './src/tools/library.js';
import * as playlistTools from './src/tools/playlist.js';
import * as setlistTools from './src/tools/setlist.js';

const xmlPath = '/Users/suhaas/Documents/Developer/bonk-mcp/rekordbox.xml';

async function runTests() {
  console.log('🧪 Starting manual smoke test...\n');

  try {
    // 1. Load config
    console.log('1. Loading config...');
    loadConfig();
    console.log('   ✅ Config loaded\n');

    // 2. Load library from XML
    console.log('2. Loading library from XML...');
    const libResult = await libraryTools.loadLibrary({ xmlPath });
    if (!libResult.success) {
      throw new Error(`Failed to load library: ${libResult.message || libResult.error}`);
    }
    console.log(`   ✅ Loaded ${libResult.message || 'library'}`);
    console.log(`   Backup: ${libResult.backup || 'none'}\n`);

    // 3. Get stats
    console.log('3. Getting library stats...');
    const stats = await libraryTools.getLibraryStats();
    console.log(`   ✅ Tracks: ${stats.totalTracks}, Playlists: ${stats.totalPlaylists}`);
    console.log(`   Genres: ${stats.genres.slice(0, 5).join(', ')}...\n`);

    // 4. Search library
    console.log('4. Testing search...');
    const searchResult = await libraryTools.searchLibrary({
      query: 'love',
      limit: 5
    });
    console.log(`   ✅ Found ${searchResult.total} matches\n`);

    // 5. Build smart playlist
    console.log('5. Building smart playlist...');
    const buildResult = await playlistTools.buildSmartPlaylist({
      playlistName: 'Test Smart Playlist',
      rules: {
        max_tracks: 10,
        bpm_range: { min: 100, max: 130 },
        key_progression: 'smooth',
        avoid_artist_repeat: true
      }
    });
    if (!buildResult.success) {
      throw new Error(`Smart playlist failed: ${buildResult.error}`);
    }
    console.log(`   ✅ Created playlist with ${buildResult.stats?.trackCount} tracks`);
    console.log(`   BPM range: ${buildResult.stats?.bpmRange.min}-${buildResult.stats?.bpmRange.max}`);
    console.log(`   Avg energy: ${buildResult.stats?.averageEnergy?.toFixed(2)}\n`);

    // 6. Analyze setlist
    console.log('6. Analyzing setlist...');
    const analyzeResult = await setlistTools.analyzeSetlist({
      playlist_name: 'Test Smart Playlist'
    });
    if (!analyzeResult.success) {
      throw new Error(`Analysis failed: ${analyzeResult.error}`);
    }
    console.log(`   ✅ Harmonic compatibility: ${(analyzeResult.analysis.harmonicCompatibility * 100).toFixed(1)}%`);
    console.log(`   Artist diversity: ${(analyzeResult.analysis.artistDiversity * 100).toFixed(1)}%`);
    console.log(`   BPM gaps: ${analyzeResult.analysis.bpmGaps.length}\n`);

    // 7. Get transition suggestions
    console.log('7. Getting transition suggestions...');
    const transResult = await setlistTools.suggestTransitions({
      playlist_name: 'Test Smart Playlist',
      limit_per_track: 2
    });
    if (!transResult.success) {
      throw new Error(`Transitions failed: ${transResult.error}`);
    }
    const totalSuggestions = transResult.suggestions.length;
    const perfectMatches = transResult.suggestions.filter(s => s.transitionType === 'perfect').length;
    console.log(`   ✅ Generated ${totalSuggestions} suggestions (${perfectMatches} perfect matches)\n`);

    // 8. Get mutation history
    console.log('8. Checking mutation history...');
    const historyResult = await (await import('./src/tools/mutations.js')).mutationHistory({ limit: 5 });
    console.log(`   ✅ Logged ${historyResult.total} mutations\n`);

    console.log('🎉 All tests passed!');
    console.log('\nBackup files created in current directory (if any mutations occurred).');
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
