import { describe, expect, it } from 'vitest';
import { classifyGraph, ComposioProxy } from '@/lib/adapters/composio';
import { InstagramComposioAdapter, parseInsights, toSourcePost } from '@/lib/adapters/instagram';
import { SourceError } from '@/lib/adapters/types';

type Reply = { http?: number; body: unknown };

function fakeFetch(replies: Reply[]) {
  const calls: string[] = [];
  const impl = (async (_url: string, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)).endpoint);
    const reply = replies.shift();
    if (!reply) throw new Error('no more replies');
    return new Response(JSON.stringify(reply.body), { status: reply.http ?? 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const proxy = (replies: Reply[]) => {
  const f = fakeFetch(replies);
  return { proxy: new ComposioProxy({ apiKey: 'k', connectedAccountId: 'ca', fetchImpl: f.impl, sleep: async () => {} }), calls: f.calls };
};

describe('classifyGraph (structured fields only)', () => {
  it('reads transient from status and Meta flags, never from message digits', () => {
    expect(classifyGraph(400, { code: 4, message: 'retry in 400ms' })).toBe('transient');
    expect(classifyGraph(503)).toBe('transient');
    expect(classifyGraph(400, { code: 100, message: 'metric not supported' })).toBe('unsupported');
    expect(classifyGraph(400, { code: 190, message: 'token expired 429' })).toBe('hard');
    expect(classifyGraph(400, { is_transient: true })).toBe('transient');
  });
});

describe('ComposioProxy', () => {
  it('retries transient upstream failures then succeeds', async () => {
    const { proxy: p, calls } = proxy([
      { body: { status: 500, data: { error: { code: 2, message: 'temporary' } } } },
      { body: { status: 200, data: { data: [{ id: '1' }] } } },
    ]);
    await expect(p.get('/x')).resolves.toEqual({ data: [{ id: '1' }] });
    expect(calls).toHaveLength(2);
  });

  it('does not retry an unsupported metric', async () => {
    const { proxy: p, calls } = proxy([{ body: { status: 400, data: { error: { code: 100, message: 'not supported for this media product type' } } } }]);
    await expect(p.get('/x')).rejects.toMatchObject({ kind: 'unsupported', code: 100 });
    expect(calls).toHaveLength(1);
  });

  it('treats a rejected API key as hard', async () => {
    const { proxy: p } = proxy([{ http: 401, body: { error: 'unauthorized' } }]);
    await expect(p.get('/x')).rejects.toBeInstanceOf(SourceError);
  });
});

describe('InstagramComposioAdapter', () => {
  it('maps Graph media and insights onto canonical fields', () => {
    const post = toSourcePost({ id: '9', timestamp: '2026-09-15T01:44:37+0000', media_type: 'VIDEO', media_product_type: 'REELS', caption: 'hi', permalink: 'https://instagram.com/reel/x' });
    expect(post.publishedAt).toBe('2026-09-15T01:44:37.000Z');
    expect(
      parseInsights({ data: [{ name: 'saved', values: [{ value: 29 }] }, { name: 'reels_skip_rate', values: [{ value: 34.6 }] }] })
    ).toEqual({ saves: 29, skip_rate: 34.6 });
  });

  it('falls back per metric when one metric in the batch is rejected, keeping the rest', async () => {
    const { proxy: p } = proxy([
      { body: { status: 400, data: { error: { code: 100, message: 'does not support the follows metric for this media product type' } } } },
      { body: { status: 200, data: { data: [{ name: 'reach', values: [{ value: 100 }] }] } } },
      { body: { status: 400, data: { error: { code: 100, message: 'does not support the follows metric for this media product type' } } } },
    ]);
    const adapter = new InstagramComposioAdapter(p, 'ig');
    // Narrow the metric list by pretending the product type is unknown FEED with two metrics.
    (adapter as unknown as { unsupported: Map<string, Set<string>> }).unsupported.set(
      'FEED',
      new Set(['views', 'likes', 'comments', 'saved', 'shares', 'total_interactions', 'profile_visits'])
    );
    const result = await adapter.postMetrics({ externalId: '1', mediaProductType: 'FEED' });
    expect(result.metrics).toEqual({ reach: 100 });
    expect(result.unavailable.map((u) => u.metric)).toContain('follows');
  });

  it('paginates until posts are older than since', async () => {
    const { proxy: p, calls } = proxy([
      { body: { status: 200, data: { data: [{ id: 'a', timestamp: '2026-09-10T00:00:00+0000' }, { id: 'b', timestamp: '2026-09-05T00:00:00+0000' }], paging: { next: 'n', cursors: { after: 'c1' } } } } },
      { body: { status: 200, data: { data: [{ id: 'c', timestamp: '2026-08-20T00:00:00+0000' }], paging: { next: 'n', cursors: { after: 'c2' } } } } },
    ]);
    const adapter = new InstagramComposioAdapter(p, 'ig');
    const posts = await adapter.listPosts({ since: '2026-09-01T00:00:00.000Z' });
    expect(posts.map((x) => x.externalId)).toEqual(['a', 'b']);
    expect(calls).toHaveLength(2);
  });
});
