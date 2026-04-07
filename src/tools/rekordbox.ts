/**
 * Rekordbox Tools - MCP tools for Rekordbox integration
 */

import { mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';
import { getLibraryService } from '../services/library.js';
import type { RekordboxSyncInput } from '../types.js';
import type { Track, Playlist } from '../types.js';
import { ensureBackupBeforeWrite } from './backup.js';

function isProtectedPioneerPath(path: string): boolean {
  const resolved = resolve(path);
  const protectedRoot = resolve(homedir(), 'Library', 'Pioneer');
  return resolved === protectedRoot || resolved.startsWith(`${protectedRoot}/`);
}

function isAllowedProtectedMasterDb(path: string): boolean {
  const resolved = resolve(path);
  const allowed = resolve(homedir(), 'Library', 'Pioneer', 'rekordbox', 'master.db');
  return resolved === allowed;
}

const PYTHON_DB_IMPORT_SCRIPT = `
import json
import sys

def emit(payload):
    print(json.dumps(payload, default=str))

try:
    from pyrekordbox.db6.database import Rekordbox6Database
except Exception as e:
    emit({"ok": False, "error": f"pyrekordbox import failed: {e}"})
    sys.exit(0)

db_path = sys.argv[1] if len(sys.argv) > 1 else ""
if not db_path:
    emit({"ok": False, "error": "No DB path provided"})
    sys.exit(0)

try:
    db = Rekordbox6Database(path=db_path, unlock=True)
except Exception as e:
    emit({"ok": False, "error": f"Failed to open Rekordbox DB: {e}"})
    sys.exit(0)

try:
    with db.engine.connect() as conn:
        tracks_rows = conn.exec_driver_sql(
            """
            SELECT
              c.ID as TrackID,
              c.Title as Name,
              a.Name as Artist,
              al.Name as Album,
              g.Name as Genre,
              c.BPM as AverageBpm,
              c.Length as TotalTime,
              c.ReleaseYear as Year,
              c.DateCreated as DateAdded,
              c.Bitrate as BitRate,
              c.Samplerate as SampleRate,
              c.Commnt as Comments,
              c.DJPlayCount as PlayCount,
              c.Rating as Rating,
              c.FolderPath as FolderPath,
              c.FileNameL as FileName,
              c.StockDate as StockDate,
              k.ScaleName as Tonality,
              l.Name as Label
            FROM djmdContent c
            LEFT JOIN djmdArtist a ON a.ID = c.ArtistID
            LEFT JOIN djmdAlbum al ON al.ID = c.AlbumID
            LEFT JOIN djmdGenre g ON g.ID = c.GenreID
            LEFT JOIN djmdKey k ON k.ID = c.KeyID
            LEFT JOIN djmdLabel l ON l.ID = c.LabelID
            """
        ).mappings().all()

        playlists_rows = conn.exec_driver_sql(
            """
            SELECT ID, Name, Attribute, ParentID
            FROM djmdPlaylist
            """
        ).mappings().all()

        playlist_tracks_rows = conn.exec_driver_sql(
            """
            SELECT PlaylistID, ContentID, TrackNo
            FROM djmdSongPlaylist
            """
        ).mappings().all()

        tracks = []
        for r in tracks_rows:
            raw_bpm = r.get("AverageBpm")
            bpm_value = ""
            if raw_bpm is not None and str(raw_bpm) != "":
                try:
                    bpm_num = float(raw_bpm)
                    if bpm_num > 1000:
                        bpm_num = bpm_num / 100.0
                    bpm_value = f"{bpm_num:.2f}"
                except Exception:
                    bpm_value = str(raw_bpm)

            track = {
                "TrackID": str(r.get("TrackID", "")),
                "Name": r.get("Name") or "",
                "Artist": r.get("Artist") or "",
                "Album": r.get("Album") or "",
                "Genre": r.get("Genre") or "",
                "AverageBpm": bpm_value,
                "TotalTime": str(r.get("TotalTime") or ""),
                "Year": str(r.get("Year") or ""),
                "DateAdded": str(r.get("DateAdded") or ""),
                "BitRate": str(r.get("BitRate") or ""),
                "SampleRate": str(r.get("SampleRate") or ""),
                "Comments": r.get("Comments") or "",
                "PlayCount": str(r.get("PlayCount") or "0"),
                "Rating": str(r.get("Rating") or "0"),
                "Location": f"{r.get('FolderPath') or ''}{r.get('FileName') or ''}",
                "Tonality": r.get("Tonality") or "",
                "Key": r.get("Tonality") or "",
                "Label": r.get("Label") or "",
                "CuePoints": [],
            }
            tracks.append(track)

        playlist_entries = {}
        for r in playlist_tracks_rows:
            pid = str(r.get("PlaylistID", ""))
            tid = str(r.get("ContentID", ""))
            if not pid or not tid:
                continue
            playlist_entries.setdefault(pid, []).append((int(r.get("TrackNo") or 0), tid))

        for pid in list(playlist_entries.keys()):
            playlist_entries[pid] = [tid for _, tid in sorted(playlist_entries[pid], key=lambda x: x[0])]

        node_by_id = {}
        for r in playlists_rows:
            pid = str(r.get("ID", ""))
            name = r.get("Name") or ""
            attr = str(r.get("Attribute") or "")
            ptype = "0" if attr == "0" else "1"
            node_by_id[pid] = {
                "_id": pid,
                "_parent": str(r.get("ParentID") or ""),
                "Name": name,
                "Type": ptype,
                "KeyType": "0",
                "Entries": playlist_entries.get(pid, []) if ptype == "1" else [],
                "Children": [],
            }

        roots = []
        for pid, node in node_by_id.items():
            parent = node.pop("_parent", "")
            node.pop("_id", None)
            if parent and parent in node_by_id:
                node_by_id[parent]["Children"].append(node)
            else:
                roots.append(node)

        playlists = roots if roots else [{
            "Name": "ROOT",
            "Type": "0",
            "KeyType": "",
            "Entries": [],
            "Children": [],
        }]

        emit({"ok": True, "data": {"tracks": tracks, "playlists": playlists}})
except Exception as e:
    emit({"ok": False, "error": str(e)})
finally:
    try:
        db.close()
    except Exception:
        pass
`;

const PYTHON_DB_EXPORT_SCRIPT = `
import json
import sqlite3
import sys

def emit(payload):
    print(json.dumps(payload, default=str))

db_path = sys.argv[1] if len(sys.argv) > 1 else ""
mode = sys.argv[2] if len(sys.argv) > 2 else "merge"
if not db_path:
    emit({"ok": False, "error": "No DB path provided"})
    sys.exit(0)

try:
    payload = json.loads(sys.stdin.read() or "{}")
except Exception as e:
    emit({"ok": False, "error": f"Invalid stdin JSON: {e}"})
    sys.exit(0)

playlists = payload.get("playlists", [])
if not isinstance(playlists, list):
    emit({"ok": False, "error": "Payload playlists must be an array"})
    sys.exit(0)

try:
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = OFF")

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS djmdPlaylist (
            ID TEXT PRIMARY KEY,
            Name TEXT,
            Attribute INTEGER,
            ParentID TEXT
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS djmdSongPlaylist (
            PlaylistID TEXT,
            ContentID TEXT,
            TrackNo INTEGER
        )
        """
    )

    if mode == "overwrite":
        conn.execute("DELETE FROM djmdSongPlaylist")
        conn.execute("DELETE FROM djmdPlaylist")

    id_counter = [900000000]
    playlist_count = [0]
    link_count = [0]

    def next_id():
        id_counter[0] += 1
        return str(id_counter[0])

    def upsert_node(node, parent_id):
        if not isinstance(node, dict):
            return
        pid = next_id()
        name = str(node.get("Name") or "Untitled")
        ptype = str(node.get("Type") or "1")
        attr = 0 if ptype == "0" else 1
        conn.execute(
            "INSERT OR REPLACE INTO djmdPlaylist (ID, Name, Attribute, ParentID) VALUES (?, ?, ?, ?)",
            (pid, name, attr, parent_id),
        )
        playlist_count[0] += 1

        entries = node.get("Entries") or []
        if isinstance(entries, list) and attr == 1:
            for idx, tid in enumerate(entries, start=1):
                conn.execute(
                    "INSERT INTO djmdSongPlaylist (PlaylistID, ContentID, TrackNo) VALUES (?, ?, ?)",
                    (pid, str(tid), idx),
                )
                link_count[0] += 1

        children = node.get("Children") or []
        if isinstance(children, list):
            for child in children:
                upsert_node(child, pid)

    for root in playlists:
        upsert_node(root, "")

    conn.commit()
    conn.close()
    emit({
        "ok": True,
        "playlists": playlist_count[0],
        "links": link_count[0],
        "mode": mode,
        "dbPath": db_path
    })
except Exception as e:
    emit({"ok": False, "error": str(e)})
`;

const PYTHON_DB_EXPORT_PYREKORDBOX_SCRIPT = `
import json
import sys
import os

# Ensure user site-packages are on the path regardless of how python3 was invoked
_home = os.environ.get('HOME') or os.path.expanduser('~')
if not _home:
    _home = os.path.join(os.sep, 'home')  # generic fallback
_extra = [
    _home + '/Library/Python/3.9/lib/python/site-packages',
    _home + '/Library/Python/3.9/lib/python/site-packages',  # will be deduped
    '/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/lib/python3.9/site-packages',
    '/Library/Python/3.9/site-packages',
]
for _p in reversed(_extra):
    if os.path.isdir(_p) and _p not in sys.path:
        sys.path.insert(0, _p)

def emit(payload):
    print(json.dumps(payload, default=str))

db_path = sys.argv[1] if len(sys.argv) > 1 else ""
mode = sys.argv[2] if len(sys.argv) > 2 else "merge"
if not db_path:
    emit({"ok": False, "error": "No DB path provided"})
    sys.exit(0)

try:
    payload = json.loads(sys.stdin.read() or "{}")
except Exception as e:
    emit({"ok": False, "error": f"Invalid stdin JSON: {e}"})
    sys.exit(0)

playlists = payload.get("playlists", [])
if not isinstance(playlists, list):
    emit({"ok": False, "error": "Payload playlists must be an array"})
    sys.exit(0)

try:
    from pyrekordbox.db6.database import Rekordbox6Database
except Exception as e:
    emit({"ok": False, "error": f"pyrekordbox import failed: {e}"})
    sys.exit(0)

try:
    db = Rekordbox6Database(path=db_path, unlock=True)
except Exception as e:
    emit({"ok": False, "error": f"Failed to open Rekordbox DB for write: {e}"})
    sys.exit(0)

try:
    root_name = "MCP Sync Export"
    playlist_count = [0]
    link_count = [0]
    missing_track_ids = []

    root_matches = db.get_playlist(Name=root_name)
    if hasattr(root_matches, "all"):
        root_matches = root_matches.all()
    else:
        root_matches = list(root_matches)

    if mode == "overwrite":
        for existing in root_matches:
            db.delete_playlist(existing)
        db.commit()
        root_matches = []

    if root_matches:
        root = root_matches[0]
    else:
        root = db.create_playlist_folder(root_name)
        db.commit()

    def get_content_by_id(track_id):
        try:
            value = int(str(track_id))
        except Exception:
            return None
        try:
            obj = db.get_content(ID=value)
            if hasattr(obj, "one"):
                return obj.one()
            return obj
        except Exception:
            return None

    def get_child_by_name(parent, name, is_folder):
        try:
            parent_id = str(getattr(parent, "ID", ""))
            q = db.get_playlist(Name=name, ParentID=parent_id)
            if hasattr(q, "all"):
                candidates = q.all()
            else:
                candidates = list(q)
            wanted_attr = 0 if is_folder else 1
            for candidate in candidates:
                if int(getattr(candidate, "Attribute", -1)) == wanted_attr:
                    return candidate
        except Exception:
            return None
        return None

    def create_node(node, parent):
        if not isinstance(node, dict):
            return
        name = str(node.get("Name") or "Untitled")
        ptype = str(node.get("Type") or "1")
        is_folder = ptype == "0"
        existing = get_child_by_name(parent, name, is_folder)

        if existing is not None:
            created = existing
        elif mode == "update":
            return
        elif is_folder:
            created = db.create_playlist_folder(name, parent=parent)
            playlist_count[0] += 1
        else:
            created = db.create_playlist(name, parent=parent)
            playlist_count[0] += 1

        if not is_folder:
            entries = node.get("Entries") or []
            if isinstance(entries, list):
                existing_content_ids = set()
                try:
                    songs = getattr(created, "Songs", []) or []
                    for song in songs:
                        content = getattr(song, "Content", None)
                        cid = getattr(content, "ID", None)
                        if cid is not None:
                            existing_content_ids.add(str(cid))
                except Exception:
                    existing_content_ids = set()
                for tid in entries:
                    content = get_content_by_id(tid)
                    if content is None:
                        missing_track_ids.append(str(tid))
                        continue
                    content_id = str(getattr(content, "ID", ""))
                    if content_id and content_id in existing_content_ids:
                        continue
                    db.add_to_playlist(created, content)
                    if content_id:
                        existing_content_ids.add(content_id)
                    link_count[0] += 1

        children = node.get("Children") or []
        if isinstance(children, list):
            child_parent = created if is_folder else parent
            for child in children:
                create_node(child, child_parent)

    for top in playlists:
        create_node(top, root)

    db.commit()
    emit({
        "ok": True,
        "playlists": playlist_count[0],
        "links": link_count[0],
        "missingTrackRefs": len(missing_track_ids),
        "root": root_name,
    })
except Exception as e:
    emit({"ok": False, "error": str(e)})
finally:
    try:
        db.close()
    except Exception:
        pass
`;

async function importDB(dbPath: string): Promise<{ success: boolean; message: string; backup?: string }> {
  const resolvedPath = resolve(dbPath);
  const backupPath = await ensureBackupBeforeWrite();

  const result = await new Promise<{ ok: boolean; data?: { tracks: Track[]; playlists: Playlist[] }; error?: string }>((resolvePromise) => {
    const child = spawn('python3', ['-c', PYTHON_DB_IMPORT_SCRIPT, resolvedPath]);
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('close', () => {
      try {
        const parsed = JSON.parse((stdout || '').trim() || '{}');
        resolvePromise(parsed);
      } catch {
        resolvePromise({ ok: false, error: stderr || `Failed to parse DB import output: ${stdout}` });
      }
    });
    child.on('error', (error) => {
      resolvePromise({ ok: false, error: error.message });
    });
  });

  if (!result.ok || !result.data) {
    return { success: false, message: result.error || 'DB import failed' };
  }

  const service = getLibraryService();
  service.loadFromData({
    tracks: result.data.tracks || [],
    playlists: result.data.playlists || [],
  });

  const stats = service.getStats();
  return {
    success: true,
    message: `Imported ${stats.totalTracks} tracks and ${stats.totalPlaylists} playlists from ${resolvedPath}`,
    backup: backupPath,
  };
}

async function exportDB(
  dbPath: string,
  mode: 'merge' | 'update' | 'overwrite' = 'merge'
): Promise<{ success: boolean; message: string; backup?: string }> {
  const resolvedPath = resolve(dbPath);
  const service = getLibraryService();
  const playlists = service.getAllPlaylists();

  if (!playlists.length) {
    return {
      success: false,
      message: 'No playlists loaded in memory. Import XML/DB first before exporting to DB.',
    };
  }

  let backupPath: string;
  try {
    backupPath = await ensureBackupBeforeWrite();
  } catch (error: any) {
    return {
      success: false,
      message: `Backup failed: ${error.message || String(error)}`,
    };
  }

  const result = await new Promise<{ ok: boolean; playlists?: number; links?: number; error?: string }>((resolvePromise) => {
    const usePyrekordboxWritePath = resolvedPath.endsWith('master.db');
    const script = usePyrekordboxWritePath ? PYTHON_DB_EXPORT_PYREKORDBOX_SCRIPT : PYTHON_DB_EXPORT_SCRIPT;
    const userHome = homedir();
    const child = spawn('python3', ['-c', script, resolvedPath, mode], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONPATH: [
          process.env.PYTHONPATH,
          `${userHome}/Library/Python/3.9/lib/python/site-packages`,
          '/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/lib/python3.9/site-packages',
        ].filter(Boolean).join(':'),
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.stdin.write(JSON.stringify({ playlists }));
    child.stdin.end();
    child.on('close', () => {
      try {
        const parsed = JSON.parse((stdout || '').trim() || '{}');
        resolvePromise(parsed);
      } catch {
        resolvePromise({ ok: false, error: stderr || `Failed to parse DB export output: ${stdout}` });
      }
    });
    child.on('error', (error) => {
      resolvePromise({ ok: false, error: error.message });
    });
  });

  if (!result.ok) {
    return { success: false, message: result.error || 'DB export failed' };
  }

  return {
    success: true,
    message: `Exported ${result.playlists || 0} playlists and ${result.links || 0} playlist-track links to ${resolvedPath}${resolvedPath.endsWith('master.db') ? ' (pyrekordbox write path)' : ''}`,
    backup: backupPath,
  };
}

/**
 * Import library from Rekordbox XML
 */
export async function importXML(xmlPath: string): Promise<{ success: boolean; message: string; backup?: string }> {
  try {
    const backupPath = await ensureBackupBeforeWrite();
    const service = getLibraryService();
    const resolvedPath = resolve(xmlPath);
    service.loadFromXML(resolvedPath);

    const stats = service.getStats();
    return {
      success: true,
      message: `Imported ${stats.totalTracks} tracks from ${resolvedPath}`,
      backup: backupPath,
    };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

/**
 * Export library to Rekordbox XML
 */
export async function exportXML(outputPath: string): Promise<{ success: boolean; message: string; backup?: string }> {
  try {
    const service = getLibraryService();
    const resolvedPath = resolve(outputPath);
    if (isProtectedPioneerPath(resolvedPath)) {
      return {
        success: false,
        message: `Export blocked: destination is under protected Pioneer path (${resolvedPath})`,
      };
    }
    const backupPath = await ensureBackupBeforeWrite();
    const xml = service.exportToXML();
    const dir = dirname(resolvedPath);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolvedPath, xml, 'utf8');

    return {
      success: true,
      message: `Exported to ${resolvedPath}`,
      backup: backupPath,
    };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

/**
 * Sync with Rekordbox (import or export)
 */
export async function sync(input: RekordboxSyncInput): Promise<{ success: boolean; message: string; backup?: string }> {
  const service = getLibraryService();

  try {
    if (input.action === 'import') {
      if (!input.source) {
        return { success: false, message: 'Source path required for import' };
      }

      // Check if it's a DB file or XML file
      if (input.source.endsWith('.db') || input.source.includes('master.db')) {
        return await importDB(input.source);
      } else {
        // XML import
        return await importXML(input.source);
      }
    } else if (input.action === 'export') {
      const outputPath = input.destination || 'rekordbox_export.xml';
      const protectedPath = isProtectedPioneerPath(outputPath);
      const allowProtectedMasterDb = input.allowProtectedWrite === true && isAllowedProtectedMasterDb(outputPath);
      if (protectedPath && !allowProtectedMasterDb) {
        return {
          success: false,
          message: `Export blocked: destination is under protected Pioneer path (${resolve(outputPath)}). To write only to the real master DB, set allowProtectedWrite=true and destination=/Users/<username>/Library/Pioneer/rekordbox/master.db`,
        };
      }

      // Check if it's a DB file or XML file
      if (outputPath.endsWith('.db') || outputPath.includes('master.db')) {
        return await exportDB(outputPath, input.mode || 'merge');
      } else {
        // XML export
        return await exportXML(outputPath);
      }
    } else {
      return { success: false, message: `Unknown action: ${input.action}` };
    }
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

/**
 * Get Rekordbox configuration
 */
export async function getConfig(): Promise<{ autoDetect: boolean; dbPath: string }> {
  const { getConfig } = await import('../config.js');
  const config = getConfig();

  return {
    autoDetect: config.rekordbox.auto_detect,
    dbPath: config.rekordbox.db_path,
  };
}
