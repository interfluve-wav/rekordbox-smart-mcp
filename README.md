# Rekordbox Smart MCP

[![MCP Server](https://img.shields.io/badge/MCP-Server-blue)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org)

> **MCP server for DJs using Pioneer Rekordbox**

A production-ready MCP server providing essential tools for library management, smart playlist creation, DJ analytics, and safe mutations with full undo capability.

**Key advantages:**
- ✅ **No Python required** – works with XML exports; optional DB integration
- ✅ **Complete undo system** – all mutations create timestamped backups
- ✅ **Smart setlist tools** – harmonic analysis, transition suggestions, energy curves
- ✅ **Privacy-focused** – no external APIs, no telemetry
- ✅ **28 tools** – comprehensive error handling, audit logging

## Prerequisites

- **Node.js 18+**
- **Rekordbox 6 or 7** (for DJ analytics and DB import)
- Rekordbox XML export (File → Export → Export as XML)
- Optional: **Python 3 + pyrekordbox** for direct database import

## Safety First

⚠️ **All mutation operations create automatic XML backups** before making changes. Backups are timestamped and can be used to restore your library via `mutation_rollback`.

We recommend testing with a copy of your XML export before using on your main library.

## Quickstart

### 1. Install

```bash
npm install
npm run build
```

### 2. Configure

Add to your MCP client configuration:

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "rekordbox-smart-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/dist/index.js"]
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "rekordbox-smart-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/dist/index.js"]
    }
  }
}
```

### 3. Load Your Library

```json
{
  "name": "library_load",
  "arguments": {
    "xmlPath": "/path/to/your/rekordbox_export.xml"
  }
}
```

Or set a default path in `rekordbox-smart-mcp.toml` and call without arguments.

### 4. Try It

```json
{ "name": "library_stats", "arguments": {} }
{ "name": "library_search", "arguments": { "query": "house", "limit": 5 } }
```

## Features

### Library Management
- Full-text search with filters (genre, BPM, key, artist, album, year, rating)
- Statistics, duplicate detection, missing file finder
- Fuzzy search, harmonic key search
- JSON export

### Track Operations
- Get detailed metadata
- Single or batch updates (with automatic backups)
- Playlist membership queries

### Playlist Management
- Create, rename, delete playlists
- Add/remove tracks (add or replace modes)

### Smart Setlist Tools
- `playlist_buildSmart` – build playlists using energy curves, BPM ranges, key progression smoothing, artist diversity
- `setlist_analyze` – comprehensive analysis (harmonic compatibility, BPM gaps, genre/artist diversity, recommendations)
- `setlist_suggestTransitions` – AI-driven transition suggestions with mix tips and compatibility scoring

### Rekordbox Integration
- Import/export via XML
- Direct database sync (requires `pyrekordbox`)

### DJ Analytics
- Recent sessions, session tracks
- History stats, play count rankings
- Listening patterns (BPM, genres, keys)

### Safety & Undo
- `mutation_history` – query audit log with filters
- `mutation_rollback` – restore from any backup (creates pre-rollback backup)
- All mutations logged to `audit/bonk-mutations.jsonl`

## Configuration

Create `rekordbox-smart-mcp.toml` in your working directory, `~/.config/`, or `~`:

```toml
[library]
xml_path = "~/rekordbox/export.xml"

[rekordbox]
db_path = "~/Library/Pioneer/rekordbox/master.db"
auto_detect = true

[cache]
db_path = "~/.bonk/media-cache.db"
```

If `rekordbox.db_path` is not set, the server auto-detects the platform-specific location (macOS, Windows, Linux).

## Safety and Undo

All mutations create automatic XML backups in the working directory. Backup pattern: `bonk-backup-YYYY-MM-DDTHH-MM-SS-ffffff.xml`.

**Undo workflow:**

1. List recent mutations:
```json
{ "name": "mutation_history", "arguments": { "limit": 10 } }
```

2. Preview rollback (dry run):
```json
{
  "name": "mutation_rollback",
  "arguments": { "mutationId": "2026-04-07T09-03-07-724Z", "dryRun": true }
}
```

3. Execute rollback:
```json
{
  "name": "mutation_rollback",
  "arguments": { "mutationId": "2026-04-07T09-03-07-724Z", "dryRun": false }
}
```

Rollback creates a pre-rollback backup and logs itself as a new mutation, providing an undo chain.

## Tool Reference

### Library (9 tools)
`library_search`, `library_stats`, `library_listPlaylists`, `library_load`,
`library_findMissing`, `library_findDuplicates`, `library_fuzzySearch`,
`search_keyCompatible`, `library_exportJSON`

### Track (4 tools)
`track_get`, `track_update`, `track_playlists`, `track_updateBatch`

### Playlist (5 tools)
`playlist_create`, `playlist_addTracks`, `playlist_removeTracks`,
`playlist_delete`, `playlist_rename`

### Smart Setlist (3 tools)
`playlist_buildSmart`, `setlist_analyze`, `setlist_suggestTransitions`

### Rekordbox (3 tools)
`rekordbox_sync`, `rekordbox_importXml`, `rekordbox_exportXml`

### DJ Analytics (5 tools)
`dj_getRecentSessions`, `dj_getSessionTracks`, `dj_getHistoryStats`,
`dj_getPlayCountAnalytics`, `dj_getListeningPatterns`

### Audio (2 tools)
`audio_bpmGetCached`, `audio_bpmCacheSet`

### Safety (2 tools)
`mutation_history`, `mutation_rollback`

**Total: 28 canonical tools**

## Requirements

- Node.js 18+
- `better-sqlite3` (native module – rebuilt automatically on install)
- Optional: Python 3 + `pyrekordbox` for Rekordbox DB import

## Limitations

- Library is in-memory; must load XML or import DB on each server start
- Cache persists via `~/.bonk/library-state.json`
- DJ analytics require Rekordbox database access
- Rollback only works if backup file still exists
- Setlist tools operate on in-memory state (export to persist)

## License

MIT
