/**
 * Deterministic, caption-level coding. Source = 'heuristic', low confidence.
 * AI enrichment (transcript-grounded) and human edits outrank these via the
 * attribute precedence in content_attribute_current. Nothing here guesses the
 * video's topic from a filename or a single quote.
 */

export const SELF_HANDLES = new Set(['dabboshow']);

export type CaptionMention = { handle: string; role: 'location' | 'editor' | 'creator' | 'voiceover' | 'guest' };

const ROLE_PREFIXES: Array<[RegExp, CaptionMention['role']]> = [
  [/^(location|podcast\s*space|studio|venue)\s*:/i, 'location'],
  [/^(edited\s*by|editor)\s*:/i, 'editor'],
  [/^(shot\s*by|filmed\s*by|dp|videographer)\s*:/i, 'creator'],
  [/^(voice\s*over|voiceover|vo)\s*:/i, 'voiceover'],
];

export function captionMentions(caption: string): CaptionMention[] {
  const out: CaptionMention[] = [];
  const seen = new Set<string>();
  for (const line of caption.split('\n')) {
    const trimmed = line.trim();
    const prefixed = ROLE_PREFIXES.find(([re]) => re.test(trimmed));
    for (const match of trimmed.matchAll(/@([A-Za-z0-9_.]+[A-Za-z0-9_])/g)) {
      const handle = match[1].toLowerCase();
      if (SELF_HANDLES.has(handle)) continue;
      const role = prefixed ? prefixed[1] : 'guest';
      const key = `${handle}:${role}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ handle, role });
    }
  }
  return out;
}

function firstSentence(caption: string): string {
  const line = caption.split('\n').find((l) => l.trim()) ?? '';
  const m = line.match(/^.*?[?!.…](?=\s|$)/);
  return (m ? m[0] : line).trim();
}

export function captionType(caption: string): 'question' | 'claim_statement' | 'quote' | 'other' {
  const text = caption.trim();
  if (!text) return 'other';
  const first = firstSentence(text);
  if (/^["“”'‘]/.test(first)) return 'quote';
  if (first.endsWith('?') || /^(who|what|when|where|why|how|is|are|do|does|did|can|could|would|should|will|which)\b/i.test(first)) {
    return 'question';
  }
  return 'claim_statement';
}

export function ctaType(caption: string): 'none' | 'comment_specific' | 'question_no_directive' | 'generic' | 'click_visit' | 'share_tag' {
  const c = caption.toLowerCase();
  if (/(which side|pick one|team [a-z]+ or team|comment (your|a|which|the|below with)|drop (a|an|your) [^\s]+ (if|below)|a or b|yes or no)/.test(c)) {
    return 'comment_specific';
  }
  if (/(tag (a|your|someone|the)|send (this|it) to|share (this|with))/.test(c)) return 'share_tag';
  if (/(link in bio|book (now|your)|visit|tickets|order now|dm (us|to))/.test(c)) return 'click_visit';
  if (/(let us know|let me know|thoughts\?|what (do )?y.?all think|agree\?|agree with this|what would you do|sound off|talk to (us|me))/.test(c)) {
    return 'question_no_directive';
  }
  if (/(follow (us|for more)|like and|comment below|drop a comment)/.test(c)) return 'generic';
  return 'none';
}

export function hashtagBucket(caption: string): '0' | '1-4' | '5+' {
  const n = (caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
  return n === 0 ? '0' : n < 5 ? '1-4' : '5+';
}

export function captionLengthBucket(caption: string): 'short' | 'medium' | 'long' {
  const n = caption.trim().length;
  return n < 80 ? 'short' : n < 200 ? 'medium' : 'long';
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Posting day/hour in America/New_York — BBO's home market, not UTC. */
export function postingTime(iso: string): { dow: number; hour: number; day: string; daypart: 'morning' | 'afternoon' | 'evening' | 'late_night' } | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);
  const day = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const daypart = hour >= 5 && hour < 12 ? 'morning' : hour < 17 && hour >= 12 ? 'afternoon' : hour >= 17 && hour < 22 ? 'evening' : 'late_night';
  return { dow: DAYS.indexOf(day), hour, day, daypart };
}

/** Caption/keyword franchise guess. Returns a franchise slug or null (unclassified). */
export function franchiseFromCaption(caption: string, mentions: CaptionMention[]): { slug: string; confidence: number } | null {
  const c = caption.toLowerCase();
  const rules: Array<[RegExp, string, number]> = [
    [/bbo court|court is (now )?in session/, 'bbo-court', 0.8],
    [/bbo stamped|\bstamped\b/, 'bbo-stamped', 0.75],
    [/group chat|your friend texts? you/, 'bbo-group-chat', 0.75],
    [/baddies? of the month/, 'baddies-of-the-month', 0.8],
    [/mirror talk/, 'mirror-talk-sessions', 0.8],
    [/after hours/, 'bbo-after-hours', 0.7],
    [/clock it/, 'clock-it', 0.7],
    [/king maker fridays?/, 'king-maker-fridays', 0.8],
    [/all[\s-]access|behind the scenes|\bbts\b|episode wrapped/, 'bbo-all-access', 0.6],
    [/street interview|on the street|asked (strangers|people) (in|on)/, 'street-interview', 0.6],
    [/new cast|coming soon|premieres?|tickets|pull up|rsvp/, 'announcements', 0.5],
    [/podcast|episode/, 'podcast', 0.55],
  ];
  for (const [re, slug, confidence] of rules) if (re.test(c)) return { slug, confidence };
  // A podcast studio tagged as the location is a strong podcast signal.
  if (mentions.some((m) => m.role === 'location' && /(pod|studio)/.test(m.handle)) && /podcast\s*space/i.test(caption)) {
    return { slug: 'podcast', confidence: 0.6 };
  }
  return null;
}

/** Audit V2 lane → franchise, only where the lane is a format rather than a topic. */
export const LANE_TO_FRANCHISE: Record<string, string> = {
  bbo_stamped_venue: 'bbo-stamped',
  baddies_of_the_month: 'baddies-of-the-month',
  bts_promo: 'bbo-all-access',
};

/** Title for the library: first caption line, trimmed. */
export function titleFromCaption(caption: string | null | undefined, fallback: string): string {
  const line = (caption ?? '').split('\n').map((l) => l.trim()).find(Boolean);
  if (!line) return fallback;
  return line.length > 90 ? `${line.slice(0, 87).trimEnd()}…` : line;
}
