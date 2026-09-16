import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { ACCESS_COOKIE, safeEqual, tokenFor } from '@/lib/auth/token';

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|unlock|api/unlock).*)'],
};

export async function proxy(request: NextRequest) {
  const password = process.env.BRAIN_ACCESS_PASSWORD?.trim();
  if (!password) return NextResponse.next();

  const supplied = request.cookies.get(ACCESS_COOKIE)?.value;
  if (supplied && safeEqual(supplied, await tokenFor(password))) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Locked. Reload and enter the access password.' }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = '/unlock';
  url.search = '';
  url.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}
