import { describe, expect, it } from 'vitest';
import {
  captionLengthBucket,
  captionMentions,
  captionType,
  ctaType,
  franchiseFromCaption,
  hashtagBucket,
  postingTime,
  titleFromCaption,
} from '@/lib/ingest/heuristics';
import { parseWhisperJson } from '@/lib/adapters/whisper';

describe('caption heuristics', () => {
  it('separates guests from locations, editors and the BBO account itself', () => {
    const mentions = captionMentions('Talk to em @essowrld 🔥 cc @dabboshow\nEdited By: @cuenoe.lens\nPodcast Space: @cozy_homies_studio_');
    expect(mentions).toEqual([
      { handle: 'essowrld', role: 'guest' },
      { handle: 'cuenoe.lens', role: 'editor' },
      { handle: 'cozy_homies_studio_', role: 'location' },
    ]);
  });

  it('codes caption opening type', () => {
    expect(captionType('Can an ex REALLY earn your trust back… or once it’s gone, it’s gone? 👀')).toBe('question');
    expect(captionType('“If I don’t catch you cheating, DON’T tell me” y’all agree with this?')).toBe('quote');
    expect(captionType('Women say effort matters… until the man walks in.')).toBe('claim_statement');
  });

  it('codes CTA type', () => {
    expect(ctaType('y’all agree with this?  Let us know 💋')).toBe('question_no_directive');
    expect(ctaType('Which side are you on? Comment below with your team')).toBe('comment_specific');
    expect(ctaType('Tag a friend who does this')).toBe('share_tag');
    expect(ctaType('Great food and great atmosphere')).toBe('none');
  });

  it('buckets hashtags and caption length', () => {
    expect(hashtagBucket('#cheaters #cheatersbelike #dating101')).toBe('1-4');
    expect(hashtagBucket('#a #b #c #d #e')).toBe('5+');
    expect(hashtagBucket('no tags')).toBe('0');
    expect(captionLengthBucket('short one')).toBe('short');
  });

  it('computes posting time in New York, not UTC', () => {
    // 2026-09-15T01:44:37Z is Monday 21:44 in New York.
    expect(postingTime('2026-09-15T01:44:37.000Z')).toEqual({ dow: 1, hour: 21, day: 'Mon', daypart: 'evening' });
  });

  it('only assigns a franchise when the caption says so', () => {
    expect(franchiseFromCaption('We took BBO Stamped to Brooklyn', [])?.slug).toBe('bbo-stamped');
    expect(franchiseFromCaption('Nah imagine doing content for fun and leaving single 💀\nPodcast space: @cozy_homies_studio_', [])?.slug).toBe('podcast');
    expect(franchiseFromCaption('Women say effort matters', [])).toBeNull();
  });

  it('titles from the first caption line', () => {
    expect(titleFromCaption('\nFirst line here\nsecond', 'x')).toBe('First line here');
    expect(titleFromCaption('', 'Instagram post 123')).toBe('Instagram post 123');
  });
});

describe('whisper parsing', () => {
  it('keeps timestamps and drops non-speech markers', () => {
    const result = parseWhisperJson(
      {
        result: { language: 'en' },
        transcription: [
          { offsets: { from: 0, to: 2060 }, text: ' We got my number and we used to casually text.' },
          { offsets: { from: 2060, to: 3000 }, text: ' [Music]' },
          { offsets: { from: 3000, to: 4300 }, text: ' Instead of me spending time with my friends' },
        ],
      },
      'whisper.cpp:test'
    );
    expect(result.segments).toHaveLength(2);
    expect(result.segments[1]).toEqual({ start: 3, end: 4.3, text: 'Instead of me spending time with my friends' });
    expect(result.text).toBe('We got my number and we used to casually text. Instead of me spending time with my friends');
  });
});
