/**
 * Configuration loader for rekordbox-smart-mcp
 * Reads rekordbox-smart-mcp.toml configuration file
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { homedir, platform } from 'os';
import toml from 'toml';
import type { B0nkConfig } from './types.js';

const CONFIG_FILENAME = 'rekordbox-smart-mcp.toml';

let loadedConfigPath: string | null = null;

function resolvePath(path: string): string {
  if (path.startsWith('~/')) {
    return resolve(homedir(), path.slice(2));
  }
  return resolve(path);
}

/** Rekordbox 6 default `master.db` location when not set in config (Pioneer docs / pyrekordbox). */
export function defaultRekordboxMasterDbPath(): string {
  const home = homedir();
  if (platform() === 'darwin') {
    return resolve(home, 'Library/Pioneer/rekordbox/master.db');
  }
  if (platform() === 'win32') {
    const appData = process.env.APPDATA || resolve(home, 'AppData', 'Roaming');
    return resolve(appData, 'Pioneer', 'rekordbox', 'master.db');
  }
  return resolve(home, '.local/share/Pioneer/rekordbox/master.db');
}

function expandEnvVars(config: any): any {
  if (typeof config === 'string') {
    return config.replace(/\$(\w+)/g, (_, varName) => process.env[varName] || '');
  }
  if (Array.isArray(config)) {
    return config.map(expandEnvVars);
  }
  if (config && typeof config === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(config)) {
      result[key] = expandEnvVars(value);
    }
    return result;
  }
  return config;
}

export function loadConfig(configPath?: string): B0nkConfig {
  const paths = configPath
    ? [resolve(configPath)]
    : [
        resolve(process.cwd(), CONFIG_FILENAME),
        resolve(homedir(), '.config', CONFIG_FILENAME),
        resolve(homedir(), CONFIG_FILENAME),
      ];

  let configData: any = {};

  for (const path of paths) {
    if (existsSync(path)) {
      console.error(`[config] Loading from ${path}`);
      const content = readFileSync(path, 'utf-8');
      configData = toml.parse(content);
      loadedConfigPath = path;
      break;
    }
  }

  if (Object.keys(configData).length === 0) {
    console.error('[config] No config file found, using defaults');
  }

  const config = expandEnvVars(configData) as B0nkConfig;

  const rekordboxDbRaw = config.rekordbox?.db_path?.trim() ?? '';
  const rekordboxDbPath = rekordboxDbRaw
    ? resolvePath(rekordboxDbRaw)
    : defaultRekordboxMasterDbPath();

  // Apply defaults
  return {
    library: {
      xml_path: config.library?.xml_path || '',
      default_xml_path: config.library?.default_xml_path || '',
      folder_paths: config.library?.folder_paths || [],
    },
    rekordbox: {
      auto_detect: config.rekordbox?.auto_detect ?? true,
      db_path: rekordboxDbPath,
    },
    cache: {
      enabled: config.cache?.enabled ?? true,
      db_path: resolvePath(config.cache?.db_path || '~/.bonk/media-cache.db'),
    },
    audio: {
      ffmpeg_path: config.audio?.ffmpeg_path || '/usr/local/bin/ffmpeg',
      ffprobe_path: config.audio?.ffprobe_path || '/usr/local/bin/ffprobe',
      keyfinder_path: config.audio?.keyfinder_path || './bin/keyfinder-cli',
    },
    api_keys: config.api_keys || {},
    limits: {
      max_search_results: config.limits?.max_search_results || 1000,
      max_batch_size: config.limits?.max_batch_size || 100,
      query_timeout_ms: config.limits?.query_timeout_ms || 30000,
    },
  };
}

// Global config instance
let globalConfig: B0nkConfig | null = null;

export function getConfig(): B0nkConfig {
  if (!globalConfig) {
    globalConfig = loadConfig();
  }
  return globalConfig;
}

export function setConfig(config: B0nkConfig): void {
  globalConfig = config;
}

/**
 * Set the default XML library path and persist to config file.
 * This will be used when library_load is called without an explicit xmlPath.
 */
export function setDefaultXmlPath(xmlPath: string): { success: boolean; message: string; configPath: string } {
  const resolvedPath = resolvePath(xmlPath);
  const targetPath = loadedConfigPath || resolve(process.cwd(), CONFIG_FILENAME);

  // Read existing config or create new
  let configData: any = {};
  if (existsSync(targetPath)) {
    try {
      configData = toml.parse(readFileSync(targetPath, 'utf-8'));
    } catch {
      configData = {};
    }
  }

  // Update
  configData.library = configData.library || {};
  configData.library.default_xml_path = resolvedPath;

  // Write back
  try {
    // @ts-ignore: toml.stringify exists at runtime even if not in types
    writeFileSync(targetPath, toml.stringify(configData, { newlines: true }), 'utf-8');
    // Update in-memory config
    if (!globalConfig) {
      globalConfig = loadConfig(targetPath);
    } else {
      globalConfig.library.default_xml_path = resolvedPath;
    }
    return { success: true, message: `Default XML path set to ${resolvedPath}`, configPath: targetPath };
  } catch (err: any) {
    return { success: false, message: `Failed to write config: ${err.message}`, configPath: targetPath };
  }
}

/**
 * Get the path of the config file that was loaded, if any.
 */
export function getLoadedConfigPath(): string | null {
  return loadedConfigPath;
}
