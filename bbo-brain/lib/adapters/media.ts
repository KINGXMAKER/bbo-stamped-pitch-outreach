import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { MediaResult, MediaSourceAdapter, SourcePost } from './types';

const exec = promisify(execFile);

/** Hook frames the analysis looks at: first frame, 0.8s, 2s, 4s (BBO audit convention). */
export const HOOK_FRAME_TIMES = [0.05, 0.8, 2.0, 4.0];

async function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return exec(cmd, args, { maxBuffer: 32 * 1024 * 1024, timeout: 180_000 });
}

/** Downloads a post's media and measures it locally with ffprobe/ffmpeg. */
export class InstagramMediaAdapter implements MediaSourceAdapter {
  readonly id = 'instagram_media';

  constructor(private readonly tools = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' }) {}

  async fetchMedia(post: Pick<SourcePost, 'externalId' | 'mediaUrl' | 'mediaType'>, workDir: string): Promise<MediaResult | null> {
    if (!post.mediaUrl) return null;
    const framesDir = path.join(workDir, 'frames');
    mkdirSync(framesDir, { recursive: true });

    const res = await fetch(post.mediaUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`media download failed: HTTP ${res.status}`);
    const contentType = res.headers.get('content-type') ?? '';
    const isVideo = contentType.startsWith('video/') || post.mediaType === 'VIDEO';
    const mediaPath = path.join(workDir, `${post.externalId}.${isVideo ? 'mp4' : 'jpg'}`);
    writeFileSync(mediaPath, Buffer.from(await res.arrayBuffer()));
    if (statSync(mediaPath).size === 0) throw new Error('media download was empty');

    const thumbPath = path.join(framesDir, `${post.externalId}_thumb.jpg`);
    if (!isVideo) {
      await run(this.tools.ffmpeg, ['-v', 'error', '-y', '-i', mediaPath, '-vf', 'scale=480:-1', thumbPath]);
      return { mediaPath, isVideo, durationS: null, integratedLufs: null, framePaths: [], thumbPath: existsSync(thumbPath) ? thumbPath : null };
    }

    const probe = await run(this.tools.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mediaPath]);
    const durationRaw = Number.parseFloat(probe.stdout.trim());
    const durationS = Number.isFinite(durationRaw) ? Math.round(durationRaw * 10) / 10 : null;

    let integratedLufs: number | null = null;
    try {
      const loud = await run(this.tools.ffmpeg, ['-nostats', '-i', mediaPath, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-']);
      const match = loud.stderr.match(/I:\s+(-?[\d.]+)\s+LUFS/);
      if (match) integratedLufs = Number.parseFloat(match[1]);
    } catch {
      integratedLufs = null; // loudness is supporting data only
    }

    const framePaths: Array<{ atS: number; path: string }> = [];
    for (const at of HOOK_FRAME_TIMES) {
      if (durationS !== null && at >= durationS) continue;
      const out = path.join(framesDir, `${post.externalId}_${at.toFixed(2)}.jpg`);
      await run(this.tools.ffmpeg, ['-v', 'error', '-y', '-ss', String(at), '-i', mediaPath, '-frames:v', '1', '-vf', 'scale=360:-1', '-q:v', '5', out]);
      if (existsSync(out)) framePaths.push({ atS: at, path: out });
    }
    if (framePaths[0]) {
      await run(this.tools.ffmpeg, ['-v', 'error', '-y', '-i', framePaths[0].path, '-vf', 'scale=480:-1', thumbPath]);
    }

    return { mediaPath, isVideo, durationS, integratedLufs, framePaths, thumbPath: existsSync(thumbPath) ? thumbPath : null };
  }
}
