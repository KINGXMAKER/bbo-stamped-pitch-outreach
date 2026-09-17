'use strict';
// Error classification shared by the router, providers and callers. Classifies by EXTRACTED status
// code, never by scanning message text for digits (a retryDelay like "2.199104009s" contains "400").

const TRANSIENT_CODES = ['429', '500', '502', '503', '504'];
const HARD_CODES = ['400', '401', '403'];

// SDKs and our fetch adapters render HTTP errors as "[NNN Reason] ...". Anchor on that bracketed form.
function getStatusCode(err) {
  const m = (err && err.message) ? err.message : '';
  const match = m.match(/\[(\d{3})[\s\]]/);
  return match ? match[1] : null;
}

const msg = (err) => (err && err.message) ? err.message : '';

function isTimeoutError(err) {
  return /aborted|AbortError|deadline|timed? ?out|ETIMEDOUT/i.test(msg(err)) || (err && err.name === 'AbortError');
}

function isNetworkError(err) {
  return /ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up|network/i.test(msg(err));
}

// Retry-worthy / fail-over-worthy: temporary overload, capacity, timeouts.
function isTransientError(err) {
  const code = getStatusCode(err);
  return (code && TRANSIENT_CODES.includes(code)) || isTimeoutError(err) || isNetworkError(err) ||
    /overload|unavailable|high demand|try again later/i.test(msg(err));
}

// A missing/removed model (404): not transient, but skip to the next model.
function isModelUnavailable(err) {
  return getStatusCode(err) === '404' || /not found|is not supported|no longer available/i.test(msg(err));
}

// Auth, bad key, malformed request, invalid image. Never retried on the same provider.
function isHardError(err) {
  if (isModelUnavailable(err)) return false;
  const code = getStatusCode(err);
  return (code && HARD_CODES.includes(code)) ||
    /API key|api_key|permission|invalid argument|invalid image|unsupported/i.test(msg(err));
}

// Rate-limit / quota (429).
function isQuotaError(err) {
  return getStatusCode(err) === '429' || /quota|rate.?limit|too many requests|resource_exhausted/i.test(msg(err));
}

// One label per failure. Order matters: quota before transient (429 is both), timeout before
// transient so latency problems are reported as such.
function classifyError(err) {
  const code = getStatusCode(err);
  if (isQuotaError(err)) return 'quota';
  if (isModelUnavailable(err)) return 'unavailable';
  if (code === '401' || code === '403' || /API key|api_key|permission/i.test(msg(err))) return 'auth';
  if (isHardError(err)) return 'bad_request';
  if (isTimeoutError(err)) return 'timeout';
  if (isNetworkError(err)) return 'network';
  if (isTransientError(err)) return 'transient';
  return 'other';
}

// Error code for logs/DB: the HTTP status when there is one, else the class.
function errorCodeOf(err) {
  return getStatusCode(err) || classifyError(err);
}

// When every candidate fails we report the most actionable failure, not the last rung's.
const FAILURE_RANK = { auth: 6, bad_request: 5, quota: 4, unavailable: 3, timeout: 2, transient: 2, network: 2, other: 0 };

// Maps the fine-grained class onto the public failureKind callers already understand.
function failureKindOf(errorClass) {
  if (errorClass === 'quota') return 'quota';
  if (errorClass === 'unavailable') return 'unavailable';
  if (errorClass === 'timeout' || errorClass === 'transient' || errorClass === 'network') return 'transient';
  return 'other';
}

// Never let a secret reach a log line or a database row.
function scrub(text, max = 500) {
  return String(text || '')
    .replace(/([?&](?:key|api_key|token)=)[^&\s"]+/gi, '$1[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/g, 'Bearer [redacted]')
    .replace(/AIza[0-9A-Za-z_\-]{20,}/g, '[redacted-google-key]')
    .replace(/(sk-or-v1-|nvapi-)[A-Za-z0-9_\-]+/g, '$1[redacted]')
    .replace(/^\[GoogleGenerativeAI Error\]:\s*Error fetching from \S+:\s*/, '')
    .slice(0, max);
}

module.exports = {
  getStatusCode, isTransientError, isModelUnavailable, isHardError, isQuotaError, isTimeoutError,
  classifyError, errorCodeOf, failureKindOf, FAILURE_RANK, scrub,
};
