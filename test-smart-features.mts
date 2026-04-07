#!/usr/bin/env node
/**
 * Deep testing for smart features (playlist_buildSmart, setlist_analyze, setlist_suggestTransitions)
 * Tests multiple parameter combinations and edge cases
 */
import { loadConfig } from './dist/config.js';
import * as libraryTools from './dist/tools/library.js';
import * as setlistTools from './dist/tools/setlist.js';

const xmlPath = '/Users/suhaas/Documents/Developer/bonk-mcp/rekordbox.xml';

const testCases = [
  {
    name: 'Wave energy curve with smooth key progression',
    rules: {
      energy_curve: 'wave',
      max_tracks: 15,
      bpm_range: { min: 100, max: 130 },
      key_progression: 'smooth',
      avoid_artist_repeat: true
    }
  },
  {
    name: 'Ramp-up energy with mixed key progression',
    rules: {
      energy_curve: 'ramp-up',
      max_tracks: 10,
      bpm_range: { min: 120, max: 140 },
      key_progression: 'mixed'
    }
  },
  {
    name: 'Ramp-down energy with random keys',
    rules: {
      energy_curve: 'ramp-down',
      max_tracks: 12,
      bpm_range: { min: 90, max: 110 },
      key_progression: 'random'
    }
  },
  {
    name: 'Flat energy with genre filter',
    rules: {
      energy_curve: 'flat',
      max_tracks: 20,
      preferred_genres: ['House', 'Techno'],
      key_progression: 'smooth'
    }
  },
  {
    name: 'Include mandatory tracks',
    rules: {
      max_tracks: 10,
      bpm_range: { min: 110, max: 130 },
      include_tracks: []  // Will be populated after first load
    }
  },
  {
    name: 'Minimal constraints (stress test)',
    rules: {
      max_tracks: 30
    }
  },
  {
    name: 'Tight BPM range (challenging)',
    rules: {
      max_tracks: 10,
      bpm_range: { min: 128, max: 132 }  // 4 BPM window
    }
  }
];

let mandatoryTrackId: string | null = null;
let excludeTrackIds: string[] = [];

async function runDeepTests() {
  console.log('🧪 Deep Smart Features Test Suite\n');
  console.log('='.repeat(60));

  // Load config
  console.log('\n[Setup] Loading config...');
  loadConfig();
  console.log('✅ Config loaded\n');

  // Load library from XML
  console.log('[Setup] Loading library from XML...');
  const libResult = await libraryTools.loadLibrary({ xmlPath });
  if (!libResult.success) {
    throw new Error(`Failed to load library: ${libResult.message || libResult.error}`);
  }
  console.log(`✅ Library loaded: ${libResult.message}`);
  const stats = await libraryTools.getLibraryStats();
  console.log(`   Total tracks: ${stats.totalTracks}`);
  console.log(`   Total playlists: ${stats.totalPlaylists}`);
  console.log(`   BPM range: ${stats.bpmRange.min}-${stats.bpmRange.max}\n`);

  // Get a sample track to use as mandatory
  const searchResult = await libraryTools.searchLibrary({ query: 'love', limit: 1 });
  if (searchResult.tracks.length > 0) {
    mandatoryTrackId = searchResult.tracks[0].TrackID;
    console.log(`[Setup] Selected mandatory track ID: ${mandatoryTrackId}\n`);
  }

  // Get a couple of tracks to exclude
  const moreResults = await libraryTools.searchLibrary({ query: 'techno', limit: 2 });
  if (moreResults.tracks.length >= 2) {
    excludeTrackIds = moreResults.tracks.map(t => t.TrackID);
    console.log(`[Setup] Selected exclude track IDs: ${excludeTrackIds.join(', ')}\n`);
  }

  // Run test cases
  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    console.log(`\n[Test] ${testCase.name}`);
    console.log('-'.repeat(60));

    try {
      // Update test case with dynamic values
      const rules = { ...testCase.rules };
      if (rules.include_tracks && mandatoryTrackId) {
        rules.include_tracks = [mandatoryTrackId];
      }
      if (rules.exclude_tracks && excludeTrackIds.length > 0) {
        rules.exclude_tracks = excludeTrackIds;
      }

      // 1. Build smart playlist
      const buildResult = await setlistTools.buildSmartPlaylist({
        playlistName: `Test: ${testCase.name}`,
        rules
      });

      if (!buildResult.success || !buildResult.playlist) {
        throw new Error(`Build failed: ${buildResult.error || 'No playlist returned'}`);
      }

      const trackCount = buildResult.stats?.trackCount || 0;
      console.log(`   ✅ Built playlist with ${trackCount} tracks`);
      console.log(`      BPM: ${buildResult.stats?.bpmRange.min}-${buildResult.stats?.bpmRange.max}`);
      console.log(`      Avg energy: ${buildResult.stats?.averageEnergy?.toFixed(3)}`);
      const keyDist = buildResult.stats?.keyDistribution || {};
      console.log(`      Keys: ${Object.entries(keyDist).map(([k, v]) => `${k}:${v}`).join(', ') || 'none'}`);

      if (trackCount === 0) {
        throw new Error('Playlist is empty – no tracks matched constraints');
      }

      // 2. Analyze the setlist
      const analyzeResult = await setlistTools.analyzeSetlist({
        playlist_name: `Test: ${testCase.name}`
      });

      if (!analyzeResult.success) {
        throw new Error(`Analysis failed: ${analyzeResult.error}`);
      }

      const analysis = analyzeResult.analysis;
      console.log(`   ✅ Analyzed: ${analysis.trackCount} tracks, ${analysis.totalDurationMinutes.toFixed(1)} min`);
      console.log(`      Harmonic compatibility: ${(analysis.harmonicCompatibilityScore * 100).toFixed(1)}%`);
      console.log(`      Genre diversity: ${(analysis.genreDiversityScore * 100).toFixed(1)}%`);
      console.log(`      Artist diversity: ${(analysis.artistConcentration.diversityScore * 100).toFixed(1)}%`);
      console.log(`      BPM gaps: ${analysis.gaps.length}`);
      if (analysis.gaps.length > 0) {
        console.log(`        ${analysis.gaps.map(g => `${g.from}→${g.to} (${g.bpmJump}BPM, ${g.severity})`).join(', ')}`);
      }

      // 3. Get transition suggestions
      const transResult = await setlistTools.suggestTransitions({
        playlist_name: `Test: ${testCase.name}`,
        limit_per_track: 3
      });

      if (!transResult.success) {
        throw new Error(`Transitions failed: ${transResult.error}`);
      }

      const suggestions = transResult.suggestions;
      const perfectCount = suggestions.filter(s => s.transitionType === 'perfect').length;
      const goodCount = suggestions.filter(s => s.transitionType === 'good').length;
      console.log(`   ✅ Transitions: ${suggestions.length} total (${perfectCount} perfect, ${goodCount} good)`);

      // Show a couple of example suggestions
      if (suggestions.length > 0) {
        const example = suggestions[0];
        console.log(`      Example: ${example.currentTrack.name} → ${example.nextTrack.name}`);
        console.log(`        Score: ${example.compatibilityScore.toFixed(2)}, Type: ${example.transitionType}`);
        console.log(`        Tip: ${example.mixTip}`);
      }

      // Validate scores are in range
      const invalidScores = suggestions.filter(s => s.compatibilityScore < 0 || s.compatibilityScore > 1);
      if (invalidScores.length > 0) {
        throw new Error(`Invalid compatibility scores detected`);
      }

      console.log(`   ✅ PASSED\n`);
      passed++;

    } catch (error) {
      console.log(`   ❌ FAILED: ${error.message}\n`);
      failed++;
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total test cases: ${testCases.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Success rate: ${((passed / testCases.length) * 100).toFixed(1)}%`);

  if (failed > 0) {
    console.log('\n❌ Some tests failed. Review output above.');
    process.exit(1);
  } else {
    console.log('\n🎉 All smart feature tests passed!');
    console.log('The smart playlist and setlist tools are working correctly.');
  }

  // Close the function
}

// Run the tests
runDeepTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
