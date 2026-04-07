# Rekordbox Smart MCP – Quickstart

Get up and running with the Rekordbox Smart MCP server in minutes.

## Installation

```bash
npm install
npm run build
```

## Configure MCP Client

### Claude Desktop

Edit the config file for your OS:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

Add:

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

Restart Claude Desktop.

### Cursor

Add to `.cursor/mcp.json` in your project root:

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

Reload Cursor (`Cmd+Shift+P` → "Developer: Reload Window").

## First Steps

### 1. Load Your Library

Export your library from Rekordbox as XML (File → Export → Export as XML), then:

```json
{
  "name": "library_load",
  "arguments": {
    "xmlPath": "/path/to/your/rekordbox_export.xml"
  }
}
```

Or import directly from Rekordbox database (requires `pyrekordbox`):

```json
{
  "name": "rekordbox_sync",
  "arguments": {
    "action": "import",
    "source": "/path/to/rekordbox/master.db"
  }
}
```

### 2. Explore

```json
{ "name": "library_stats", "arguments": {} }
{ "name": "library_search", "arguments": { "query": "house", "limit": 5 } }
```

### 3. Build a Smart Playlist

```json
{
  "name": "playlist_buildSmart",
  "arguments": {
    "playlistName": "Warmup Set",
    "rules": {
      "energy_curve": "ramp-up",
      "max_tracks": 15,
      "bpm_range": { "min": 100, "max": 120 },
      "avoid_artist_repeat": true
    }
  }
}
```

### 4. Analyze & Get Transitions

```json
{
  "name": "setlist_analyze",
  "arguments": { "playlist_name": "Warmup Set" }
}
```

```json
{
  "name": "setlist_suggestTransitions",
  "arguments": {
    "playlist_name": "Warmup Set",
    "limit_per_track": 2
  }
}
```

## Common Tasks

### Search by BPM and genre

```json
{
  "name": "library_search",
  "arguments": {
    "query": "deep house",
    "filters": {
      "bpm": { "min": 118, "max": 124 },
      "genre": "House"
    },
    "sort": { "column": "bpm", "direction": "asc" },
    "limit": 20
  }
}
```

### Find harmonically compatible tracks

```json
{
  "name": "search_keyCompatible",
  "arguments": { "key": "4A", "limit": 10 }
}
```

### Update track metadata

```json
{
  "name": "track_update",
  "arguments": {
    "trackId": "123456789",
    "updates": {
      "genre": "Deep House",
      "rating": 4,
      "comments": "Tagged via MCP"
    }
  }
}
```

### Undo changes

List recent mutations:
```json
{ "name": "mutation_history", "arguments": { "limit": 5 } }
```

Rollback (dry run first):
```json
{
  "name": "mutation_rollback",
  "arguments": {
    "mutationId": "2026-04-07T08:15:14.926Z",
    "dryRun": true
  }
}
```

Set `dryRun: false` to execute.

## Tips

- All mutations create automatic XML backups – no manual backup needed
- Library caches in `~/.bonk/library-state.json` for faster restarts
- Use `library_findMissing` to locate missing files
- Use `library_findDuplicates` to clean up duplicates
- DJ analytics (`dj_*` tools) require `rekordbox.db_path` in config
- Set `include_tracks` in `playlist_buildSmart` to force-include specific tracks

## Next Steps

- Full tool reference: See [`README.md`](./README.md)
- Detailed examples: See [`Examples.md`](./Examples.md)
- Configuration options: See `rekordbox-smart-mcp.toml`
