/**
 * Curated reference data. Franchises and formats come from the BBO Master
 * Brain (01 Brand Laws, 2026-08-29) §9; topic hierarchy from the brief plus the
 * lanes the weekly audits have actually coded. Nothing here is a metric.
 */

export const PLATFORMS = [
  { id: 'instagram', name: 'Instagram' },
  { id: 'tiktok', name: 'TikTok' },
  { id: 'youtube', name: 'YouTube' },
];

export const FRANCHISES: Array<{ slug: string; name: string; description: string; aliases: string[] }> = [
  { slug: 'podcast', name: 'BBO Podcast', description: 'Sit-down panel clips from the BBO podcast set.', aliases: ['Podcast', 'BBO Podcast', 'Podcast Space', 'Podcast Clip', 'BBO Show Podcast'] },
  { slug: 'bbo-court', name: 'BBO Court', description: 'Case card → both sides → cross-examination → twist → verdict → CTA.', aliases: ['Court', 'BBOCourt', 'BBO Court Show'] },
  { slug: 'street-interview', name: 'Street Interview', description: 'Mic-on-the-street questions and reactions.', aliases: ['Street', 'Street Interviews', 'Man on the street'] },
  { slug: 'bbo-group-chat', name: 'BBO Group Chat', description: '"Your friend texts you…" carousel with a binary CTA.', aliases: ['Group Chat', 'Your Friend Texts You'] },
  { slug: 'baddie-irl', name: 'Baddie IRL', description: 'Street/real-world women-centered content.', aliases: ['Baddie In Real Life'] },
  { slug: 'mirror-talk-sessions', name: 'Mirror Talk Sessions', description: 'Music interview format.', aliases: ['Mirror Talk'] },
  { slug: 'bbo-after-hours', name: 'BBO After Hours', description: 'Late-night, more provocative conversation.', aliases: ['After Hours'] },
  { slug: 'bbo-all-access', name: 'BBO All-Access', description: 'Behind-the-scenes content.', aliases: ['All Access', 'All-Access', 'BBO All Access', 'BTS', 'Behind the scenes'] },
  { slug: 'king-maker-fridays', name: 'King Maker Fridays', description: 'Founder-led Close Friends reflection (Flowers → Story → Callout → Lesson → Promise).', aliases: ['KMF', 'Close Friends', 'King Maker Friday'] },
  { slug: 'bbo-stamped', name: 'BBO Stamped', description: 'Venue/experience content — analysed as content only.', aliases: ['Stamped', 'BBO Stamped'] },
  { slug: 'clock-it', name: 'Clock It', description: 'Repostable quote content.', aliases: ['Clock It Chronicles', 'Clock It Quotes'] },
  { slug: 'baddies-of-the-month', name: 'Baddies of the Month', description: 'Recurring women spotlight.', aliases: ['Baddie of the Month', 'BOTM'] },
  { slug: 'bbo-news', name: 'BBO News', description: 'Entertainment, music and culture coverage.', aliases: ['News'] },
  { slug: 'faceoff', name: 'Faceoff', description: 'Artist vs artist / culture debate / who-won prompts.', aliases: ['Face Off', 'Faceoff Graphics'] },
  { slug: 'announcements', name: 'Announcements & Promo', description: 'Cast teasers, episode announcements and event promo.', aliases: ['Promo', 'Announcement', 'Teaser'] },
];

/** [slug, name, parentSlug, keyword aliases used for heuristic tagging] */
export const TOPICS: Array<[string, string, string | null, string[]]> = [
  ['relationships', 'Relationships', null, ['relationship', 'relationships', 'partner', 'boyfriend', 'girlfriend', 'husband', 'wife', 'situationship']],
  ['dating', 'Dating', 'relationships', ['dating', 'date', 'first date', 'talking stage', 'effort']],
  ['dating-with-clout', 'Dating with clout', 'dating', ['dating with clout', 'dating a celebrity', 'famous boyfriend']],
  ['cheating', 'Cheating', 'relationships', ['cheating', 'cheat', 'cheaters', 'cheated', 'side piece', 'infidelity']],
  ['exes', 'Exes', 'relationships', ['ex', 'exes', 'my ex', 'your ex', 'trust back']],
  ['communication', 'Communication', 'relationships', ['communication', 'communicating', 'communicate']],
  ['sex', 'Sex', null, ['sex', 'sexual', 'body count', 'bedroom', 'hookup', 'gangbang', 'kink']],
  ['gender-roles', 'Gender roles', null, ['men vs women', 'gender roles', 'provider', 'traditional', 'women say', 'men say']],
  ['money', 'Money', null, ['money', 'rich', 'broke', 'bills', 'pay', 'financial', 'credit score']],
  ['clout-fame', 'Clout & fame', null, ['clout', 'fame', 'famous', 'viral', 'going viral', 'celebrity status']],
  ['music-industry', 'Music industry', null, ['music', 'rapper', 'rappers', 'artist', 'label', 'deal', 'streaming', 'album', 'song']],
  ['social-media', 'Social media', null, ['social media', 'instagram', 'tiktok', 'followers', 'content creator', 'onlyfans']],
  ['creator-business', 'Creator business', 'social-media', ['marketing', 'brand deal', 'creator', 'business', 'content for fun']],
  ['beauty', 'Beauty', null, ['beauty', 'makeup', 'hair', 'nails', 'bbl', 'surgery', 'attractive']],
  ['friendships', 'Friendships', null, ['friend', 'friends', 'friendship', 'bestie', 'girls trip']],
  ['pop-culture', 'Pop culture & celebrities', null, ['nicki', 'lil kim', 'drake', 'joe budden', 'celebrity', 'nyfw']],
  ['nightlife', 'Nightlife & experiences', null, ['nightlife', 'lounge', 'club', 'brunch', 'restaurant', 'party', 'event']],
  ['honesty', 'Honesty & trust', null, ['honesty', 'honest', 'lie', 'lying', 'catfish', 'trust']],
];

export const BRAND_ALIASES = ['BBO', 'Bad Bitches Only', 'BBO Show', 'Bad Bitches Only Show', 'dabboshow', 'Da BBO Show'];

type AttrDef = {
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'enum';
  values?: string[];
  group: string;
  comparable?: boolean;
  description?: string;
};

export const ATTRIBUTE_DEFINITIONS: AttrDef[] = [
  // Structure — franchise lives on content.franchise_id, mirrored here so its provenance is tracked
  { key: 'franchise', label: 'Franchise', type: 'enum', group: 'structure', values: FRANCHISES.map((f) => f.slug) },
  { key: 'format', label: 'Format', type: 'enum', group: 'structure', values: ['reel', 'carousel', 'image', 'video', 'story', 'short'] },
  // Hook & opening
  { key: 'opening_hook', label: 'Opening hook', type: 'text', group: 'hook', comparable: false },
  { key: 'opening_transcript', label: 'Exact opening transcript', type: 'text', group: 'hook', comparable: false },
  // Controlled vocabulary: the AI must choose from these, so 40 near-synonyms
  // for the same hook never fragment the evidence.
  { key: 'hook_type', label: 'Hook type', type: 'enum', group: 'hook', values: ['confession', 'controversial_statement', 'direct_opinion', 'question', 'accusation', 'disagreement', 'surprising_fact', 'story_opening', 'challenge', 'emotional_statement', 'sexual_relationship_tension', 'status_clout_statement', 'humor', 'curiosity_gap', 'payoff_first', 'other'] },
  { key: 'opening_type', label: 'Opening type', type: 'enum', group: 'hook', values: ['interviewer_question', 'guest_answer', 'host_statement', 'reaction', 'argument_in_progress', 'text_first', 'visual_first', 'other'] },
  { key: 'guest_answer_opening', label: 'Opens on a guest answer', type: 'boolean', group: 'hook' },
  { key: 'opening_line', label: 'Exact opening line', type: 'text', group: 'hook', comparable: false },
  { key: 'time_to_understandable_s', label: 'Seconds until understandable', type: 'number', group: 'hook', comparable: false },
  { key: 'time_to_understandable_bucket', label: 'Time to understandable', type: 'enum', group: 'hook', values: ['0-2s', '2-5s', '5-8s', '>8s'] },
  { key: 'time_to_tension_s', label: 'Seconds until tension', type: 'number', group: 'hook', comparable: false },
  { key: 'time_to_tension_bucket', label: 'Time to tension', type: 'enum', group: 'hook', values: ['0-2s', '2-5s', '5-10s', '>10s', 'never'] },
  { key: 'time_to_payoff_s', label: 'Seconds until payoff', type: 'number', group: 'edit', comparable: false },
  { key: 'time_to_payoff_bucket', label: 'Time to payoff', type: 'enum', group: 'edit', values: ['0-5s', '5-15s', '15-30s', '>30s', 'never'] },
  { key: 'dead_setup_s', label: 'Dead setup seconds', type: 'number', group: 'edit', comparable: false },
  { key: 'dead_setup_bucket', label: 'Dead setup', type: 'enum', group: 'edit', values: ['none', '0-2s', '2-5s', '>5s'] },
  { key: 'clarity_rating', label: 'Clarity', type: 'enum', group: 'substance', values: ['immediate', 'quick', 'slow', 'unclear'] },
  { key: 'share_trigger_type', label: 'Share trigger', type: 'enum', group: 'substance', values: ['relatable', 'funny', 'shocking', 'informative', 'argument_ammo', 'aspirational', 'tag_a_friend', 'none', 'other'] },
  { key: 'comment_trigger_type', label: 'Comment trigger', type: 'enum', group: 'substance', values: ['take_a_side', 'personal_experience', 'disagreement', 'question_asked', 'tag_someone', 'defend_someone', 'none', 'other'] },
  { key: 'curiosity_trigger_type', label: 'Curiosity trigger', type: 'enum', group: 'substance', values: ['open_loop', 'withheld_payoff', 'surprising_claim', 'visual_question', 'none', 'other'] },
  { key: 'strongest_moment_quote', label: 'Strongest moment', type: 'text', group: 'substance', comparable: false },
  { key: 'strongest_opening_quote', label: 'Strongest possible opening', type: 'text', group: 'hook', comparable: false },
  { key: 'opening_is_strongest', label: 'Current opening is the strongest available', type: 'boolean', group: 'hook' },
  { key: 'opening_speaker_role', label: 'Speaker opening the clip', type: 'enum', group: 'hook', values: ['guest', 'host', 'interviewer', 'voiceover', 'none'] },
  { key: 'question_opening', label: 'Opens on a question', type: 'boolean', group: 'hook' },
  { key: 'payoff_first', label: 'Payoff-first opening', type: 'boolean', group: 'hook' },
  { key: 'opening_visual', label: 'Opening visual', type: 'enum', group: 'hook', values: ['hook_card', 'speaker_closeup', 'wide_panel', 'reaction_shot', 'b_roll', 'graphic', 'other'] },
  { key: 'text_hook', label: 'On-screen text hook', type: 'text', group: 'hook', comparable: false },
  { key: 'has_text_hook', label: 'Text hook on frame one', type: 'boolean', group: 'hook' },
  // Substance
  { key: 'underlying_debate', label: 'Underlying debate', type: 'text', group: 'substance', comparable: false },
  { key: 'emotional_trigger', label: 'Emotional trigger', type: 'enum', group: 'substance', values: ['outrage', 'recognition', 'humor', 'curiosity', 'desire', 'shock', 'validation', 'envy', 'other'] },
  { key: 'tension_type', label: 'Tension type', type: 'enum', group: 'substance', values: ['gender_conflict', 'moral_dilemma', 'disagreement', 'confession_stakes', 'status', 'exposure', 'none', 'other'] },
  { key: 'controversy_type', label: 'Controversy type', type: 'enum', group: 'substance', values: ['sexual', 'relationship_norms', 'gender_roles', 'money', 'music_industry', 'celebrity', 'none', 'other'] },
  { key: 'guest_gender_mix', label: 'Guest gender mix', type: 'enum', group: 'substance', values: ['female', 'male', 'mixed', 'none', 'unknown'] },
  // Edit
  { key: 'duration_bucket', label: 'Clip length', type: 'enum', group: 'edit', values: ['<=15s', '16-30s', '31-45s', '46-60s', '>60s'] },
  { key: 'editing_style', label: 'Editing style', type: 'enum', group: 'edit', values: ['podcast_panel_cut', 'split_screen_reaction', 'street_handheld', 'vo_recap', 'meme_card', 'static_graphic', 'carousel', 'other'] },
  { key: 'reaction_shot_present', label: 'Reaction shot present', type: 'boolean', group: 'edit' },
  { key: 'reaction_timing', label: 'Reaction timing', type: 'enum', group: 'edit', values: ['first_3s', '3_10s', 'later', 'none'] },
  { key: 'subtitle_style', label: 'Subtitle style', type: 'enum', group: 'edit', values: ['burned_captions', 'none', 'other'] },
  { key: 'integrated_lufs', label: 'Integrated loudness (LUFS)', type: 'number', group: 'edit', comparable: false },
  // Packaging
  { key: 'caption_type', label: 'Caption opening type', type: 'enum', group: 'packaging', values: ['question', 'claim_statement', 'quote', 'descriptive', 'list', 'other'] },
  { key: 'cta_type', label: 'CTA', type: 'enum', group: 'packaging', values: ['none', 'comment_specific', 'question_no_directive', 'generic', 'click_visit', 'share_tag'] },
  { key: 'hashtag_bucket', label: 'Hashtags', type: 'enum', group: 'packaging', values: ['0', '1-4', '5+'] },
  { key: 'has_guest_tag', label: 'Guest tagged in caption', type: 'boolean', group: 'packaging' },
  { key: 'has_location_tag', label: 'Location tagged in caption', type: 'boolean', group: 'packaging' },
  { key: 'caption_length_bucket', label: 'Caption length', type: 'enum', group: 'packaging', values: ['short', 'medium', 'long'] },
  // Timing
  { key: 'posting_daypart', label: 'Posting daypart (ET)', type: 'enum', group: 'timing', values: ['morning', 'afternoon', 'evening', 'late_night'] },
  { key: 'posting_day', label: 'Posting day (ET)', type: 'enum', group: 'timing', values: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] },
  // Audit V2 caption coding (imported from the weekly audit archive, lower confidence)
  { key: 'audit_lane', label: 'Audit lane', type: 'enum', group: 'audit', values: ['culture_humor_other', 'relationship_dating', 'bts_promo', 'bbo_stamped_venue', 'sex_explicit', 'creator_business', 'baddies_of_the_month'] },
  { key: 'identity_conflict', label: 'Identity conflict', type: 'boolean', group: 'audit' },
  { key: 'explicit_binary', label: 'Explicit binary', type: 'boolean', group: 'audit' },
  { key: 'humor_marker', label: 'Humor marker', type: 'boolean', group: 'audit' },
  { key: 'shock_marker', label: 'Shock marker', type: 'boolean', group: 'audit' },
  { key: 'confession_marker', label: 'Confession marker', type: 'boolean', group: 'audit' },
];

export type RulePattern = {
  key: string;
  group: string;
  compare?: string; // omitted = everything else
  metric: string;
  expected: 'higher' | 'lower';
  franchises?: string[];
};

export type SeedRule = {
  code: string;
  category: string;
  text: string;
  appliesTo: { workflows?: string[]; franchises?: string[]; platforms?: string[]; formats?: string[] };
  pattern?: RulePattern;
};

const ALL = ['*'];
const EDITING = ['viral_editor', 'gatekeeper', 'content_analysis'];
const PACKAGING = ['viral_editor', 'gatekeeper', 'caption', 'opportunity_brief'];

export const SEED_RULES: SeedRule[] = [
  { code: 'R-001', category: 'editing', text: 'Psychological chronology > recording chronology.', appliesTo: { workflows: EDITING } },
  { code: 'R-002', category: 'editing', text: 'Never assume the first recorded sentence should open.', appliesTo: { workflows: EDITING } },
  { code: 'R-003', category: 'analysis', text: 'Analyze complete available footage/transcript before determining the actual topic.', appliesTo: { workflows: ALL } },
  { code: 'R-004', category: 'analysis', text: 'Never infer video topic from filename alone.', appliesTo: { workflows: ALL } },
  { code: 'R-005', category: 'editing', text: 'Every short should contain identifiable tension.', appliesTo: { workflows: EDITING },
    pattern: { key: 'tension_type', group: 'none', metric: 'performance_score', expected: 'lower' } },
  { code: 'R-006', category: 'editing', text: 'Remove context viewers do not need.', appliesTo: { workflows: EDITING } },
  { code: 'R-007', category: 'editing', text: 'Payoff may appear before context.', appliesTo: { workflows: EDITING },
    pattern: { key: 'payoff_first', group: 'true', metric: 'retention_rel', expected: 'higher' } },
  { code: 'R-008', category: 'captions', text: 'BBO captions prioritize comments, debate, tagging and sharing over merely describing the clip.', appliesTo: { workflows: PACKAGING },
    pattern: { key: 'cta_type', group: 'none', metric: 'comment_rel', expected: 'lower' } },
  { code: 'R-009', category: 'packaging', text: 'Cross-platform packaging must be native to the destination platform rather than rewritten Instagram copy.', appliesTo: { workflows: PACKAGING } },
  { code: 'R-010', category: 'editing', text: 'Editing recommendations should identify the actual strongest opening when footage allows.', appliesTo: { workflows: EDITING } },
  { code: 'R-011', category: 'strategy', text: 'Comments, shares, retention, saves and follows may matter more than raw views depending on the content goal.', appliesTo: { workflows: ALL } },
  { code: 'R-012', category: 'governance', text: 'Permanent AI-generated rule changes require human approval.', appliesTo: { workflows: ALL } },
  { code: 'R-013', category: 'voice', text: 'Do not default to corny marketing language.', appliesTo: { workflows: PACKAGING } },
  { code: 'R-014', category: 'captions', text: 'Do not generate generic hashtag dumps.', appliesTo: { workflows: PACKAGING },
    pattern: { key: 'hashtag_bucket', group: '5+', compare: '0', metric: 'share_rel', expected: 'lower' } },
  { code: 'R-015', category: 'editing', text: 'Do not repeatedly open clips with interviewer questions when the guest answer can stand alone more powerfully.', appliesTo: { workflows: EDITING, franchises: ['podcast', 'street-interview', 'mirror-talk-sessions'] },
    pattern: { key: 'opening_speaker_role', group: 'interviewer', compare: 'guest', metric: 'performance_score', expected: 'lower' } },
];

export const DEFAULT_TRIGGERS = {
  // Deep analysis runs only on unusual outcomes.
  scoreHigh: 1.5,
  scoreLow: 0.5,
  componentHigh: 2.0, // shares / comments / retention ratio vs peer median
  retentionLow: 0.5,
  requireMature: true,
  maxPerRun: 8,
};

export const INTEGRATIONS = [
  {
    id: 'composio_instagram',
    name: 'Instagram (via Composio)',
    provider: 'composio',
    capabilities: ['content ingestion', 'per-post insights', 'comment text', 'account insights', 'follower demographics'],
    limitations: [
      'Per-Reel follows, profile visits, impressions, plays and replays are rejected by the Media Insights API.',
      '1s/2s/3s retention curves are not exposed; 3-second hold is derived as 100% − reels_skip_rate.',
      'Completion rate is not exposed; retention is derived as avg watch time ÷ measured duration.',
      'Reached/engaged audience demographics have returned empty results since 2026-08-30.',
      'Follower change is net daily only; no follows/unfollows split.',
    ],
  },
  { id: 'tiktok', name: 'TikTok', provider: 'composio', capabilities: [], limitations: ['No TikTok connected account in Composio.'] },
  { id: 'youtube', name: 'YouTube', provider: 'composio', capabilities: [], limitations: ['No YouTube connected account in Composio.'] },
  { id: 'google_drive', name: 'Google Drive (raw footage)', provider: 'composio', capabilities: [], limitations: ['No Google Drive connected account in Composio.'] },
  { id: 'whisper_local', name: 'Local transcription (whisper.cpp)', provider: 'local', capabilities: ['transcripts with timestamps from downloaded Reels'], limitations: ['English base model; speaker names are not identified.'] },
  { id: 'gemini', name: 'Gemini (AI analysis)', provider: 'google', capabilities: ['structured analysis', 'gatekeeper', 'reviews', 'Ask BBO explanations'], limitations: [] },
  { id: 'audit_archive', name: 'Weekly audit archive', provider: 'local', capabilities: ['historical metric snapshots 2026-05-11 onward', 'audit V2 caption coding', 'imported learnings'], limitations: ['Snapshots are point-in-time pulls from past audits, not continuous history.'] },
];
