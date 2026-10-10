import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { ACCESS_COOKIE, safeEqual, tokenFor } from '@/lib/auth/token';

/** Everything except Next's own assets, the unlock screen and its endpoint. */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|unlock|api/unlock).*)'],
};

export async function proxy(request: NextRequest) {
  const password = process.env.BBO_ACCESS_PASSWORD?.trim();

  // No password configured — the gate is off. Keeps local dev frictionless.
  if (!password) return NextResponse.next();

  const expected = await tokenFor(password);
  const supplied = request.cookies.get(ACCESS_COOKIE)?.value;
  if (supplied && safeEqual(supplied, expected)) return NextResponse.next();

  // An API call must not be answered with a redirect to an HTML page — the
  // client would try to parse the unlock screen as JSON and report a confusing
  // failure instead of "you are signed out".
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: 'This session is locked. Reload the page and enter the access password.', kind: 'locked' },
      { status: 401 }
    );
  }

  const url = request.nextUrl.clone();
  url.pathname = '/unlock';
  url.search = '';
  url.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}
