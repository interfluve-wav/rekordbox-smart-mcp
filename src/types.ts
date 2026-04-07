/**
 * TypeScript types for B0nk MCP Server
 */

// Track metadata structure (matches B0nk's internal Track type)
export interface Track {
  TrackID: string;
  Name: string;
  Artist: string;
  Album?: string;
  Genre?: string;
  Kind?: string;
  Size?: string;
  TotalTime?: string;
  Year?: string;
  AverageBpm?: string;
  DateAdded?: string;
  BitRate?: string;
  SampleRate?: string;
  Comments?: string;
  PlayCount?: string;
  Rating?: string;
  Location?: string;
  Remixer?: string;
  Tonality?: string;
  Key?: string;
  Label?: string;
  Mix?: string;
  Grouping?: string;
  CuePoints?: CuePoint[];
  tags?: Tag[];
  ratingByte?: number;
  isMissing?: boolean;
}

export interface CuePoint {
  Name: string;
  Type: string;
  Start: string;
  Num: string;
  Red?: number;
  Green?: number;
  Blue?: number;
}

export interface Tag {
  category: string;
  name: string;
  source?: string;
}

export interface Playlist {
  Name: string;
  Type: string; // '0' = folder, '1' = playlist, '2' = smart playlist
  KeyType: string;
  Entries: string[];
  Children: Playlist[];
  conditions?: any[];
  logicalOperator?: number;
}

export interface RekordboxLibrary {
  tracks: Track[];
  playlists: Playlist[];
}

// Search filters
export interface SearchFilters {
  query?: string;
  genre?: string | string[];
  artist?: string;
  album?: string;
  bpm?: { min?: number; max?: number };
  key?: string;
  year?: { min?: number; max?: number };
  rating?: { min?: number; max?: number };
  playlist?: string;
  missing?: boolean;
  hasArt?: boolean;
  /** When true, only tracks whose Comments field is non-empty (after trim). */
  hasComments?: boolean;
  /** When true, only tracks whose Genre field is non-empty (after trim). */
  hasGenre?: boolean;
}

export interface SearchOptions {
  filters?: SearchFilters;
  sort?: {
    column: 'title' | 'artist' | 'album' | 'bpm' | 'key' | 'rating' | 'dateAdded' | 'genre';
    direction?: 'asc' | 'desc';
  };
  limit?: number;
  offset?: number;
}

// Audio metadata
export interface AudioMetadata {
  // Basic info
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  genre?: string;
  year?: string;
  trackNumber?: string;
  discNumber?: string;
  
  // Technical
  format?: string;
  codec?: string;
  bitrate?: number;
  sampleRate?: number;
  duration?: number;
  
  // DJ-specific
  bpm?: string;
  key?: string;
  rating?: number; // 0-255 POPM byte
  
  // Additional
  composer?: string;
  lyricist?: string;
  remixer?: string;
  label?: string;
  comments?: string;
  mood?: string;
  
  // Artwork
  albumArt?: string; // Base64 encoded
}

// MCP Tool input/output types
export interface SearchInput {
  query?: string;
  filters?: SearchFilters;
  sort?: { column: string; direction?: 'asc' | 'desc' };
  limit?: number;
  offset?: number;
}

export interface SearchOutput {
  tracks: Track[];
  total: number;
  offset: number;
}

export interface TrackGetInput {
  trackId: string;
  include?: {
    metadata?: boolean;
    albumArt?: boolean;
    waveform?: boolean;
    cues?: boolean;
    tags?: boolean;
  };
}

export interface TrackUpdateInput {
  trackId: string;
  updates: Partial<{
    title: string;
    artist: string;
    album: string;
    genre: string;
    year: string;
    bpm: string;
    key: string;
    rating: number;
    comments: string;
    remixer: string;
    label: string;
  }>;
}

export interface AudioMetadataInput {
  filePath: string;
  include?: {
    basic?: boolean;
    technical?: boolean;
    albumArt?: boolean;
  };
}

export interface AudioWriteTagsInput {
  filePath: string;
  metadata: Partial<AudioMetadata>;
}

export interface RekordboxSyncInput {
  action: 'import' | 'export';
  source?: string; // For import: XML path or DB path
  destination?: string; // For export: XML path or DB path
  mode?: 'merge' | 'update' | 'overwrite';
  allowProtectedWrite?: boolean;
}

// Configuration
export interface B0nkConfig {
  library: {
    xml_path: string;
    default_xml_path?: string;
    folder_paths: string[];
  };
  rekordbox: {
    auto_detect: boolean;
    db_path: string;
  };
  cache: {
    enabled: boolean;
    db_path: string;
  };
  audio: {
    ffmpeg_path: string;
    ffprobe_path: string;
    keyfinder_path: string;
  };
  api_keys: Record<string, string>;
  limits: {
    max_search_results: number;
    max_batch_size: number;
    query_timeout_ms: number;
  };
}
