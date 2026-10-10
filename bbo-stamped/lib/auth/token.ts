/**
 * Access gate for the deployed app.
 *
 * The deployment is a public URL sitting in front of server-side AI keys, so an
 * unprotected deploy means anyone with the link can spend real credits. This is
 * deliberately the smallest thing that closes that hole: one shared password,
 * hashed into a cookie. It is not user accounts and does not pretend to be.
 *
 * When BBO_ACCESS_PASSWORD is unset the gate is off, so local development and
 * the tests are untouched.
 */

export const ACCESS_COOKIE = 'bbo_access';

/** Web Crypto only — this has to run in the edge middleware runtime too. */
export async function tokenFor(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(`bbo-stamped:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time compare so the cookie cannot be guessed a character at a time. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
