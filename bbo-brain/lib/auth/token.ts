/**
 * Optional access gate (same approach as bbo-stamped). BBO BRAIN binds to
 * 127.0.0.1 by default; set BRAIN_ACCESS_PASSWORD before exposing it on
 * Tailscale or any network. One shared password hashed into a cookie — not
 * user accounts, and it does not pretend to be.
 */

export const ACCESS_COOKIE = 'bbo_brain_access';

/** Web Crypto only, so it runs in the proxy runtime too. */
export async function tokenFor(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(`bbo-brain:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
