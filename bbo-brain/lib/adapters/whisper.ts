import { execFile } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { TranscriptResult, TranscriptSourceAdapter } from './types';

const exec = promisify(execFile);

type WhisperJson = {
  result?: { language?: string };
  transcription?: Array<{ offsets: { from: number; to: number }; text: string }>;
};

/** Parses whisper.cpp `-oj` output. Drops non-speech markers like "[Music]". */
export function parseWhisperJson(raw: WhisperJson, model: string): TranscriptResult {
  const segments = (raw.transcription ?? [])
    .map((s) => ({ start: s.offsets.from / 1000, end: s.offsets.to / 1000, text: s.text.trim() }))
    .filter((s) => s.text && !/^[[(].*[\])]$/.test(s.text));
  return {
    text: segments.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim(),
    segments,
    model,
    language: raw.result?.language ?? null,
  };
}

/** Local, free transcription with whisper.cpp. Nothing leaves the machine. */
export class WhisperCppAdapter implements TranscriptSourceAdapter {
  readonly id = 'whisper_local';

  constructor(
    private readonly cli: string,
    private readonly model: string,
    private readonly ffmpeg = 'ffmpeg'
  ) {}

  isAvailable(): boolean {
    return existsSync(this.cli) && existsSync(this.model);
  }

  async transcribe(mediaPath: string): Promise<TranscriptResult> {
    const base = mediaPath.replace(/\.[^.]+$/, '');
    const wav = `${base}.wav`;
    try {
      await exec(this.ffmpeg, ['-v', 'error', '-y', '-i', mediaPath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], { timeout: 180_000 });
      await exec(this.cli, ['-m', this.model, '-f', wav, '-oj', '-of', base, '-np', '-l', 'en'], { timeout: 600_000, maxBuffer: 16 * 1024 * 1024 });
      const raw = JSON.parse(readFileSync(`${base}.json`, 'utf8')) as WhisperJson;
      return parseWhisperJson(raw, `whisper.cpp:${path.basename(this.model)}`);
    } finally {
      rmSync(wav, { force: true });
      rmSync(`${base}.json`, { force: true });
    }
  }
}
