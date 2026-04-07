/**
 * Audio Service - Handles audio file metadata reading and tag writing
 */

import { parseFile } from 'music-metadata';
import { existsSync, statSync, readFileSync, renameSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import { spawn } from 'child_process';
import { promisify } from 'util';
import type { AudioMetadata } from '../types.js';
import { getConfig } from '../config.js';
import { getBpmCache, getScanCache, setBpmCache, setScanCache, type BpmCacheEntry } from './bpmCache.js';

const execFile = promisify(spawn);

export class AudioService {
  private normalizeToCamelot(rawKey: string | undefined | null): string | null {
    if (!rawKey) return null;
    const input = rawKey.trim();
    if (!input) return null;

    const normalized = input
      .replace(/♭/g, 'b')
      .replace(/♯/g, '#')
      .replace(/\s+/g, ' ')
      .trim();

    // Open Key (e.g. 1m, 12d) -> Camelot
    const openKeyMatch = normalized.match(/^([1-9]|1[0-2])\s*([dmDM])$/);
    if (openKeyMatch) {
      const openNum = Number(openKeyMatch[1]);
      const camelotNum = ((openNum + 6) % 12) + 1;
      const mode = openKeyMatch[2].toLowerCase() === 'm' ? 'A' : 'B';
      return `${camelotNum}${mode}`;
    }

    // Already Camelot (e.g. 8A, 6B)
    const camelotMatch = normalized.match(/^([1-9]|1[0-2])\s*([abAB])$/);
    if (camelotMatch) {
      return `${camelotMatch[1]}${camelotMatch[2].toUpperCase()}`;
    }

    let key = normalized.toLowerCase();
    key = key.replace(/\bmajor\b/, '').replace(/\bminor\b/, 'm').replace(/\bmin\b/, 'm');
    key = key.replace(/\s+/g, '');
    if (!key) return null;

    const isMinor = key.endsWith('m');
    const tonicRaw = isMinor ? key.slice(0, -1) : key;
    if (!tonicRaw) return null;

    const tonic = tonicRaw
      .replace(/^db$/, 'c#')
      .replace(/^eb$/, 'd#')
      .replace(/^gb$/, 'f#')
      .replace(/^ab$/, 'g#')
      .replace(/^bb$/, 'a#');

    const majorToCamelot: Record<string, string> = {
      c: '8B',
      g: '9B',
      d: '10B',
      a: '11B',
      e: '12B',
      b: '1B',
      'f#': '2B',
      'c#': '3B',
      'g#': '4B',
      'd#': '5B',
      'a#': '6B',
      f: '7B',
    };

    const minorToCamelot: Record<string, string> = {
      a: '8A',
      e: '9A',
      b: '10A',
      'f#': '11A',
      'c#': '12A',
      'g#': '1A',
      'd#': '2A',
      'a#': '3A',
      f: '4A',
      c: '5A',
      g: '6A',
      d: '7A',
    };

    return isMinor ? (minorToCamelot[tonic] || null) : (majorToCamelot[tonic] || null);
  }

  private resolveBinary(preferred: string, fallbacks: string[]): string {
    const candidates = [preferred, ...fallbacks, preferred.includes('/') ? '' : preferred]
      .filter(Boolean)
      .filter((value, index, arr) => arr.indexOf(value) === index);
    for (const candidate of candidates) {
      if (!candidate) continue;
      if (!candidate.includes('/')) return candidate;
      if (existsSync(candidate)) return candidate;
    }
    return preferred;
  }

  private resolveFfmpegCommand(): string {
    const config = getConfig();
    return this.resolveBinary(config.audio.ffmpeg_path, ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', 'ffmpeg']);
  }

  private resolveFfprobeCommand(): string {
    const config = getConfig();
    return this.resolveBinary(config.audio.ffprobe_path, ['/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe', 'ffprobe']);
  }

  private resolveKeyfinderCommand(): string {
    const config = getConfig();
    const configured = config.audio.keyfinder_path;
    const candidates = [
      configured,
      resolve(process.cwd(), 'bin', 'keyfinder-cli'),
      '/opt/homebrew/bin/keyfinder-cli',
      '/usr/local/bin/keyfinder-cli',
      'keyfinder-cli',
    ].filter((value, index, arr) => value && arr.indexOf(value) === index);

    for (const candidate of candidates) {
      if (candidate === 'keyfinder-cli') return candidate;
      if (existsSync(candidate)) return candidate;
    }
    return 'keyfinder-cli';
  }

  private async readKeyFromFfprobe(filePath: string): Promise<string | null> {
    const resolvedPath = resolve(filePath);
    return new Promise((resolveResult) => {
      const ffprobe = spawn(this.resolveFfprobeCommand(), [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        resolvedPath,
      ]);

      let output = '';
      ffprobe.stdout.on('data', (data) => {
        output += data.toString();
      });

      ffprobe.on('close', () => {
        try {
          const parsed = JSON.parse(output || '{}');
          const tags = parsed?.format?.tags || {};
          const keyCandidate = tags.tkey || tags.TKEY || tags.initialkey || tags.INITIALKEY || '';
          const normalized = this.normalizeToCamelot(keyCandidate);
          resolveResult(normalized || null);
        } catch {
          resolveResult(null);
        }
      });

      ffprobe.on('error', () => {
        resolveResult(null);
      });
    });
  }

  /**
   * Read metadata from an audio file
   */
  async getMetadata(filePath: string, options: { basic?: boolean; technical?: boolean; albumArt?: boolean } = {}): Promise<AudioMetadata> {
    const resolvedPath = resolve(filePath);

    if (!existsSync(resolvedPath)) {
      throw new Error(`File not found: ${resolvedPath}`);
    }

    const mm = await parseFile(resolvedPath);
    const metadata = mm.common;
    const format = mm.format;

    const result: AudioMetadata = {};

    // Basic info
    if (options.basic !== false) {
      result.title = metadata.title;
      result.artist = metadata.artist;
      result.album = metadata.album;
      result.albumArtist = metadata.albumartist;
      result.genre = metadata.genre?.join(', ');
      result.year = metadata.year?.toString();
      result.trackNumber = metadata.track?.no?.toString();
      result.discNumber = metadata.disk?.no?.toString();
      result.composer = metadata.composer?.[0];
      result.lyricist = metadata.lyricist?.[0];
      result.remixer = metadata.remixer?.[0];
      result.comments = metadata.comment?.[0];
      result.mood = metadata.mood;
      result.bpm = metadata.bpm?.toString();
      result.key = metadata.key;
    }

    // Technical info
    if (options.technical !== false) {
      result.format = resolvedPath.split('.').pop()?.toUpperCase();
      result.codec = format.codec;
      result.bitrate = format.bitrate;
      result.sampleRate = format.sampleRate;
      result.duration = format.duration;
    }

    // Album art
    if (options.albumArt !== false && metadata.picture && metadata.picture.length > 0) {
      const pic = metadata.picture[0];
      result.albumArt = `data:${pic.format};base64,${pic.data.toString('base64')}`;
    }

    return result;
  }

  /**
   * Extract album art as base64
   */
  async extractAlbumArt(filePath: string, size: 'thumbnail' | 'full' = 'thumbnail'): Promise<string | null> {
    const resolvedPath = resolve(filePath);

    if (!existsSync(resolvedPath)) {
      throw new Error(`File not found: ${resolvedPath}`);
    }

    const mm = await parseFile(resolvedPath);
    const metadata = mm.common;

    if (!metadata.picture || metadata.picture.length === 0) {
      return null;
    }

    const pic = metadata.picture[0];

    // If thumbnail and we have sharp, resize it
    // For now, just return full art
    return `data:${pic.format};base64,${pic.data.toString('base64')}`;
  }

  /**
   * Generate waveform peaks using FFmpeg — extracts real PCM amplitude data.
   * Falls back to dummy peaks on error so the MCP tool never crashes.
   */
  async getWaveform(filePath: string, buckets: number = 128): Promise<{ duration: number; peaks: number[] } | null> {
    const resolvedPath = resolve(filePath);

    if (!existsSync(resolvedPath)) {
      throw new Error(`File not found: ${resolvedPath}`);
    }

    let duration: number;
    try {
      duration = await this.getDuration(resolvedPath);
    } catch {
      return null;
    }

    if (duration <= 0 || !Number.isFinite(duration)) {
      console.error(`[audio] Waveform: invalid duration ${duration}`);
      return null;
    }

    // Try real extraction first; fall back to dummy on any error so callers never crash.
    try {
      const peaks = await this.extractWaveformPeaksFFmpeg(resolvedPath, buckets, duration);
      return { duration, peaks };
    } catch (err) {
      console.error(`[audio] Waveform extraction failed, using silent fallback: ${err}`);
      // Return silent (flat) waveform so the MCP tool still responds something sane.
      return { duration, peaks: new Array(buckets).fill(0.05) };
    }
  }

  /**
   * Extract amplitude peaks from an audio file using FFmpeg's PCM output.
   *
   * Strategy:
   *  1. Decode audio to mono 16-bit PCM via FFmpeg (fast — no re-encoding).
   *  2. Read raw Int16 samples in Node.js.
   *  3. Group samples into `buckets` time-slices across the track duration.
   *  4. For each bucket take the max |sample| and normalise to [0, 1].
   *
   * @param resolvedPath  Absolute path to the audio file (already resolved by caller).
   * @param buckets        Number of vertical bars in the waveform.
   * @param duration       Track duration in seconds (already fetched by caller).
   */
  private async extractWaveformPeaksFFmpeg(
    resolvedPath: string,
    buckets: number,
    duration: number
  ): Promise<number[]> {
    const ffmpegPath = this.resolveFfmpegCommand();

    // Each Int16 sample = 2 bytes.  We decode at native sample rate but PCM output
    // is interleaved stereo -> mono, so the total byte stream length is:
    //   bytes = sampleRate × duration × 2 (channels) × 2 (bytes per sample)
    // We don't know the sample rate yet, so we pipe and read until EOF.

    return new Promise((resolve, reject) => {
      const ffmpeg = spawn(ffmpegPath, [
        '-dl', '1',         // aggressive input seeking for large files
        '-i', resolvedPath,
        '-af', 'aformat=sample_fmts=s16:channel_layouts=mono',
        '-f', 's16le',      // raw interleaved signed 16-bit little-endian PCM
        '-'                 // write to stdout
      ]);

      const samples: number[] = [];

      ffmpeg.stdout.on('data', (chunk: Buffer) => {
        // Each 2 bytes is one Int16 sample.
        for (let offset = 0; offset < chunk.length; offset += 2) {
          const sample = chunk.readInt16LE(offset);
          samples.push(sample);
        }
      });

      ffmpeg.stderr.on('data', () => {
        // FFmpeg verbose stderr pollutes output but is otherwise harmless — ignore it.
      });

      ffmpeg.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`ffmpeg exited with code ${code}`));
          return;
        }

        if (samples.length === 0) {
          reject(new Error('ffmpeg produced no samples'));
          return;
        }

        // Determine approximate sample rate from total samples and duration.
        // (FFmpeg decodes at the file's native rate; we derive it from the output.)
        const sampleRate = Math.round(samples.length / duration);

        // Number of samples per bucket time-slice.
        const samplesPerBucket = Math.max(1, Math.floor(samples.length / buckets));

        const peaks: number[] = [];
        const maxInt16 = 32768; // Normalisation divisor (peak of signed 16-bit).

        for (let b = 0; b < buckets; b++) {
          const start = b * samplesPerBucket;
          const end   = Math.min(start + samplesPerBucket, samples.length);

          let maxAbs = 0;
          for (let i = start; i < end; i++) {
            const abs = Math.abs(samples[i]);
            if (abs > maxAbs) maxAbs = abs;
          }

          // Normalise 0-1, with a floor to keep near-silence visible.
          peaks.push(Math.max(0.02, maxAbs / maxInt16));
        }

        resolve(peaks);
      });

      ffmpeg.on('error', reject);
    });
  }

  /**
   * Get audio duration using ffprobe
   */
  private async getDuration(filePath: string): Promise<number> {
    const resolvedPath = resolve(filePath);
    const config = getConfig();

    return new Promise((resolve, reject) => {
      const ffprobe = spawn(this.resolveFfprobeCommand(), [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        resolvedPath,
      ]);

      let output = '';
      ffprobe.stdout.on('data', (data) => {
        output += data.toString();
      });

      ffprobe.on('close', (code) => {
        if (code === 0) {
          const duration = parseFloat(output.trim());
          resolve(Number.isFinite(duration) ? duration : 0);
        } else {
          reject(new Error(`ffprobe failed with code ${code}`));
        }
      });

      ffprobe.on('error', reject);
    });
  }

  /**
   * Detect musical key using KeyFinder CLI
   */
  async detectKey(filePath: string): Promise<{ key: string; confidence: number } | null> {
    const resolvedPath = resolve(filePath);

    if (!existsSync(resolvedPath)) {
      throw new Error(`File not found: ${resolvedPath}`);
    }

    const cached = getScanCache(resolvedPath);
    if (cached?.key) {
      return { key: cached.key, confidence: cached.confidence ?? 1.0 };
    }

    // 1) Metadata key first (normalized to Camelot)
    try {
      const mm = await parseFile(resolvedPath);
      const metadataKey = this.normalizeToCamelot(mm.common?.key);
      if (metadataKey) {
        setScanCache(resolvedPath, {
          key: metadataKey,
          source: 'metadata',
          confidence: 1.0,
          analyzerVersion: 'key-detect-v1',
        });
        return { key: metadataKey, confidence: 1.0 };
      }
    } catch (error: any) {
      console.error(`[audio] metadata key read failed, falling back to keyfinder: ${error?.message || error}`);
    }

    // 2) FFprobe tag fallback (TKEY/INITIALKEY), matching B0nk app behavior.
    const ffprobeKey = await this.readKeyFromFfprobe(resolvedPath);
    if (ffprobeKey) {
      setScanCache(resolvedPath, {
        key: ffprobeKey,
        source: 'ffprobe',
        confidence: 0.97,
        analyzerVersion: 'key-detect-v1',
      });
      return { key: ffprobeKey, confidence: 0.97 };
    }

    // 3) Fall back to keyfinder-cli (normalized to Camelot)
    const keyfinderPath = this.resolveKeyfinderCommand();

    return new Promise((resolve) => {
      const keyfinder = spawn(keyfinderPath, [resolvedPath]);

      let stdout = '';
      let stderr = '';

      keyfinder.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      keyfinder.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      keyfinder.on('close', (code) => {
        if (code === 0) {
          const raw = stdout.trim();
          const key = this.normalizeToCamelot(raw);
          if (key && raw.toLowerCase() !== 'silence') {
            setScanCache(resolvedPath, {
              key,
              source: 'keyfinder-cli',
              confidence: 0.9,
              analyzerVersion: 'key-detect-v1',
            });
            resolve({ key, confidence: 0.9 });
          } else {
            resolve(null);
          }
        } else {
          console.error(`[audio] KeyFinder failed: ${stderr}`);
          resolve(null);
        }
      });

      keyfinder.on('error', (err) => {
        console.error(`[audio] KeyFinder error: ${err}`);
        resolve(null);
      });
    });
  }

  async detectBpmAubio(filePath: string): Promise<{ bpm: number; confidence: number } | null> {
    const resolvedPath = resolve(filePath);
    if (!existsSync(resolvedPath)) {
      throw new Error(`File not found: ${resolvedPath}`);
    }

    const cachedScan = getScanCache(resolvedPath);
    if (cachedScan?.bpm && Number.isFinite(cachedScan.bpm) && cachedScan.bpm > 0) {
      return { bpm: Number(cachedScan.bpm.toFixed(1)), confidence: cachedScan.confidence ?? 0.99 };
    }

    // Prefer embedded BPM metadata when present; only run aubio as fallback.
    try {
      const mm = await parseFile(resolvedPath);
      const taggedBpm = Number(mm.common?.bpm);
      if (Number.isFinite(taggedBpm) && taggedBpm > 0) {
        const normalizedBpm = taggedBpm > 1000 ? taggedBpm / 100 : taggedBpm;
        setScanCache(resolvedPath, {
          bpm: Number(normalizedBpm.toFixed(1)),
          source: 'metadata',
          confidence: 0.99,
          analyzerVersion: 'bpm-detect-v1',
        });
        return { bpm: Number(normalizedBpm.toFixed(1)), confidence: 0.99 };
      }
    } catch (error: any) {
      // Ignore parse errors and continue to aubio fallback.
      console.error(`[audio] metadata BPM read failed, falling back to aubio: ${error?.message || error}`);
    }

    return new Promise((resolveResult) => {
      const aubio = spawn('aubio', ['tempo', resolvedPath]);
      let stdout = '';
      let stderr = '';

      aubio.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      aubio.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      aubio.on('close', (code) => {
        if (code !== 0) {
          console.error(`[audio] aubio failed: ${stderr}`);
          resolveResult(null);
          return;
        }
        const matches = stdout.match(/([0-9]+(?:\.[0-9]+)?)/g);
        if (!matches || matches.length === 0) {
          resolveResult(null);
          return;
        }
        const bpm = Number(matches[matches.length - 1]);
        if (!Number.isFinite(bpm) || bpm <= 0) {
          resolveResult(null);
          return;
        }
        setScanCache(resolvedPath, {
          bpm: Number(bpm.toFixed(1)),
          source: 'aubio',
          confidence: 0.95,
          analyzerVersion: 'bpm-detect-v1',
        });
        resolveResult({ bpm: Number(bpm.toFixed(1)), confidence: 0.95 });
      });

      aubio.on('error', (err) => {
        console.error(`[audio] aubio error: ${err.message}`);
        resolveResult(null);
      });
    });
  }

  getCachedBpm(filePath: string): BpmCacheEntry | null {
    const resolvedPath = resolve(filePath);
    if (!existsSync(resolvedPath)) {
      throw new Error(`File not found: ${resolvedPath}`);
    }
    return getBpmCache(resolvedPath);
  }

  setCachedBpm(
    filePath: string,
    bpm: number,
    source: string,
    confidence: number | null = null,
    analyzerVersion: string = 'manual-v1',
  ): void {
    const resolvedPath = resolve(filePath);
    if (!existsSync(resolvedPath)) {
      throw new Error(`File not found: ${resolvedPath}`);
    }
    if (!Number.isFinite(bpm) || bpm <= 0) {
      throw new Error('Invalid BPM value');
    }
    setBpmCache(resolvedPath, bpm, source || 'unknown', confidence, analyzerVersion);
  }

  /**
   * Convert audio format
   */
  async convert(
    inputPath: string,
    outputFormat: 'mp3' | 'flac' | 'aiff' | 'wav' | 'm4a' | 'ogg',
    outputPath?: string
  ): Promise<{ success: boolean; outputPath?: string; error?: string }> {
    const config = getConfig();
    const inputResolved = resolve(inputPath);

    if (!existsSync(inputResolved)) {
      return { success: false, error: `Input file not found: ${inputResolved}` };
    }

    const baseName = inputResolved.replace(/\.[^.]+$/, '');
    const outputResolved = outputPath || `${baseName}.${outputFormat}`;
    const outputFile = resolve(outputResolved);

    const ffmpegArgs = ['-y', '-i', inputResolved];

    // Add format-specific args
    switch (outputFormat) {
      case 'mp3':
        ffmpegArgs.push('-c:a', 'libmp3lame', '-b:a', '320k');
        break;
      case 'flac':
        ffmpegArgs.push('-c:a', 'flac', '-compression_level', '12');
        break;
      case 'aiff':
        ffmpegArgs.push('-c:a', 'pcm_s24be');
        break;
      case 'wav':
        ffmpegArgs.push('-c:a', 'pcm_s24le');
        break;
      case 'm4a':
        ffmpegArgs.push('-c:a', 'aac', '-b:a', '320k');
        break;
      case 'ogg':
        ffmpegArgs.push('-c:a', 'libvorbis', '-q:a', '6');
        break;
    }

    ffmpegArgs.push('-map_metadata', '0', outputFile);

    return new Promise((resolve) => {
      const ffmpeg = spawn(this.resolveFfmpegCommand(), ffmpegArgs);

      let stderr = '';
      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', (code) => {
        if (code === 0 && existsSync(outputFile)) {
          resolve({ success: true, outputPath: outputFile });
        } else {
          resolve({ success: false, error: `FFmpeg failed: ${stderr.slice(-500)}` });
        }
      });

      ffmpeg.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    });
  }

  async writeTags(filePath: string, metadata: Partial<AudioMetadata>): Promise<{ success: boolean; message: string }> {
    const resolvedPath = resolve(filePath);
    const config = getConfig();

    if (!existsSync(resolvedPath)) {
      return { success: false, message: `File not found: ${resolvedPath}` };
    }

    const dot = resolvedPath.lastIndexOf('.');
    const ext = dot > 0 ? resolvedPath.slice(dot).toLowerCase() : '';
    const tempPath = dot > 0
      ? `${resolvedPath.slice(0, dot)}.bonk-tag-tmp${resolvedPath.slice(dot)}`
      : `${resolvedPath}.bonk-tag-tmp`;
    const backupPath = `${resolvedPath}.bonk-prewrite.bak`;
    const args = ['-y', '-i', resolvedPath, '-map', '0', '-c:a', 'copy', '-c:v', 'copy', '-map_metadata', '0'];

    const map: Array<[string, string | undefined]> = [
      ['title', metadata.title],
      ['artist', metadata.artist],
      ['album', metadata.album],
      ['genre', metadata.genre],
      ['date', metadata.year],
      ['comment', metadata.comments],
      ['composer', metadata.composer],
      ['lyricist', metadata.lyricist],
      ['album_artist', metadata.albumArtist],
      ['track', metadata.trackNumber],
      ['disc', metadata.discNumber],
      ['bpm', metadata.bpm],
      ['initialkey', metadata.key],
    ];

    for (const [k, v] of map) {
      if (v !== undefined && String(v).trim() !== '') {
        args.push('-metadata', `${k}=${String(v)}`);
      }
    }

    if (ext === '.mp3' || ext === '.aiff' || ext === '.aif' || ext === '.wav' || ext === '.m4a' || ext === '.mp4' || ext === '.flac' || ext === '.ogg') {
      args.push('-write_id3v2', '1', '-id3v2_version', '3');
    }

    args.push(tempPath);

    const result = await new Promise<{ success: boolean; error?: string }>((resolvePromise) => {
      const ffmpeg = spawn(this.resolveFfmpegCommand(), args);
      let stderr = '';
      ffmpeg.stderr.on('data', (d) => {
        stderr += d.toString();
      });
      ffmpeg.on('close', (code) => {
        if (code === 0 && existsSync(tempPath)) resolvePromise({ success: true });
        else resolvePromise({ success: false, error: stderr.slice(-600) });
      });
      ffmpeg.on('error', (err) => resolvePromise({ success: false, error: err.message }));
    });

    if (!result.success) {
      if (existsSync(tempPath)) {
        try { unlinkSync(tempPath); } catch {}
      }
      return { success: false, message: `Tag write failed: ${result.error || 'unknown error'}` };
    }

    try {
      const inputSize = statSync(resolvedPath).size;
      const outputSize = statSync(tempPath).size;
      if (outputSize <= 0) {
        throw new Error('temporary output file is empty');
      }
      if (inputSize > 0 && outputSize < Math.floor(inputSize * 0.5)) {
        throw new Error('temporary output file is unexpectedly small');
      }
    } catch (error: any) {
      if (existsSync(tempPath)) {
        try { unlinkSync(tempPath); } catch {}
      }
      return { success: false, message: `Tag write verification failed: ${error.message || String(error)}` };
    }

    try {
      renameSync(resolvedPath, backupPath);
      renameSync(tempPath, resolvedPath);
      if (existsSync(backupPath)) {
        try { unlinkSync(backupPath); } catch {}
      }
      return { success: true, message: `Tags written: ${resolvedPath}` };
    } catch (error: any) {
      if (existsSync(tempPath)) {
        try { unlinkSync(tempPath); } catch {}
      }
      if (existsSync(backupPath) && !existsSync(resolvedPath)) {
        try { renameSync(backupPath, resolvedPath); } catch {}
      }
      return { success: false, message: `Tag write replace failed: ${error.message || String(error)}` };
    }
  }
}

// Singleton
let audioService: AudioService | null = null;

export function getAudioService(): AudioService {
  if (!audioService) {
    audioService = new AudioService();
  }
  return audioService;
}
