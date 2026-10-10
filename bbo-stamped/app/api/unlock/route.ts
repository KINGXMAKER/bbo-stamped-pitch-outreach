import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS_COOKIE, tokenFor } from '@/lib/auth/token';

export const runtime = 'nodejs';

const BodySchema = z.object({
  password: z.string().min(1).max(200),
  next: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  const password = process.env.BBO_ACCESS_PASSWORD?.trim();
  if (!password) {
    return NextResponse.json({ ok: true, next: '/' });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter the access password.' }, { status: 400 });
  }

  if (parsed.data.password !== password) {
    // Deliberately vague and slow-ish: nothing here tells an attacker whether
    // they got the length or the prefix right.
    await new Promise((resolve) => setTimeout(resolve, 600));
    return NextResponse.json({ error: 'That password is not right.' }, { status: 401 });
  }

  // Only ever redirect to a path on this app, never to an absolute URL a
  // caller supplied — that would make this an open redirect.
  const requested = parsed.data.next ?? '/';
  const destination = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/';

  const response = NextResponse.json({ ok: true, next: destination });
  response.cookies.set({
    name: ACCESS_COOKIE,
    value: await tokenFor(password),
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 90,
  });
  return response;
}
