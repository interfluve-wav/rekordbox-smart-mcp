# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Setlist tools suite:
  - `playlist_buildSmart`: Build playlists using energy curves, BPM ranges, key progression smoothing, and artist diversity
  - `setlist_analyze`: Comprehensive setlist analysis (harmonic compatibility, BPM gaps, genre/artist diversity, recommendations)
  - `setlist_suggestTransitions`: AI-driven transition suggestions with mix tips and compatibility scoring
- Mutation history and rollback system:
  - `mutation_history`: Query audit log with filters
  - `mutation_rollback`: Restore library state from any backup (creates pre-rollback backup)
- Automatic backup creation for all mutations (XML timestamped files)
- Audit logging to `audit/bonk-mutations.jsonl`
- Comprehensive test suite and integration sweep script
- `TEST_REPORT.md` with full feature demonstration

### Changed
- Streamlined tool set from 45+ to 33 canonical tools (removed tiered aliases, Supermemory, natlang search, audio analysis binaries, UI dashboard)
- Server renamed from `bonk-mcp` to `rekordbox-smart-mcp`
- Simplified configuration (removed unused `limits` and `api_keys` sections)
- All mutation tools now return `backup` field with backup file path
- Library sanitization improved (filters stock Rekordbox sampler sounds)

### Removed
- Tiered tool aliases (`safe_`, `write_`, `danger_` prefixes)
- Supermemory integration (`supermemory_add`, `supermemory_search`, `supermemory_getDocument`)
- Natural language search (`search_natlang`)
- Audio analysis tools requiring external binaries (`audio_detectKey`, `audio_bpmDetectAubio`, `audio_extractAlbumArt`, `audio_getMetadata`, `audio_convert`)
- UI dashboard resource (`ui_dashboard`)
- Debug tools (`debug_searchLogStatus`)
- CSV export (`library_exportCSV`) – JSON export retained
- Fuzzy search (`library_fuzzySearch`) – retained (was listed for removal but kept)
- Notion sync integration from audit logging

### Fixed
- TypeScript compilation errors in setlist tools (undefined key handling)
- Double-backup issue in `playlist_buildSmart` (now uses service directly after single backup)
- Mutation logging consistency across all mutation tools

## [1.0.0] – 2026-04-07

Initial stable release of rekordbox-smart-mcp.

### Features
- Library operations: load, search, stats, fuzzy search, key-compatible search, find missing/duplicates, export
- Track operations: get, update (single/batch), playlist membership
- Playlist operations: create, add, remove, rename, delete
- Rekordbox integration: XML import/export, DB sync via `pyrekordbox`
- DJ analytics: sessions, history stats, play counts, listening patterns
- BPM cache management
- Safety: automatic backups, audit log, rollback capability
- ~33 canonical tools

### Documentation
- `README.md`: Comprehensive reference with examples
- `QUICKSTART.md`: Quick setup and common workflows
- `Examples.md`: Tool call examples with typical responses
- `mcp.json.example`: MCP client configuration template

### Tooling
- Build system: TypeScript + Node.js
- Tests: Jest with ESM support
- Integration sweep: `scripts/run-all-mcp-tools.mts`
- UI tool catalog for dashboard integration

## [0.1.0] – Pre-release (bonk-mcp era)

_Original development version with 45+ tools including experimental features, tiered aliases, and external integrations._
