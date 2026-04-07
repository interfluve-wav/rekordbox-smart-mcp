# Smart Features – Rekordbox Smart MCP

This document details the intelligent features that set rekordbox-smart-mcp apart: smart playlist composition, setlist analysis, and transition suggestions. These tools use musical theory, energy modeling, and algorithmic composition to help DJs create better setlists.

---

## Table of Contents

1. [Smart Playlist Building](#smart-playlist-building)
2. [Setlist Analysis](#setlist-analysis)
3. [Transition Suggestions](#transition-suggestions)
4. [Technical Deep Dive](#technical-deep-dive)
5. [Workflows](#workflows)

---

## Smart Playlist Building

### `playlist_buildSmart`

Creates playlists algorithmically based on musical rules and constraints. Unlike simple search-based playlist creation, `playlist_buildSmart` uses a greedy composition algorithm that optimizes for multiple factors simultaneously.

### What It Does

Given a library of tracks and a set of rules, the tool selects and orders tracks to match your criteria:

- **Energy curve shaping** – create playlists that build, peak, and wind down
- **BPM constraints** – stay within a tempo range
- **Key progression** – smooth harmonic transitions between tracks
- **Artist diversity** – avoid repeating the same artist
- **Genre filtering** – focus on specific genres
- **Mandatory inclusions/exclusions** – force certain tracks or exclude others

### Energy Curves

The energy curve determines how the playlist's intensity progresses:

| Curve | Description | Use Case |
|-------|-------------|----------|
| `wave` | Sinusoidal: low → peak at 25% → trough at 75% → high | Balanced sets with variation |
| `ramp-up` | Gradually increasing energy | Warmup sets that build |
| `ramp-down` | Gradually decreasing energy | Wind-down sets, afterhours |
| `flat` | Generally mid-energy with ±20% variation | Steady, consistent vibes |

**Energy Calculation:**

Energy is a weighted score (0-1) for each track:

```
energy = 0.7 × normalized_BPM + 0.3 × normalized_rating
```

- `normalized_BPM` = (BPM - 60) / (180 - 60), clamped to 0-1
- `normalized_rating` = ratingByte / 255 (0-1 scale)

### Key Progression

- `smooth`: Reorders selected tracks to minimize Camelot distance between consecutive tracks
- `mixed`: No key-based ordering (tracks selected in random/lib order)
- `random`: Random selection and ordering

### Example Request

```json
{
  "name": "playlist_buildSmart",
  "arguments": {
    "playlistName": "Prime Time Techno",
    "rules": {
      "energy_curve": "wave",
      "max_tracks": 20,
      "bpm_range": { "min": 130, "max": 140 },
      "key_progression": "smooth",
      "preferred_genres": ["Techno", "Hard Techno"],
      "avoid_artist_repeat": true,
      "include_tracks": ["track_id_123"]
    }
  }
}
```

### Response

```json
{
  "success": true,
  "playlist": {
    "Name": "Prime Time Techno",
    "Type": "1",
    "Entries": ["track_id_456", "track_id_789", ...]
  },
  "stats": {
    "trackCount": 20,
    "totalDurationMinutes": 125,
    "bpmRange": { "min": 132, "max": 139 },
    "keyDistribution": { "4A": 5, "5A": 4, "6A": 3, ... },
    "averageEnergy": 0.78
  }
}
```

### Algorithm Overview

1. **Filter** candidates based on BPM, genre, exclusions
2. **Ensure** included tracks are present
3. **Score** all candidates by how well they match target energy at their position
4. **Greedy selection**: for each position (0 to N), pick best remaining track
5. **Optional reordering** for key smoothing (local swaps to improve harmonic flow)

---

## Setlist Analysis

### `setlist_analyze`

Provides a comprehensive diagnostic of a playlist or arbitrary track list. Analyzes harmonic compatibility, BPM gaps, diversity, and provides actionable recommendations.

### What It Analyzes

- **Track count and total duration**
- **BPM statistics** (average, range, gaps)
- **Key distribution** (Camelot wheel positions)
- **Genre diversity score** (0-1, Shannon entropy normalized)
- **Harmonic compatibility score** (0-1, % of consecutive tracks with Camelot distance ≤1)
- **Artist concentration** (Herfindahl-Hirschman Index)
- **Artist diversity score** (0-1)
- **Energy curve** (array of energy values by track position)
- **BPM gaps** – jumps >20 BPM with severity rating
- **Recommendations** – actionable suggestions to improve the setlist

### Harmonic Compatibility

Two tracks are harmonically compatible if their Camelot keys are:

- Same key (e.g., 4A + 4A = perfect)
- Adjacent on the wheel (e.g., 4A + 3A or 4A + 5A = good)
- Same number, different mode (e.g., 4A + 4B = energy boost)

The compatibility score is the percentage of consecutive track pairs with distance ≤1.

### BPM Gaps

A BPM gap is a jump >20 BPM between consecutive tracks:

- **Severity**: `major` (>50 BPM), `moderate` (30-50 BPM), `minor` (20-30 BPM)
- Gaps are listed with track indices and BPM delta

### Artist Concentration

Measured by HHI: sum of squared market shares. A higher concentration means one artist dominates. Diversity score = 1 - normalized_HHI.

### Example Request

```json
{
  "name": "setlist_analyze",
  "arguments": {
    "playlist_name": "My Weekend Set"
  }
}
```

### Example Response

```json
{
  "success": true,
  "analysis": {
    "playlistName": "My Weekend Set",
    "trackCount": 15,
    "totalDurationMinutes": 93,
    "avgBpm": 128.4,
    "bpmRange": { "min": 118, "max": 142 },
    "keyDistribution": { "4A": 4, "5A": 3, "8A": 3, "3A": 2, "6A": 2, "1A": 1 },
    "genreDiversity": 0.73,
    "harmonicCompatibility": 0.86,
    "artistConcentration": 0.18,
    "artistDiversity": 0.72,
    "energyCurve": [0.45, 0.52, 0.68, 0.72, 0.71, 0.65, 0.58, 0.62, 0.75, 0.82, 0.78, 0.70, 0.62, 0.55, 0.48],
    "bpmGaps": [
      { "from": 3, "to": 4, "delta": 24, "severity": "minor" }
    ],
    "recommendations": [
      "Good harmonic flow (86% compatibility)",
      "Minor BPM gap between track 3 and 4 (118 → 142 BPM) – consider adding a transition track",
      "Consider adding tracks in 7A or 9A to diversify key palette",
      "Artist diversity is good – 11 unique artists in 15 tracks"
    ]
  }
}
```

---

## Transition Suggestions

### `setlist_suggestTransitions`

For each track in a setlist, suggests 2-3 candidate next tracks with compatibility scores and mixing advice.

### Scoring System

Each candidate track receives a compatibility score (0-1) based on:

| Factor | Points | Description |
|--------|--------|-------------|
| Key distance 0 (same) | +0.6 | Perfect harmonic match |
| Key distance 1 (adjacent) | +0.4 | Compatible keys |
| Key distance 2+ | +0.1 | Less compatible |
| BPM diff ≤5 | +0.3 | Matched tempos |
| BPM diff ≤15 | +0.2 | Close tempos |
| BPM diff ≤30 | +0.1 | Moderate tempo difference |
| Rating bonus | up to +0.1 | Based on track rating (0-5 stars) |

Maximum possible score: 1.0 (not reached due to rating cap)

### Transition Types

Based on score thresholds:

- `perfect` (≥0.8) – Ideal match, harmonic and tempo aligned
- `good` (≥0.6) – Strong candidate, minor compromises
- `acceptable` (≥0.4) – Useable with creative mixing
- `poor` (<0.4) – Not recommended

### Mix Tips

The tool provides specific advice for each transition based on key and BPM relationship:

- "Perfect harmonic match (4A → 4A). Mix at phrase boundary."
- "Adjacent keys (4A → 3A). Compatible with energy increase."
- "Same key, different mode (4A → 4B). Energy boost transition."
- "BPM change: 128 → 134 (+6). Quick pitch adjustment needed."
- "Tempo drift: -18 BPM. Consider looping or using echo out."

### Example Request

```json
{
  "name": "setlist_suggestTransitions",
  "arguments": {
    "playlist_name": "My Weekend Set",
    "limit_per_track": 2
  }
}
```

### Example Response

```json
{
  "success": true,
  "suggestions": [
    {
      "currentTrack": {
        "id": "track_001",
        "name": "Pulse",
        "artist": "Techno Driver",
        "bpm": 132,
        "key": "4A"
      },
      "nextTrack": {
        "id": "track_042",
        "name": "Frequency",
        "artist": "Bass Mechanic",
        "bpm": 132,
        "key": "4A"
      },
      "compatibilityScore": 0.92,
      "transitionType": "perfect",
      "mixTip": "Perfect harmonic match (4A → 4A). Mix at phrase boundary."
    },
    {
      "currentTrack": { "id": "track_001", "name": "Pulse", "artist": "Techno Driver", "bpm": 132, "key": "4A" },
      "nextTrack": {
        "id": "track_089",
        "name": "Pressure Drop",
        "artist": "Dub Smith",
        "bpm": 128,
        "key": "3A"
      },
      "compatibilityScore": 0.74,
      "transitionType": "good",
      "mixTip": "Adjacent keys (4A → 3A). Compatible with 4 BPM decrease."
    }
  ]
}
```

---

## Technical Deep Dive

### Camelot Harmonic Mixing

The Camelot system simplifies harmonic mixing by mapping all major/minor keys to 12 positions × 2 modes:

- Positions: 1 through 12 (circle of fifths)
- Modes: A (minor), B (major)

Compatibility rules:

1. **Same position, any mode** – compatible (energy boost if mode differs)
2. **Adjacent positions, same mode** – compatible (e.g., 4A ↔ 3A or 4A ↔ 5A)
3. **Position 12 is adjacent to position 1** (wraparound)

Distance calculation:

```typescript
function camelotDistance(a: string, b: string): number {
  if (!a || !b) return 12;
  const aNum = parseInt(a.slice(0, -1), 10);
  const aMode = a.slice(-1);
  const bNum = parseInt(b.slice(0, -1), 10);
  const bMode = b.slice(-1);
  if (aMode === bMode) {
    const diff = Math.abs(aNum - bNum);
    return Math.min(diff, 12 - diff);  // wraparound
  }
  return aNum === bNum ? 1 : 7;  // same position = distance 1, else far
}
```

### Greedy Playlist Construction

The `playlist_buildSmart` algorithm:

1. **Candidate filtering**: Apply BPM range, genre, exclusions
2. **Mandatory inclusion**: Force-add any `include_tracks` regardless of filters
3. **Position targets**: For each position i (0 to N-1), compute target energy based on curve
4. **Scoring**: For each candidate at each position, score = 1 - |track_energy - target_energy|
5. **Greedy selection**: Pick highest-scoring candidate, remove from pool, repeat
6. **Key smoothing pass** (if `key_progression: smooth`): Iterate through playlist, attempt local swaps to reduce average Camelot distance between consecutive tracks

Complexity: O(N×M) where N = number of tracks to select, M = candidate pool size. With M ~ hundreds and N ~ tens, this is fast in practice.

### Diversity Metrics

**Genre diversity** (Shannon entropy):

```
H = -Σ p_i × log₂(p_i)  for each genre i
diversity = H / log₂(number_of_genres)
```

**Artist diversity**:

```
HHI = Σ (market_share_i)²  where market_share = tracks_by_artist / total_tracks
diversity = 1 - (HHI - 1/N) / (1 - 1/N)  [normalized to 0-1]
```

---

## Workflows

### Workflow 1: Create a Cohesive Setlist

1. **Search for candidates**:

```json
{
  "name": "library_search",
  "arguments": {
    "filters": { "genre": "House" },
    "limit": 100
  }
}
```

2. **Build the playlist**:

```json
{
  "name": "playlist_buildSmart",
  "arguments": {
    "playlistName": "House Journey",
    "rules": {
      "energy_curve": "wave",
      "max_tracks": 20,
      "bpm_range": { "min": 118, "max": 128 },
      "key_progression": "smooth",
      "avoid_artist_repeat": true
    }
  }
}
```

3. **Analyze**:

```json
{
  "name": "setlist_analyze",
  "arguments": { "playlist_name": "House Journey" }
}
```

4. **Get transition suggestions**:

```json
{
  "name": "setlist_suggestTransitions",
  "arguments": {
    "playlist_name": "House Journey",
    "limit_per_track": 2
  }
}
```

5. **Refine**: If analysis shows issues (gaps, poor harmonic flow), adjust rules and rebuild or manually edit with `track_update`.

### Workflow 2: Warm-up Set Preparation

```json
{
  "name": "playlist_buildSmart",
  "arguments": {
    "playlistName": "Warmup - 90-110 BPM",
    "rules": {
      "energy_curve": "ramp-up",
      "bpm_range": { "min": 90, "max": 110 },
      "key_progression": "smooth",
      "preferred_genres": ["Deep House", "Chill House"],
      "avoid_artist_repeat": true,
      "max_tracks": 15
    }
  }
}
```

Result: A 15-track set that gradually increases energy, stays in a narrow BPM window, and flows harmonically – perfect for opening a gig.

### Workflow 3: Peak-Time Set with Guaranteed Crowd Pleasers

Use `include_tracks` to force specific "must-play" tracks:

```json
{
  "name": "playlist_buildSmart",
  "arguments": {
    "playlistName": "Prime Time",
    "rules": {
      "energy_curve": "wave",
      "bpm_range": { "min": 128, "max": 138 },
      "key_progression": "smooth",
      "include_tracks": ["id_123", "id_456", "id_789"],
      "max_tracks": 20
    }
  }
}
```

The algorithm will place your mandatory tracks and fill the remaining slots with optimal complements.

---

## Limitations & Notes

- Smart features operate on the in-memory library state. If you make changes to the library, rebuild the playlist to incorporate updates.
- Energy estimation is a heuristic (70% BPM, 30% rating). For more accurate energy, consider manually rating tracks 1-5.
- Key smoothing is a local optimization; it may not find a globally optimal ordering but typically produces good results in <100 iterations.
- Transition suggestions only consider tracks present in the library. They do not fetch new tracks.
- All mutation operations (including playlist creation) create automatic XML backups – you can always roll back.

---

## Future Enhancements

Potential improvements for future versions:

- **Section-aware mixing**: Analyze track structures (intro, verse, chorus, breakdown) for phrase-aligned transitions
- **Energy normalization**: Apply RMS/loudness-based energy instead of BPM proxy
- **Machine learning**: Learn your mixing preferences to personalize suggestions
- **Multi-library support**: Pull candidates from multiple playlists or exports
- **Constraint programming**: More sophisticated playlist optimization (NP-hard problem; could use metaheuristics)
- **Real-time adaptation**: Adjust energy curves based on crowd reaction (would need external input)

---

These smart features represent the unique value proposition of rekordbox-smart-mcp: going beyond simple search to provide algorithmic composition assistance that respects DJing best practices.
