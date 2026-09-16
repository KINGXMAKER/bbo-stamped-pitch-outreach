import { describe, expect, it } from 'vitest';
import { get } from '@/lib/db/client';
import { triggerHits, type Triggers } from '@/lib/intel/analysis';
import type { ContentFact } from '@/lib/intel/dataset';
import { assignContent, autoAssign, completeExperiment, createExperiment, evaluateExperiment, startExperiment } from '@/lib/intel/experiments';
import { setAttribute, writeMetrics } from '@/lib/ingest/ingest';
import { activeScoreVersion, computeAllScores } from '@/lib/scoring/engine';
import { DEFAULT_TRIGGERS } from '@/lib/seed/reference';
import { makePost, testDb } from './helpers';

const fact = (over: Partial<ContentFact>): ContentFact =>
  ({
    contentId: 1,
    postId: 1,
    title: 't',
    platform: 'instagram',
    format: 'reel',
    publishedAt: '2026-06-01T00:00:00.000Z',
    url: null,
    caption: '',
    franchise: null,
    franchiseName: null,
    durationS: 30,
    isDemo: false,
    isMature: true,
    score: 1,
    label: 'AVERAGE',
    percentile: 0.5,
    baselineGroup: 'g',
    components: [],
    raw: {},
    rates: {},
    attrs: {},
    attrSources: {},
    topics: [],
    people: [],
    thumbPath: null,
    hasTranscript: false,
    ...over,
  }) as ContentFact;

describe('winner / loser triggers', () => {
  const t = DEFAULT_TRIGGERS as Triggers;

  it('ignores average posts', () => {
    expect(triggerHits([fact({ score: 1.1 })], t)).toHaveLength(0);
  });

  it('classifies winners and losers by score thresholds', () => {
    const [win] = triggerHits([fact({ contentId: 1, score: 1.8 })], t);
    const [lose] = triggerHits([fact({ contentId: 2, score: 0.4 })], t);
    expect(win.outcome).toBe('winner');
    expect(lose.outcome).toBe('loser');
  });

  it('flags component outliers even when the overall score is average', () => {
    const hits = triggerHits([fact({ score: 1.05, components: [{ key: 'share_rate', value: 0.03, peerMedian: 0.01, ratio: 3, weight: 0.25 }] })], t);
    expect(hits[0].reasons[0]).toMatch(/share rate 3\.0x peer median/);
  });

  it('marks mixed signals as notable and never analyses immature posts', () => {
    const mixed = triggerHits(
      [fact({ score: 1.6, components: [{ key: 'retention', value: 0.1, peerMedian: 0.4, ratio: 0.25, weight: 0.15 }] })],
      t
    );
    expect(mixed[0].outcome).toBe('notable');
    expect(triggerHits([fact({ score: 3, isMature: false })], t)).toHaveLength(0);
  });
});

describe('experiments', () => {
  function seed() {
    const db = testDb();
    const start = Date.UTC(2026, 2, 1);
    const ids: number[] = [];
    for (let i = 0; i < 24; i++) {
      const publishedAt = new Date(start + i * 2 * 86_400_000).toISOString();
      const { contentId, postId } = makePost(db, { publishedAt });
      const question = i % 2 === 0;
      setAttribute(db, contentId, 'caption_type', question ? 'question' : 'claim_statement', 'human', 1);
      writeMetrics(db, postId, { reach: 1000, shares: question ? 25 + i : 10 + (i % 3), comments: question ? 15 : 5, saves: 6, likes: 40, avg_watch_time_ms: 14000, skip_rate: 30 }, new Date(start + i * 2 * 86_400_000 + 5 * 86_400_000).toISOString(), 'test');
      ids.push(contentId);
    }
    computeAllScores(db, activeScoreVersion(db), new Date(Date.UTC(2026, 5, 1)));
    return { db, ids };
  }

  it('assigns by attribute, respects human assignments, evaluates and turns the result into a lesson', () => {
    const { db, ids } = seed();
    const id = createExperiment(db, {
      name: 'Question vs statement caption',
      hypothesis: 'Question-led captions drive more comments.',
      variableKey: 'caption_type',
      controlValue: 'claim_statement',
      variantValue: 'question',
      primaryMetric: 'comment_rate',
      origin: 'human',
    });
    expect(autoAssign(db, id)).toEqual({ control: 0, variant: 0 }); // not running yet
    startExperiment(db, id, '2026-03-01T00:00:00.000Z');
    expect(() => startExperiment(db, id)).toThrow(/Only proposed/);

    assignContent(db, id, ids[0], 'control'); // human override of a 'question' post
    const assigned = autoAssign(db, id);
    expect(assigned.variant).toBe(11);
    expect(assigned.control).toBe(12);
    expect(get<{ arm: string; assigned_by: string }>(db, 'SELECT arm, assigned_by FROM experiment_content WHERE content_id = ?', ids[0])).toEqual({ arm: 'control', assigned_by: 'human' });

    const evaluation = evaluateExperiment(db, id);
    expect(evaluation.ready).toBe(true);
    expect(evaluation.primary.verdict).toBe('positive');

    const { lessonId } = completeExperiment(db, id);
    const lesson = get<{ origin: string; related_experiment_id: number; text: string }>(db, 'SELECT origin, related_experiment_id, text FROM lessons WHERE id = ?', lessonId);
    expect(lesson).toMatchObject({ origin: 'experiment', related_experiment_id: id });
    expect(lesson!.text).toMatch(/beat "claim statement" on comment rate/);
    expect(() => completeExperiment(db, id)).toThrow(/already completed/);
  });

  it('refuses unknown variables and metrics', () => {
    const { db } = seed();
    expect(() => createExperiment(db, { name: 'x', hypothesis: 'x', variableKey: 'not_a_key', controlValue: 'a', variantValue: 'b', primaryMetric: 'share_rate', origin: 'human' })).toThrow(/Unknown attribute/);
  });
});
