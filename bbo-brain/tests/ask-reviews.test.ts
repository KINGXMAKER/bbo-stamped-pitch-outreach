import { beforeAll, describe, expect, it } from 'vitest';
import { get, type Db } from '@/lib/db/client';
import { setGenerator } from '@/lib/ai/run';
import { askBbo, buildEvidence, routeQuestion } from '@/lib/intel/ask';
import { mineLessons } from '@/lib/intel/lessons';
import { computeOpportunities, generateOpportunities, latestOpportunities, setOpportunityStatus } from '@/lib/intel/opportunities';
import { buildWeeklyReview } from '@/lib/intel/reviews';
import { neighbors, rebuildGraph } from '@/lib/intel/graph';
import { rebuildSearchIndex, search, toFtsQuery } from '@/lib/intel/search';
import { setAttribute, writeMetrics } from '@/lib/ingest/ingest';
import { activeScoreVersion, computeAllScores } from '@/lib/scoring/engine';
import { makePost, testDb } from './helpers';

beforeAll(() => {
  // Never reach a real model from tests, whatever the shell environment holds.
  process.env.GEMINI_API_KEY = '';
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = '';
  setGenerator(null);
});

describe('Ask BBO routing covers the acceptance questions', () => {
  const db = testDb();
  const cases: Array<[string, Record<string, unknown>]> = [
    ['What has BBO learned?', { kind: 'learned', days: null }],
    ['What did BBO learn this week?', { kind: 'learned', days: 7 }],
    ['What did BBO learn this month?', { kind: 'learned', days: 30 }],
    ['Why did this clip win?', { kind: 'why_content' }],
    ['Why did this clip lose?', { kind: 'why_content' }],
    ['What hooks work best for BBO?', { kind: 'attribute', key: 'hook_type' }],
    ['What topics generate the most shares?', { kind: 'topics', metric: 'share_rel', mode: 'best' }],
    ['What topics generate comments but poor retention?', { kind: 'topics', mode: 'comments_not_retention' }],
    ['Which guests consistently outperform?', { kind: 'guests', mode: 'best' }],
    ['Which content lengths work best?', { kind: 'attribute', key: 'duration_bucket' }],
    ['What should BBO make next?', { kind: 'make_next' }],
    ['What should we stop doing?', { kind: 'stop_doing' }],
    ['What should we test next?', { kind: 'test_next' }],
    ['What BBO rules have the strongest evidence?', { kind: 'rules_evidence' }],
    ['What rules are being challenged?', { kind: 'rules_challenged' }],
    ['What did we believe three months ago that we no longer believe?', { kind: 'belief_changes', days: 90 }],
    ['Which relationship topics perform best when the guest is male?', { kind: 'topics', guestGender: 'male' }],
    ['Which first two-second hooks generate the strongest retention?', { kind: 'attribute', key: 'hook_type', metric: 'retention_rel' }],
    ['Do question captions outperform declarative captions?', { kind: 'attribute', key: 'caption_type' }],
    ['Are 22–35 second clips outperforming 45–60 second clips?', { kind: 'attribute', key: 'duration_bucket' }],
    ['Does showing my reaction immediately after a crazy statement improve retention?', { kind: 'attribute', key: 'reaction_timing', metric: 'retention_rel' }],
    ['Which guests generate the highest share rates?', { kind: 'guests', metric: 'share_rel' }],
    ['Which guests generate comments but poor retention?', { kind: 'guests', mode: 'comments_not_retention' }],
    ["What topics perform well on the podcast but haven't been used in BBO Court?", { kind: 'topic_gap', from: 'podcast', to: 'bbo-court' }],
    ['What hook style works best for street interviews?', { kind: 'attribute', key: 'hook_type', franchise: 'street-interview' }],
    ['What should I make this week?', { kind: 'make_next' }],
    ['What old topics should I bring back?', { kind: 'make_next' }],
    ["What are BBO's strongest content patterns right now?", { kind: 'learned' }],
  ];
  for (const [question, expected] of cases) {
    it(question, () => {
      expect(routeQuestion(db, question)).toMatchObject(expected);
    });
  }
});

function seeded(): Db {
  const db = testDb();
  const start = Date.UTC(2026, 2, 1);
  for (let i = 0; i < 30; i++) {
    const confession = i % 2 === 0;
    const publishedAt = new Date(start + i * 3 * 86_400_000).toISOString();
    const { contentId, postId } = makePost(db, {
      publishedAt,
      caption: confession ? `Confession ${i}: the first date story nobody expected` : `Question ${i}: would you split the bill?`,
      title: confession ? `Confession ${i}` : `Question ${i}`,
      franchiseSlug: 'podcast',
    });
    setAttribute(db, contentId, 'content_bucket', 'CORE_INTERVIEW_CONTENT', 'human', 1);
    setAttribute(db, contentId, 'hook_type', confession ? 'confession' : 'question', 'human', 1);
    setAttribute(db, contentId, 'duration_bucket', confession ? '16-30s' : '46-60s', 'measured', 1);
    db.prepare(`INSERT INTO content_topics (content_id, topic_id, is_primary, source) SELECT ?, id, 1, 'human' FROM topics WHERE slug = ?`).run(contentId, confession ? 'dating' : 'money');
    writeMetrics(db, postId, { reach: 1000 + i * 7, shares: confession ? 30 : 9, comments: confession ? 12 : 5, saves: confession ? 11 : 5, likes: 45, avg_watch_time_ms: confession ? 15000 : 11000, skip_rate: 30 }, new Date(start + i * 3 * 86_400_000 + 6 * 86_400_000).toISOString(), 'test');
  }
  computeAllScores(db, activeScoreVersion(db), new Date(Date.UTC(2026, 5, 20)));
  return db;
}

describe('grounded evidence and answers', () => {
  it('builds attribute evidence with sample sizes, date range and supporting posts', () => {
    const db = seeded();
    const e = buildEvidence(db, { kind: 'attribute', key: 'hook_type', metric: 'performance_score' });
    expect(e.sampleSize).toBe(30);
    expect(e.dateRange?.from).toBe('2026-03-01');
    expect(e.tables[0].rows[0][0]).toBe('confession');
    expect(e.tables[0].rows[0][1]).toBe(15);
    expect(e.supporting[0].title).toMatch(/^Confession/);
  });

  it('answers deterministically from evidence when AI is unavailable', async () => {
    const db = seeded();
    const result = await askBbo(db, 'What hooks work best for BBO?');
    expect(result.answeredBy).toBe('deterministic');
    expect(result.answer).toContain('confession');
    expect(result.answer).toContain('30 records');
    expect(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM ai_runs')!.n).toBe(0);
  });

  it('says plainly when the data cannot answer', async () => {
    const db = testDb();
    const result = await askBbo(db, 'Which guests consistently outperform?');
    expect(result.answer).toMatch(/no records in BBO BRAIN answer this yet/);
  });

  it('uses the AI only to narrate the calculated evidence', async () => {
    const db = seeded();
    let seenPrompt = '';
    setGenerator(async (req) => {
      seenPrompt = req.prompt;
      return { text: JSON.stringify({ answer: 'Confession hooks lead.', caveats: [] }), model: 'scripted', provider: 'test' };
    });
    try {
      const r = await askBbo(db, 'What hooks work best for BBO?');
      expect(r.answeredBy).toBe('ai');
      expect(seenPrompt).toContain('EVIDENCE JSON');
      expect(seenPrompt).toContain('"sampleSize":30');
      expect(get<{ workflow: string }>(db, 'SELECT workflow FROM ai_runs ORDER BY id DESC LIMIT 1')!.workflow).toBe('ask');
    } finally {
      setGenerator(null);
    }
  });
});

describe('weekly review', () => {
  it('always produces a stored review and upserts the same period', async () => {
    const db = seeded();
    const now = new Date(Date.UTC(2026, 3, 30));
    const id1 = await buildWeeklyReview(db, now);
    const id2 = await buildWeeklyReview(db, now);
    expect(id1).toBe(id2);
    const row = get<{ narrative_json: string; evidence_json: string }>(db, 'SELECT narrative_json, evidence_json FROM weekly_reviews WHERE id = ?', id1)!;
    const narrative = JSON.parse(row.narrative_json);
    const evidence = JSON.parse(row.evidence_json);
    expect(narrative.source).toBe('deterministic');
    expect(evidence.top.score.length).toBeGreaterThan(0);
    expect(evidence.counts.posts).toBeGreaterThan(0);
    expect(narrative.what_worked).toMatch(/Confession/);
  });
});

describe('content opportunities', () => {
  it('ranks evidence-backed opportunities and keeps dismissals across batches', () => {
    const db = seeded();
    const now = new Date(Date.UTC(2026, 5, 20));
    const opps = computeOpportunities(db, now);
    expect(opps.some((o) => o.kind === 'hook_pattern' && /confession/.test(o.title))).toBe(true);
    expect(opps.every((o) => o.sampleSize >= 0 && o.why.length > 0)).toBe(true);
    generateOpportunities(db, now);
    const first = latestOpportunities(db).items[0];
    setOpportunityStatus(db, first.id, 'dismissed');
    generateOpportunities(db, now);
    expect(latestOpportunities(db).items.some((o) => o.title === first.title && o.kind === first.kind)).toBe(false);
  });
});

describe('search and knowledge graph', () => {
  it('indexes content and lessons and sanitises queries', () => {
    const db = seeded();
    mineLessons(db);
    rebuildSearchIndex(db);
    expect(toFtsQuery('dating "OR" *')).toBe('"dating"* AND "or"*');
    expect(search(db, 'first date story', { types: ['content'] }).length).toBe(15);
    expect(search(db, 'hook confession', { types: ['lesson'] }).length).toBeGreaterThan(0);
  });

  it('materialises queryable relationships', () => {
    const db = seeded();
    const edges = rebuildGraph(db);
    expect(edges).toBeGreaterThan(60);
    const dating = get<{ id: number }>(db, `SELECT id FROM topics WHERE slug = 'dating'`)!.id;
    const about = neighbors(db, 'topic', String(dating), 'ABOUT');
    expect(about).toHaveLength(15);
    expect(about[0].src.type).toBe('content');
  });
});
