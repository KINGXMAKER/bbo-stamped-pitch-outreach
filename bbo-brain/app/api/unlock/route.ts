import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS_COOKIE, tokenFor } from '@/lib/auth/token';

export const runtime = 'nodejs';

const BodySchema = z.object({ password: z.string().min(1).max(200), next: z.string().max(500).optional() });

export async function POST(request: Request) {
  const password = process.env.BRAIN_ACCESS_PASSWORD?.trim();
  if (!password) return NextResponse.json({ ok: true, next: '/' });
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Enter the access password.' }, { status: 400 });
  if (parsed.data.password !== password) {
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.json({ error: 'That password is not right.' }, { status: 401 });
  }
  const requested = parsed.data.next ?? '/';
  const destination = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/';
  const response = NextResponse.json({ ok: true, next: destination });
  response.cookies.set({ name: ACCESS_COOKIE, value: await tokenFor(password), httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 90 });
  return response;
}
