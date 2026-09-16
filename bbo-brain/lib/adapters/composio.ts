import { SourceError, type SourceErrorKind } from './types';

const BASE = 'https://backend.composio.dev/api/v3';

type GraphError = { message?: string; code?: number; error_subcode?: number; is_transient?: boolean; type?: string };

type ProxyEnvelope = { data?: unknown; status?: number };

/**
 * Classifies a Graph API failure from STRUCTURED fields only — the upstream HTTP
 * status Composio reports and Meta's numeric error code / is_transient flag.
 * Never from message text (see repo CLAUDE.md: digit-scanning misread a 429 as a 400).
 */
export function classifyGraph(status: number, err?: GraphError): SourceErrorKind {
  if (err?.is_transient === true) return 'transient';
  if (status === 429 || status === 408 || status >= 500) return 'transient';
  // Meta rate-limit / temporary codes.
  if (err?.code !== undefined && [1, 2, 4, 17, 32, 341, 613].includes(err.code)) return 'transient';
  // Invalid parameter (e.g. metric not supported for this media type) or insights unavailable.
  if (err?.code === 100 || err?.error_subcode === 2207086) return 'unsupported';
  return 'hard';
}

export type ComposioProxyOptions = {
  apiKey: string;
  connectedAccountId: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  attempts?: number;
  timeoutMs?: number;
};

/** GETs arbitrary Graph API endpoints through Composio's stored Instagram OAuth credentials. */
export class ComposioProxy {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly attempts: number;
  private readonly timeoutMs: number;
  calls = 0;

  constructor(private readonly opts: ComposioProxyOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.attempts = opts.attempts ?? 3;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  async get<T>(endpoint: string): Promise<T> {
    let last: SourceError | null = null;
    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      if (attempt > 1) await this.sleep(1000 * 3 ** (attempt - 2));
      this.calls++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await this.fetchImpl(`${BASE}/tools/execute/proxy`, {
          method: 'POST',
          headers: { 'x-api-key': this.opts.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ connected_account_id: this.opts.connectedAccountId, endpoint, method: 'GET' }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const kind: SourceErrorKind = res.status === 429 || res.status >= 500 ? 'transient' : 'hard';
          last = new SourceError({ kind, status: res.status, message: `Composio returned HTTP ${res.status} for ${redact(endpoint)}` });
          if (kind === 'transient') continue;
          throw last;
        }
        const body = (await res.json()) as ProxyEnvelope;
        const upstream = typeof body.status === 'number' ? body.status : 200;
        const graphError = (body.data as { error?: GraphError } | undefined)?.error;
        if (upstream >= 400 || graphError) {
          const kind = classifyGraph(upstream, graphError);
          last = new SourceError({
            kind,
            status: upstream,
            code: graphError?.code,
            message: `Instagram ${upstream}${graphError?.code !== undefined ? ` (code ${graphError.code})` : ''}: ${graphError?.message ?? 'request failed'}`,
          });
          if (kind === 'transient') continue;
          throw last;
        }
        return body.data as T;
      } catch (err) {
        if (err instanceof SourceError) throw err;
        const aborted = err instanceof Error && err.name === 'AbortError';
        last = new SourceError({ kind: 'transient', message: aborted ? `Composio request timed out (${redact(endpoint)})` : `Composio request failed (${redact(endpoint)})` });
      } finally {
        clearTimeout(timer);
      }
    }
    throw last ?? new SourceError({ kind: 'transient', message: 'Composio request failed.' });
  }
}

/** Paging cursors are long opaque tokens; keep logs readable and free of them. */
function redact(endpoint: string): string {
  return endpoint.replace(/(after|before)=[^&]+/g, '$1=…');
}
