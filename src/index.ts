/**
 * Rekordbox Smart MCP Server
 *
 * An MCP server for DJs using Pioneer Rekordbox.
 * Provides essential tools for library management, search, playlists, and DJ analytics.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Import tools
import * as libraryTools from './tools/library.js';
import * as trackTools from './tools/track.js';
import * as audioTools from './tools/audio.js';
import * as rekordboxTools from './tools/rekordbox.js';
import * as djTools from './tools/dj.js';
import * as playlistTools from './tools/playlist.js';
import { logMutation } from './tools/audit.js';
import * as mutationTools from './tools/mutations.js';
import * as setlistTools from './tools/setlist.js';

// Load config
import { loadConfig } from './config.js';

// Initialize config
loadConfig(process.env.BONK_CONFIG_PATH);

console.error('[rekordbox-smart-mcp] Starting server...');

// Define all MCP tools (core set only)
const tools: Tool[] = [
  // ============ LIBRARY TOOLS ============
  {
    name: 'library_search',
    description: 'Search the music library with optional filters for genre, BPM, key, artist, album, year, rating, comments, hasComments, hasGenre. Returns matching tracks.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Full-text search query' },
        filters: {
          type: 'object',
          properties: {
            genre: { type: 'string' },
            artist: { type: 'string' },
            album: { type: 'string' },
            bpm: { type: 'object', properties: { min: { type: 'number' }, max: { type: 'number' } } },
            key: { type: 'string' },
            year: { type: 'object', properties: { min: { type: 'number' }, max: { type: 'number' } } },
            rating: { type: 'object', properties: { min: { type: 'number' }, max: { type: 'number' } } },
            missing: { type: 'boolean' },
            hasComments: { type: 'boolean' },
            hasGenre: { type: 'boolean' },
          },
        },
        sort: {
          type: 'object',
          properties: {
            column: { type: 'string', enum: ['title', 'artist', 'album', 'bpm', 'key', 'rating', 'dateAdded', 'genre'] },
            direction: { type: 'string', enum: ['asc', 'desc'] },
          },
        },
        limit: { type: 'number', default: 100 },
        offset: { type: 'number', default: 0 },
      },
    },
  },
  {
    name: 'library_stats',
    description: 'Get statistics about the loaded library: track count, genre distribution, BPM range, key distribution.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'library_listPlaylists',
    description: 'List all playlists in the library with their track counts.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'library_load',
    description: 'Load a Rekordbox XML file into the library. If xmlPath is omitted, uses the default path set via library_setDefaultPath. Creates a backup before loading.',
    inputSchema: {
      type: 'object',
      properties: { xmlPath: { type: 'string' } },
      required: [],
    },
  },
  {
    name: 'library_findMissing',
    description: 'Find tracks whose file paths are missing on disk.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'library_findDuplicates',
    description: 'Find potential duplicate tracks by file location and by artist+title.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'library_fuzzySearch',
    description: 'Fuzzy-search tracks by title/artist/album/genre.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', default: 50 },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_keyCompatible',
    description: 'Find tracks compatible with a source key using Camelot harmonic mixing rules.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Musical key or Camelot code (e.g. "Am", "8A").' },
        limit: { type: 'number', default: 50 },
        offset: { type: 'number', default: 0 },
      },
      required: ['key'],
    },
  },
  {
    name: 'library_exportJSON',
    description: 'Export loaded library tracks and playlists to JSON.',
    inputSchema: {
      type: 'object',
      properties: { outputPath: { type: 'string' } },
    },
  },

  // ============ TRACK TOOLS ============
  {
    name: 'track_get',
    description: 'Get detailed information about a specific track by its ID.',
    inputSchema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
        include: {
          type: 'object',
          properties: {
            metadata: { type: 'boolean', default: true },
          },
        },
      },
      required: ['trackId'],
    },
  },
  {
    name: 'track_update',
    description: 'Update metadata for a single track. Creates automatic backup.',
    inputSchema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
        updates: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            artist: { type: 'string' },
            album: { type: 'string' },
            genre: { type: 'string' },
            year: { type: 'string' },
            bpm: { type: 'string' },
            key: { type: 'string' },
            rating: { type: 'number' },
            comments: { type: 'string' },
            remixer: { type: 'string' },
            label: { type: 'string' },
          },
        },
      },
      required: ['trackId', 'updates'],
    },
  },
  {
    name: 'track_playlists',
    description: 'Get all playlists that contain a specific track.',
    inputSchema: {
      type: 'object',
      properties: { trackId: { type: 'string' } },
      required: ['trackId'],
    },
  },
  {
    name: 'track_updateBatch',
    description: 'Update metadata for multiple tracks in one request. Creates automatic backup.',
    inputSchema: {
      type: 'object',
      properties: {
        updates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              trackId: { type: 'string' },
              updates: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  artist: { type: 'string' },
                  album: { type: 'string' },
                  genre: { type: 'string' },
                  year: { type: 'string' },
                  bpm: { type: 'string' },
                  key: { type: 'string' },
                  rating: { type: 'number' },
                  comments: { type: 'string' },
                  remixer: { type: 'string' },
                  label: { type: 'string' },
                },
              },
            },
            required: ['trackId', 'updates'],
          },
        },
      },
      required: ['updates'],
    },
  },

  // ============ AUDIO TOOLS (BPM cache only) ============
  {
    name: 'audio_bpmGetCached',
    description: 'Get cached BPM analysis for an audio file.',
    inputSchema: {
      type: 'object',
      properties: { filePath: { type: 'string' } },
      required: ['filePath'],
    },
  },
  {
    name: 'audio_bpmCacheSet',
    description: 'Store BPM analysis in cache for an audio file.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string' },
        bpm: { type: 'number' },
        source: { type: 'string' },
        confidence: { type: 'number' },
        analyzerVersion: { type: 'string' },
      },
      required: ['filePath', 'bpm', 'source'],
    },
  },

  // ============ REKORDBOX TOOLS ============
  {
    name: 'rekordbox_sync',
    description: 'Import from or export to Rekordbox. Action: "import" (from XML or DB) or "export" (to XML). Creates backup for import operations.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['import', 'export'] },
        source: { type: 'string' },
        destination: { type: 'string' },
      },
      required: ['action'],
    },
  },
  {
    name: 'rekordbox_importXml',
    description: 'Import library from Rekordbox XML file. Creates backup before loading.',
    inputSchema: {
      type: 'object',
      properties: { xmlPath: { type: 'string' } },
      required: ['xmlPath'],
    },
  },
  {
    name: 'rekordbox_exportXml',
    description: 'Export library to Rekordbox XML file. Creates automatic backup.',
    inputSchema: {
      type: 'object',
      properties: { outputPath: { type: 'string' } },
      required: ['outputPath'],
    },
  },

  // ============ DJ ANALYTICS TOOLS ============
  {
    name: 'dj_getRecentSessions',
    description: 'Get recent DJ sessions from Rekordbox history. Requires rekordbox.db_path configured.',
    inputSchema: {
      type: 'object',
      properties: { days: { type: 'number', default: 30 } },
    },
  },
  {
    name: 'dj_getSessionTracks',
    description: 'Get tracks played in a specific DJ session.',
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string' } },
      required: ['sessionId'],
    },
  },
  {
    name: 'dj_getHistoryStats',
    description: 'Get DJ performance statistics. Requires rekordbox.db_path configured.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'dj_getPlayCountAnalytics',
    description: 'Get play count analytics for tracks from Rekordbox history.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'dj_getListeningPatterns',
    description: 'Get listening pattern analysis: average BPM, dominant genres, dominant keys.',
    inputSchema: { type: 'object', properties: {} },
  },

  // ============ PLAYLIST TOOLS ============
  {
    name: 'playlist_create',
    description: 'Create a new playlist. Creates automatic backup.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        parentName: { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'playlist_addTracks',
    description: 'Add tracks to a playlist. Creates automatic backup.',
    inputSchema: {
      type: 'object',
      properties: {
        playlistName: { type: 'string' },
        trackIds: { type: 'array', items: { type: 'string' } },
        mode: { type: 'string', enum: ['add', 'replace'], default: 'add' },
      },
      required: ['playlistName', 'trackIds'],
    },
  },
  {
    name: 'playlist_removeTracks',
    description: 'Remove tracks from a playlist. Creates automatic backup.',
    inputSchema: {
      type: 'object',
      properties: {
        playlistName: { type: 'string' },
        trackIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['playlistName', 'trackIds'],
    },
  },
  {
    name: 'playlist_delete',
    description: 'Delete a playlist. DESTRUCTIVE - Creates automatic backup. Set force=true to confirm.',
    inputSchema: {
      type: 'object',
      properties: {
        playlistName: { type: 'string' },
        force: { type: 'boolean', default: false },
      },
      required: ['playlistName'],
    },
  },
  {
    name: 'playlist_rename',
    description: 'Rename a playlist. Creates automatic backup.',
    inputSchema: {
      type: 'object',
      properties: {
        oldName: { type: 'string' },
        newName: { type: 'string' },
      },
      required: ['oldName', 'newName'],
    },
  },

  // ============ SETLIST TOOLS ============
  {
    name: 'playlist_buildSmart',
    description: 'Create a playlist using smart composition rules (energy curve, key progression, BPM range, artist diversity). Creates backup.',
    inputSchema: {
      type: 'object',
      properties: {
        playlistName: { type: 'string' },
        rules: {
          type: 'object',
          properties: {
            energy_curve: { type: 'string', enum: ['wave', 'ramp-up', 'ramp-down', 'flat'], default: 'wave' },
            min_duration_minutes: { type: 'number' },
            max_tracks: { type: 'number', default: 50 },
            bpm_range: {
              type: 'object',
              properties: {
                min: { type: 'number' },
                max: { type: 'number' },
              },
            },
            key_progression: { type: 'string', enum: ['smooth', 'mixed', 'random'], default: 'smooth' },
            include_tracks: { type: 'array', items: { type: 'string' } },
            exclude_tracks: { type: 'array', items: { type: 'string' } },
            preferred_genres: { type: 'array', items: { type: 'string' } },
            avoid_artist_repeat: { type: 'boolean', default: false },
          },
        },
      },
      required: ['playlistName', 'rules'],
    },
  },
  {
    name: 'setlist_analyze',
    description: 'Analyze a playlist or list of tracks for energy, harmonic compatibility, gaps, and diversity.',
    inputSchema: {
      type: 'object',
      properties: {
        playlist_name: { type: 'string' },
        track_ids: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'setlist_suggestTransitions',
    description: 'For each track in a playlist, suggest 2-3 possible next tracks with transition tips and compatibility scores.',
    inputSchema: {
      type: 'object',
      properties: {
        playlist_name: { type: 'string' },
        track_ids: { type: 'array', items: { type: 'string' } },
        limit_per_track: { type: 'number', default: 3 },
      },
    },
  },

  // ============ SAFETY/UTILITIES ============
  {
    name: 'mutation_history',
    description: 'List recent mutations from the audit log. Optional filters: limit (default 50), tool, since (ISO timestamp).',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', default: 50 },
        tool: { type: 'string' },
        since: { type: 'string' },
      },
    },
  },
  {
    name: 'mutation_rollback',
    description: 'Rollback a mutation by its timestamp ID. Creates a pre-rollback backup. Set dryRun=true to preview without applying.',
    inputSchema: {
      type: 'object',
      properties: {
        mutationId: { type: 'string', description: 'Timestamp of the mutation to rollback' },
        dryRun: { type: 'boolean', default: false },
      },
      required: ['mutationId'],
    },
  },
];

// Set of tools that create backups (mutations)
const mutationBaseTools = new Set<string>([
  // Track
  'track_update',
  'track_updateBatch',
  // Playlist
  'playlist_create',
  'playlist_addTracks',
  'playlist_removeTracks',
  'playlist_delete',
  'playlist_rename',
  'playlist_buildSmart',
  // Rekordbox
  'rekordbox_sync',
  'rekordbox_importXml',
  'rekordbox_exportXml',
  // Library (load operations)
  'library_load',
  // Safety/Utilities
  'mutation_rollback',
]);

// Create MCP server
class RekordboxSmartMCPServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'rekordbox-smart-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers() {
    // List tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools };
    });

    // List resources (none for now)
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return { resources: [] };
    });

    // Read resource content
    this.server.setRequestHandler(ReadResourceRequestSchema, async () => {
      throw new Error('No resources available');
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const isMutation = mutationBaseTools.has(name);
      const isSearchTool = name.startsWith('search_') || name.startsWith('library_') || name.startsWith('track_') || name.startsWith('playlist_') || name.startsWith('dj_');

      try {
        let result: any;

        switch (name) {
          // Library
          case 'library_search':
            result = await libraryTools.searchLibrary(args as any);
            break;
          case 'library_stats':
            result = await libraryTools.getLibraryStats();
            break;
          case 'library_listPlaylists':
            result = await libraryTools.listPlaylists();
            break;
          case 'library_load':
            result = await libraryTools.loadLibrary((args as any).xmlPath);
            break;
          case 'library_findMissing':
            result = await libraryTools.findMissingFiles();
            break;
          case 'library_findDuplicates':
            result = await libraryTools.findDuplicates();
            break;
          case 'library_fuzzySearch':
            result = await libraryTools.fuzzySearchLibrary(args as any);
            break;
          case 'search_keyCompatible':
            result = await libraryTools.searchKeyCompatible(args as any);
            break;
          case 'library_exportJSON':
            result = await libraryTools.exportLibraryJson((args as any).outputPath);
            break;

          // Track
          case 'track_get':
            result = await trackTools.getTrack(args as any);
            break;
          case 'track_update':
            result = await trackTools.updateTrack(args as any);
            break;
          case 'track_playlists':
            result = await trackTools.getTrackPlaylists((args as any).trackId);
            break;
          case 'track_updateBatch':
            result = await trackTools.batchUpdateTracks((args as any).updates);
            break;

          // Audio (BPM cache only)
          case 'audio_bpmGetCached':
            result = await audioTools.getCachedBpm((args as any).filePath);
            break;
          case 'audio_bpmCacheSet':
            result = await audioTools.setCachedBpm(
              (args as any).filePath,
              (args as any).bpm,
              (args as any).source,
              (args as any).confidence,
              (args as any).analyzerVersion,
            );
            break;

          // Rekordbox
          case 'rekordbox_sync':
            result = await rekordboxTools.sync(args as any);
            break;
          case 'rekordbox_importXml':
            result = await rekordboxTools.importXML((args as any).xmlPath);
            break;
          case 'rekordbox_exportXml':
            result = await rekordboxTools.exportXML((args as any).outputPath);
            break;

          // DJ Analytics
          case 'dj_getRecentSessions':
            result = await djTools.getRecentSessions((args as any).days);
            break;
          case 'dj_getSessionTracks':
            result = await djTools.getSessionTracks((args as any).sessionId);
            break;
          case 'dj_getHistoryStats':
            result = await djTools.getHistoryStats();
            break;
          case 'dj_getPlayCountAnalytics':
            result = await djTools.getPlayCountAnalytics();
            break;
          case 'dj_getListeningPatterns':
            result = await djTools.getListeningPatterns();
            break;

          // Playlist
          case 'playlist_create':
            result = await playlistTools.createPlaylist((args as any).name, (args as any).parentName);
            break;
          case 'playlist_addTracks':
            result = await playlistTools.addTracksToPlaylist((args as any).playlistName, (args as any).trackIds, (args as any).mode);
            break;
          case 'playlist_removeTracks':
            result = await playlistTools.removeTracksFromPlaylist((args as any).playlistName, (args as any).trackIds);
            break;
          case 'playlist_delete':
            result = await playlistTools.deletePlaylist((args as any).playlistName, (args as any).force);
            break;
          case 'playlist_rename':
            result = await playlistTools.renamePlaylist((args as any).oldName, (args as any).newName);
            break;

          // Setlist tools
          case 'playlist_buildSmart':
            result = await setlistTools.buildSmartPlaylist(args as any);
            break;
          case 'setlist_analyze':
            result = await setlistTools.analyzeSetlist(args as any);
            break;
          case 'setlist_suggestTransitions':
            result = await setlistTools.suggestTransitions(args as any);
            break;

          // Safety/Utilities
          case 'mutation_history':
            result = await mutationTools.mutationHistory(args as any);
            break;
          case 'mutation_rollback':
            result = await mutationTools.mutationRollback(args as any);
            break;

          default:
            return {
              content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
              isError: true,
            };
        }

        if (isMutation) {
          // Extract backup path from result if present
          const backupPath = result && typeof result === 'object' && 'backup' in result
            ? (result as any).backup
            : undefined;
          logMutation({
            tool: name,
            canonicalTool: name,
            args,
            result,
            backupPath,
          });
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error: any) {
        if (isMutation) {
          logMutation({
            tool: name,
            canonicalTool: name,
            args,
            error: error.message,
          });
        }
        console.error(`[rekordbox-smart-mcp] Tool error: ${error.message}`);
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: error.message }) }],
          isError: true,
        };
      }
    });
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error(`[rekordbox-smart-mcp] Server started with ${tools.length} tools`);
  }
}

// Start server
const server = new RekordboxSmartMCPServer();
server.start().catch((error) => {
  console.error('[rekordbox-smart-mcp] Failed to start:', error);
  process.exit(1);
});
