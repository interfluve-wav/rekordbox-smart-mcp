/**
 * Rekordbox history service.
 * Uses pyrekordbox to access encrypted Rekordbox DB tables.
 */

import { spawn } from 'child_process';
import { resolve } from 'path';
import { getConfig } from '../config.js';

const PYTHON_HISTORY_SCRIPT = `
import json
import sys

def emit(payload):
    print(json.dumps(payload, default=str))

try:
    from pyrekordbox.db6.database import Rekordbox6Database
except Exception as e:
    emit({"ok": False, "error": f"pyrekordbox import failed: {e}"})
    sys.exit(0)

def normalize_bpm(raw):
    if raw is None:
        return None
    try:
        v = float(raw)
        return v / 2 if v > 180 else v
    except (TypeError, ValueError):
        return None

db_path = sys.argv[1] if len(sys.argv) > 1 else ""
mode = sys.argv[2] if len(sys.argv) > 2 else ""
arg = sys.argv[3] if len(sys.argv) > 3 else ""

if not db_path:
    emit({"ok": False, "error": "No Rekordbox DB path configured"})
    sys.exit(0)

try:
    db = Rekordbox6Database(path=db_path, unlock=True)
except Exception as e:
    emit({"ok": False, "error": f"Failed to open Rekordbox DB: {e}"})
    sys.exit(0)

try:
    with db.engine.connect() as conn:
        if mode == "recent_sessions":
            days = int(arg) if arg else 30
            rows = conn.exec_driver_sql(
                """
                SELECT h.ID, h.Name, h.DateCreated, COUNT(sh.ContentID) AS TrackCount
                FROM djmdHistory h
                LEFT JOIN djmdSongHistory sh ON sh.HistoryID = h.ID
                WHERE h.DateCreated >= datetime('now', ?)
                GROUP BY h.ID, h.Name, h.DateCreated
                ORDER BY h.DateCreated DESC
                """,
                (f"-{days} days",),
            ).fetchall()
            sessions = [
                {
                    "id": str(r[0]),
                    "name": r[1],
                    "dateCreated": r[2],
                    "trackCount": int(r[3] or 0),
                }
                for r in rows
            ]
            emit({"ok": True, "data": sessions})

        elif mode == "session_tracks":
            session_id = arg
            rows = conn.exec_driver_sql(
                """
                SELECT sh.TrackNo, c.ID, c.Title, a.Name AS Artist, c.BPM, c.Length, c.Rating
                FROM djmdSongHistory sh
                LEFT JOIN djmdContent c ON c.ID = sh.ContentID
                LEFT JOIN djmdArtist a ON a.ID = c.ArtistID
                WHERE sh.HistoryID = ?
                ORDER BY sh.TrackNo ASC
                """,
                (session_id,),
            ).fetchall()
            tracks = [
                {
                    "trackNo": int(r[0] or 0),
                    "contentId": str(r[1]) if r[1] is not None else None,
                    "title": r[2],
                    "artist": r[3],
                    "bpm": normalize_bpm(r[4]),
                    "lengthSeconds": r[5],
                    "rating": r[6],
                }
                for r in rows
            ]
            emit({"ok": True, "data": tracks})

        elif mode == "history_stats":
            total_sessions = conn.exec_driver_sql("SELECT COUNT(*) FROM djmdHistory").scalar() or 0
            total_plays = conn.exec_driver_sql("SELECT COUNT(*) FROM djmdSongHistory").scalar() or 0
            unique_tracks = conn.exec_driver_sql("SELECT COUNT(DISTINCT ContentID) FROM djmdSongHistory").scalar() or 0

            top_rows = conn.exec_driver_sql(
                """
                SELECT sh.ContentID, c.Title, a.Name AS Artist, COUNT(*) AS PlayCount
                FROM djmdSongHistory sh
                LEFT JOIN djmdContent c ON c.ID = sh.ContentID
                LEFT JOIN djmdArtist a ON a.ID = c.ArtistID
                GROUP BY sh.ContentID, c.Title, a.Name
                ORDER BY PlayCount DESC
                LIMIT 20
                """
            ).fetchall()
            top_tracks = [
                {
                    "contentId": str(r[0]) if r[0] is not None else None,
                    "title": r[1],
                    "artist": r[2],
                    "playCount": int(r[3] or 0),
                }
                for r in top_rows
            ]

            emit({
                "ok": True,
                "data": {
                    "totalSessions": int(total_sessions),
                    "totalPlays": int(total_plays),
                    "uniqueTracksPlayed": int(unique_tracks),
                    "topTracks": top_tracks,
                },
            })
        else:
            emit({"ok": False, "error": f"Unknown mode: {mode}"})
except Exception as e:
    emit({"ok": False, "error": str(e)})
finally:
    try:
        db.close()
    except Exception:
        pass
`;

type HistoryMode = 'recent_sessions' | 'session_tracks' | 'history_stats';

async function runHistoryQuery(mode: HistoryMode, arg?: string): Promise<{ ok: boolean; data?: any; error?: string }> {
  const config = getConfig();
  const dbPath = config.rekordbox.db_path?.trim();
  if (!dbPath) {
    return { ok: false, error: 'rekordbox.db_path is empty (set [rekordbox] db_path to override the default Pioneer path)' };
  }

  const resolvedDbPath = resolve(dbPath);

  return new Promise((resolvePromise) => {
    const args = ['-c', PYTHON_HISTORY_SCRIPT, resolvedDbPath, mode];
    if (arg !== undefined) args.push(arg);

    const child = spawn('python3', args);
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', () => {
      const trimmed = stdout.trim();
      if (!trimmed) {
        resolvePromise({ ok: false, error: stderr || 'No output from Python history query' });
        return;
      }
      try {
        const parsed = JSON.parse(trimmed);
        resolvePromise(parsed);
      } catch {
        resolvePromise({ ok: false, error: `Failed to parse Python output: ${trimmed}` });
      }
    });

    child.on('error', (error) => {
      resolvePromise({ ok: false, error: error.message });
    });
  });
}

export async function getRecentSessionsFromDb(days: number = 30) {
  return runHistoryQuery('recent_sessions', String(days));
}

export async function getSessionTracksFromDb(sessionId: string) {
  return runHistoryQuery('session_tracks', sessionId);
}

export async function getHistoryStatsFromDb() {
  return runHistoryQuery('history_stats');
}
