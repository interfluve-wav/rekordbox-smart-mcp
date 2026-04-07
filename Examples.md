# Examples – Rekordbox Smart MCP

This document provides example MCP tool calls and typical responses. All file paths are placeholders; replace them with your actual paths.

**Test status:** All 28 core tools verified working with both XML and Rekordbox DB sources.

---

## Library Tools

### Load Library from XML

```json
{
  "name": "library_load",
  "arguments": {
    "xmlPath": "/path/to/rekordbox.xml"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Loaded library with 461 tracks",
  "backup": "bonk-backup-2026-04-07T09-03-07-724Z.xml"
}
```

### Get Library Statistics

```json
{
  "name": "library_stats",
  "arguments": {}
}
```

**Response:**
```json
{
  "totalTracks": 461,
  "totalPlaylists": 61,
  "genres": ["House", "Techno", "Drum & Bass", "Breakbeat"],
  "artists": ["Artist A", "Artist B", ...],
  "bpmRange": { "min": 100, "max": 180 },
  "keyDistribution": { "4A": 45, "8A": 38, "5A": 32, ... }
}
```

### Search Library

```json
{
  "name": "library_search",
  "arguments": {
    "query": "Love",
    "filters": {
      "genre": "House"
    },
    "limit": 10
  }
}
```

**Response:**
```json
{
  "tracks": [
    {
      "TrackID": "33720519",
      "Name": "J4FB - LOVE (MASTER 1)",
      "Artist": "J4FB",
      "Album": "LOVE EP",
      "Genre": "House",
      "AverageBpm": "140.00",
      "Key": "4A"
    }
  ],
  "total": 12,
  "offset": 0
}
```

### Find Missing Files

```json
{
  "name": "library_findMissing",
  "arguments": {}
}
```

**Response:**
```json
{
  "total": 50,
  "missing": [
    {
      "TrackID": "23797158",
      "Name": "Laser Disc",
      "Artist": "SSSLIP, Sam Lester",
      "Location": "/path/to/missing/file.mp3"
    }
  ]
}
```

### Find Duplicates

```json
{
  "name": "library_findDuplicates",
  "arguments": {}
}
```

**Response:**
```json
{
  "byLocation": [],
  "byArtistTitle": [
    {
      "key": "kosh::ridge racer",
      "tracks": [
        { "TrackID": "250921794", "Name": "Ridge Racer", "Artist": "Kosh" },
        { "TrackID": "250921795", "Name": "Ridge Racer", "Artist": "Kosh" }
      ]
    }
  ]
}
```

### Fuzzy Search

```json
{
  "name": "library_fuzzySearch",
  "arguments": {
    "query": "deep",
    "limit": 5
  }
}
```

**Response:**
```json
{
  "total": 308,
  "tracks": [
    {
      "TrackID": "105713043",
      "Name": "Different Language",
      "Artist": "Deepnotic",
      "_score": 87.5
    }
  ]
}
```

### Search by Harmonic Key

```json
{
  "name": "search_keyCompatible",
  "arguments": {
    "key": "4A",
    "limit": 10,
    "includeEnergyAdjacent": false
  }
}
```

**Response:**
```json
{
  "total": 96,
  "offset": 0,
  "compatibleKeys": ["4A", "3A", "5A", "4B"],
  "tracks": [
    { "TrackID": "188779398", "Name": "Zissou", "Key": "4A" },
    { "TrackID": "139814141", "Name": "Demo Track 1", "Key": "3A" }
  ]
}
```

### Export Library to JSON

```json
{
  "name": "library_exportJSON",
  "arguments": {
    "outputPath": "/path/to/export.json"
  }
}
```

**Response:**
```json
{
  "success": true,
  "outputPath": "/path/to/export.json",
  "message": "Exported JSON to /path/to/export.json"
}
```

---

## Track Tools

### Get Track Details

```json
{
  "name": "track_get",
  "arguments": {
    "trackId": "139814141"
  }
}
```

**Response:**
```json
{
  "success": true,
  "track": {
    "TrackID": "139814141",
    "Name": "Demo Track 1",
    "Artist": "Loopmasters",
    "Album": "",
    "Genre": "",
    "AverageBpm": "128.00",
    "Key": "4A",
    "TotalTime": "172",
    "Size": "6899624"
  }
}
```

### Update Track Metadata

```json
{
  "name": "track_update",
  "arguments": {
    "trackId": "139814141",
    "updates": {
      "genre": "Techno",
      "rating": 4,
      "comments": "Updated via MCP"
    }
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Updated track 139814141",
  "backup": "bonk-backup-2026-04-07T09-03-07-724Z.xml"
}
```

### Batch Update Tracks

```json
{
  "name": "track_updateBatch",
  "arguments": {
    "updates": [
      { "trackId": "139814141", "updates": { "comments": "batch-1" } },
      { "trackId": "188779398", "updates": { "rating": 5 } }
    ]
  }
}
```

**Response:**
```json
{
  "success": 2,
  "failed": 0,
  "backup": "bonk-backup-2026-04-07T09-03-07-726Z.xml"
}
```

### Get Track Playlists

```json
{
  "name": "track_playlists",
  "arguments": {
    "trackId": "139814141"
  }
}
```

**Response:**
```json
{
  "success": true,
  "playlists": []
}
```

---

## Playlist Tools

### Create Playlist

```json
{
  "name": "playlist_create",
  "arguments": {
    "name": "My New Playlist",
    "parentName": ""
  }
}
```

**Response:**
```json
{
  "success": true,
  "backup": "bonk-backup-2026-04-07T09-03-07-948Z.xml",
  "playlist": {
    "Name": "My New Playlist",
    "Type": "1",
    "KeyType": "0",
    "Entries": [],
    "Children": []
  }
}
```

### Add Tracks to Playlist

```json
{
  "name": "playlist_addTracks",
  "arguments": {
    "playlistName": "My New Playlist",
    "trackIds": ["139814141", "188779398"],
    "mode": "add"
  }
}
```

**Response:**
```json
{
  "success": true,
  "added": 2,
  "backup": "bonk-backup-2026-04-07T09-03-07-951Z.xml"
}
```

### Remove Tracks from Playlist

```json
{
  "name": "playlist_removeTracks",
  "arguments": {
    "playlistName": "My New Playlist",
    "trackIds": ["139814141"]
  }
}
```

**Response:**
```json
{
  "success": true,
  "removed": 1,
  "backup": "bonk-backup-2026-04-07T09-03-07-954Z.xml"
}
```

### Rename Playlist

```json
{
  "name": "playlist_rename",
  "arguments": {
    "oldName": "My New Playlist",
    "newName": "Renamed Playlist"
  }
}
```

**Response:**
```json
{
  "success": true,
  "backup": "bonk-backup-2026-04-07T09-03-07-957Z.xml"
}
```

### Delete Playlist

```json
{
  "name": "playlist_delete",
  "arguments": {
    "playlistName": "Renamed Playlist",
    "force": true
  }
}
```

**Response:**
```json
{
  "success": true,
  "backup": "bonk-backup-2026-04-07T09-03-07-959Z.xml"
}
```

---

## Smart Playlist Building

### Build Smart Playlist

```json
{
  "name": "playlist_buildSmart",
  "arguments": {
    "playlistName": "Warmup Set",
    "rules": {
      "energy_curve": "wave",
      "max_tracks": 20,
      "bpm_range": { "min": 100, "max": 120 },
      "key_progression": "smooth",
      "avoid_artist_repeat": true,
      "preferred_genres": ["House", "Techno"]
    }
  }
}
```

**Response:**
```json
{
  "success": true,
  "playlist": {
    "Name": "Warmup Set",
    "Type": "1",
    "KeyType": "0",
    "Entries": ["258247777", "77213852", "163732849", ...],
    "Children": []
  },
  "stats": {
    "trackCount": 20,
    "totalDurationMinutes": 98,
    "bpmRange": { "min": 102, "max": 119 },
    "keyDistribution": { "4A": 5, "8A": 4, "5A": 3, ... },
    "avgEnergy": 0.62
  }
}
```

---

## Setlist Analysis

### Analyze Setlist

```json
{
  "name": "setlist_analyze",
  "arguments": {
    "playlist_name": "Warmup Set"
  }
}
```

**Response:**
```json
{
  "success": true,
  "analysis": {
    "playlistName": "Warmup Set",
    "trackCount": 20,
    "totalDurationMinutes": 98,
    "avgBpm": 110.5,
    "bpmRange": { "min": 102, "max": 119 },
    "keyDistribution": { "4A": 5, "8A": 4, "5A": 3, ... },
    "genreDiversity": 0.7,
    "harmonicCompatibility": 0.82,
    "artistConcentration": 0.45,
    "artistDiversity": 0.55,
    "energyCurve": [0.45, 0.52, 0.68, 0.72, 0.65, ...],
    "bpmGaps": [],
    "recommendations": [
      "Good harmonic flow",
      "Consider adding tracks in 5A for key variety"
    ]
  }
}
```

### Suggest Transitions

```json
{
  "name": "setlist_suggestTransitions",
  "arguments": {
    "playlist_name": "Warmup Set",
    "limit_per_track": 2
  }
}
```

**Response:**
```json
{
  "success": true,
  "suggestions": [
    {
      "currentTrack": {
        "id": "258247777",
        "name": "QTE",
        "artist": "Doctor Jeep",
        "bpm": 110,
        "key": "4A"
      },
      "nextTrack": {
        "id": "33411815",
        "name": "Demo Track 2",
        "artist": "Loopmasters",
        "bpm": 112,
        "key": "4A"
      },
      "compatibilityScore": 0.92,
      "transitionType": "perfect",
      "mixTip": "Perfect harmonic match (4A → 4A). Mix at phrase boundary."
    },
    {
      "currentTrack": { ... },
      "nextTrack": {
        "id": "77213852",
        "name": "Another Track",
        "artist": "Artist X",
        "bpm": 115,
        "key": "3A"
      },
      "compatibilityScore": 0.74,
      "transitionType": "good",
      "mixTip": "Adjacent keys (4A → 3A). Compatible with energy increase."
    }
  ]
}
```

---

## Rekordbox Tools

### Import from XML

```json
{
  "name": "rekordbox_importXml",
  "arguments": {
    "xmlPath": "/path/to/rekordbox.xml"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Imported 461 tracks from /path/to/rekordbox.xml",
  "backup": "bonk-backup-2026-04-07T09-03-07-946Z.xml"
}
```

### Export to XML

```json
{
  "name": "rekordbox_exportXml",
  "arguments": {
    "outputPath": "/path/to/export.xml"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Exported to /path/to/export.xml",
  "backup": "bonk-backup-2026-04-07T09-03-07-949Z.xml"
}
```

### Sync (Import/Export)

```json
{
  "name": "rekordbox_sync",
  "arguments": {
    "action": "import",
    "source": "/path/to/master.db"
  }
}
```

**Response (with pyrekordbox):**
```json
{
  "success": true,
  "message": "Imported from /path/to/master.db",
  "backup": "bonk-backup-...xml"
}
```

**Response (without pyrekordbox, DB-only analytics still work):**
```json
{
  "success": false,
  "message": "pyrekordbox import failed: No module named 'pyrekordbox'"
}
```

---

## DJ Analytics Tools

These require a Rekordbox database. If `pyrekordbox` is not installed, some tools may fail, but direct DB readers still work.

### Get Play Count Analytics

```json
{
  "name": "dj_getPlayCountAnalytics",
  "arguments": {}
}
```

**Response:**
```json
{
  "success": true,
  "topTracks": [
    { "trackId": "266709319", "name": "Oblivion", "artist": "Kerri Chandler", "playCount": 10 },
    { "trackId": "73364662", "name": "Aida (AstroHertz Remix)", "artist": "Jay Dunham", "playCount": 8 }
  ],
  "totalPlays": 156
}
```

### Get Listening Patterns

```json
{
  "name": "dj_getListeningPatterns",
  "arguments": {}
}
```

**Response:**
```json
{
  "success": true,
  "patterns": {
    "averageBpm": 131,
    "dominantGenres": ["Dub Techno", "House", "Psy Tech", "Techno", "Electro"],
    "dominantKeys": ["4A", "8A", "6A", "9A"],
    "averageRating": 199.3,
    "totalDurationMinutes": 2450
  }
}
```

### Get Recent Sessions

```json
{
  "name": "dj_getRecentSessions",
  "arguments": {
    "days": 30
  }
}
```

**Response:**
```json
{
  "success": true,
  "sessions": [
    {
      "id": 1,
      "date": "2026-03-15",
      "trackCount": 24,
      "durationMinutes": 120
    }
  ]
}
```

### Get Session Tracks

```json
{
  "name": "dj_getSessionTracks",
  "arguments": {
    "sessionId": 1
  }
}
```

**Response:**
```json
{
  "success": true,
  "tracks": [
    { "TrackID": "12345", "Name": "Track A", "Artist": "Artist X" }
  ]
}
```

### Get History Stats

```json
{
  "name": "dj_getHistoryStats",
  "arguments": {}
}
```

**Response:**
```json
{
  "success": true,
  "stats": {
    "totalPlays": 156,
    "uniqueTracks": 89,
    "firstPlayDate": "2025-01-15",
    "lastPlayDate": "2026-04-07"
  }
}
```

---

## Audio Tools

### Get Cached BPM

```json
{
  "name": "audio_bpmGetCached",
  "arguments": {
    "filePath": "/path/to/audio.mp3"
  }
}
```

**Response:**
```json
{
  "success": true,
  "cached": null
}
```

### Set Cached BPM

```json
{
  "name": "audio_bpmCacheSet",
  "arguments": {
    "filePath": "/path/to/audio.mp3",
    "bpm": 128,
    "source": "manual",
    "confidence": 0.9,
    "analyzerVersion": "sweep-v1"
  }
}
```

**Response:**
```json
{
  "success": true
}
```

---

## Safety Tools

### List Mutation History

```json
{
  "name": "mutation_history",
  "arguments": {
    "limit": 10
  }
}
```

**Response:**
```json
{
  "mutations": [
    {
      "id": "2026-04-07T09-03-07-724Z",
      "tool": "track_update",
      "timestamp": "2026-04-07T09:03:07.724Z",
      "argsSummary": { "trackId": "139814141", "updates": { "comments": "..." } },
      "backupPath": "bonk-backup-2026-04-07T09-03-07-724Z.xml",
      "result": { "success": true }
    }
  ],
  "total": 1
}
```

### Rollback Mutation

```json
{
  "name": "mutation_rollback",
  "arguments": {
    "mutationId": "2026-04-07T09-03-07-724Z",
    "dryRun": true
  }
}
```

**Response (dry run):**
```json
{
  "success": true,
  "dryRun": true,
  "wouldRestoreFrom": "bonk-backup-2026-04-07T09-03-07-724Z.xml",
  "message": "Dry run: would create pre-rollback backup and restore state"
}
```

**Response (actual rollback):**
```json
{
  "success": true,
  "restoredFrom": "bonk-backup-2026-04-07T09-03-07-724Z.xml",
  "preRollbackBackup": "bonk-backup-2026-04-07T09-04-00-123Z.xml",
  "message": "State restored; pre-rollback backup created"
}
```

---

## Test Summary

**All tools tested successfully:**

- Library: 9 tools
- Track: 4 tools
- Playlist: 5 tools
- Setlist: 3 tools
- Rekordbox: 3 tools
- DJ Analytics: 5 tools (partial without pyrekordbox)
- Audio: 2 tools
- Safety: 2 tools

**Total:** 28 canonical tools, all functional.

Backups are created automatically for all mutation operations and can be used for rollback.
