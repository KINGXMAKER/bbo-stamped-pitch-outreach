import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { get, getDb } from '@/lib/db/client';
import { brainConfig } from '@/lib/config';

export const runtime = 'nodejs';

/** Serves a post's locally stored thumbnail. Paths come from the DB but are still confined to the media dir. */
export async function GET(_req: Request, ctx: { params: Promise<{ contentId: string }> }) {
  const { contentId } = await ctx.params;
  const id = Number(contentId);
  if (!Number.isInteger(id)) return new Response('Bad id', { status: 400 });
  const row = get<{ thumb_path: string | null }>(getDb(), 'SELECT thumb_path FROM content WHERE id = ?', id);
  const mediaDir = path.resolve(brainConfig().mediaDir);
  const file = row?.thumb_path ? path.resolve(row.thumb_path) : null;
  if (!file || !file.startsWith(mediaDir + path.sep) || !existsSync(file)) return new Response('Not found', { status: 404 });
  return new Response(readFileSync(file), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } });
}
