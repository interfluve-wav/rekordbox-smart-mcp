/**
 * Audio Tools - MCP tools for audio metadata and tag operations
 */

import { getAudioService } from '../services/audio.js';
import type { AudioMetadataInput, AudioWriteTagsInput } from '../types.js';

/**
 * Get metadata from an audio file
 * 
 * @example
 * await tools.audio_getMetadata({ 
 *   filePath: "/music/track.mp3",
 *   include: { basic: true, technical: true, albumArt: true }
 * })
 */
export async function getMetadata(input: AudioMetadataInput): Promise<{ success: boolean; metadata?: any; error?: string }> {
  try {
    const service = getAudioService();
    const metadata = await service.getMetadata(input.filePath, {
      basic: input.include?.basic,
      technical: input.include?.technical,
      albumArt: input.include?.albumArt,
    });

    return { success: true, metadata };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Extract album art from an audio file
 */
export async function extractAlbumArt(
  filePath: string,
  size: 'thumbnail' | 'full' = 'thumbnail'
): Promise<{ success: boolean; albumArt?: string; error?: string }> {
  try {
    const service = getAudioService();
    const albumArt = await service.extractAlbumArt(filePath, size);

    if (!albumArt) {
      return { success: false, error: 'No album art found' };
    }

    return { success: true, albumArt };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Get waveform peaks for an audio file
 */
export async function getWaveform(
  filePath: string,
  buckets: number = 128
): Promise<{ success: boolean; waveform?: { duration: number; peaks: number[] }; error?: string }> {
  try {
    const service = getAudioService();
    const waveform = await service.getWaveform(filePath, buckets);

    if (!waveform) {
      return { success: false, error: 'Failed to generate waveform' };
    }

    return { success: true, waveform };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Detect musical key of an audio file
 */
export async function detectKey(
  filePath: string
): Promise<{ success: boolean; key?: string; confidence?: number; error?: string }> {
  try {
    const service = getAudioService();
    const result = await service.detectKey(filePath);

    if (!result) {
      return { success: false, error: 'Key detection failed' };
    }

    return { success: true, key: result.key, confidence: result.confidence };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Get cached BPM analysis for a file.
 */
export async function getCachedBpm(
  filePath: string,
): Promise<{ success: boolean; cached?: any; error?: string }> {
  try {
    const service = getAudioService();
    const cached = service.getCachedBpm(filePath);
    return { success: true, cached };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Detect BPM with aubio CLI.
 */
export async function detectBpmAubio(
  filePath: string,
): Promise<{ success: boolean; bpm?: number; confidence?: number; error?: string }> {
  try {
    const service = getAudioService();
    const result = await service.detectBpmAubio(filePath);
    if (!result) {
      return { success: false, error: 'Aubio BPM detection failed' };
    }
    return { success: true, bpm: result.bpm, confidence: result.confidence };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Write BPM value to cache.
 */
export async function setCachedBpm(
  filePath: string,
  bpm: number,
  source: string,
  confidence?: number | null,
  analyzerVersion?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const service = getAudioService();
    service.setCachedBpm(filePath, bpm, source, confidence ?? null, analyzerVersion || 'manual-v1');
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Convert audio file to different format
 */
export async function convertAudio(
  inputPath: string,
  outputFormat: 'mp3' | 'flac' | 'aiff' | 'wav' | 'm4a' | 'ogg',
  outputPath?: string
): Promise<{ success: boolean; outputPath?: string; error?: string }> {
  try {
    const service = getAudioService();
    const result = await service.convert(inputPath, outputFormat, outputPath);

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return { success: true, outputPath: result.outputPath };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Write tags to an audio file (placeholder - full implementation would use node-taglib-sharp)
 */
export async function writeTags(input: AudioWriteTagsInput): Promise<{ success: boolean; message: string }> {
  try {
    const service = getAudioService();
    return await service.writeTags(input.filePath, input.metadata);
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function writeTagsBatch(
  inputs: AudioWriteTagsInput[],
): Promise<{ success: number; failed: number; results: Array<{ filePath: string; success: boolean; message: string }> }> {
  let success = 0;
  let failed = 0;
  const results: Array<{ filePath: string; success: boolean; message: string }> = [];

  for (const input of inputs) {
    const result = await writeTags(input);
    if (result.success) success += 1;
    else failed += 1;
    results.push({ filePath: input.filePath, success: result.success, message: result.message });
  }

  return { success, failed, results };
}
