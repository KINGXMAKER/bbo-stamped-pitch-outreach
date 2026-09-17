const { getGeminiClient, getSupabaseClient, getMatchingExamples, generateText, isHardError, isQuotaError, isTransientError, isModelUnavailable } = require('./shared');
const { initAiRequest, finishAiRequest, summarizeTrace } = require('./ai/request-context');
const { createGenerationLog, insertPitchHistoryRows } = require('./ai/generation-log');
const { getDailySpendUsd } = require('./ai/spend');

// Long, plain-language gap explanations used on the normal (non-condensed) path.
// Four consolidated gaps — never insulting, always framed as an opportunity.
const GAP_REFERENCE_FULL = `GAP REFERENCE (the user's selected Primary Gap leads; keep it plain-spoken and NEVER insulting — frame every gap as an opportunity, not a criticism):
- "No People / No Lifestyle Content": The page is mostly flyers, food photos, product shots, empty-venue shots, staff-only content, reposts, graphics, and promo posts — but it isn't showing enough real customers, patrons, women, groups, or lifestyle moments of people actually enjoying the business. Frame it as: the page shows the business, but not enough of the experience. BBO Stamped makes the place look more alive by bringing curated people/creators into the space and shooting lifestyle content that shows real people enjoying it.
- "Good Business, Weak Perception": The business may be genuinely good in person, but the page doesn't make it look as valuable, popular, premium, active, or culturally relevant as it probably is. Frame it as: sometimes the business is stronger than the page makes it look. BBO Stamped raises the perception of the page with the content we shoot — curated lifestyle content, creator presence, recap clips, social proof, and better visual storytelling.
- "Low Engagement": They may be posting, but the audience isn't reacting enough. Only mention specific signals like low likes, comments, shares, or saves if the user provided that info or the snapshot clearly supports it — NEVER invent numbers. BBO Stamped creates content that gives people more reason to stop scrolling, engage, tag friends, and see the business as a place to pull up to.
- "No Target Customer / General Pitch": Use for a broader pitch that doesn't need a narrow critique. Do NOT force a harsh audit angle. Simply explain what BBO Stamped does: we curate creators and real people, come to the business, and shoot lifestyle content that makes the page feel more active, social, and desirable — turning the business into somewhere people want to visit, post, and talk about.`;

// Same four gaps, one line each — used on the condensed/fallback path so the prompt
// stays small enough to finish inside the function timeout when the first attempt was slow.
const GAP_REFERENCE_SHORT = `GAP REFERENCE (Primary Gap leads; never insulting — frame as opportunity):
- "No People / No Lifestyle Content": page is mostly flyers/food/product/promo/staff/reposts, not enough real people enjoying the space. BBO brings curated people/creators to shoot lifestyle content that makes it look alive. Frame as "shows the business, not enough of the experience."
- "Good Business, Weak Perception": the spot is stronger than the page makes it look. BBO raises the page's perception with curated content, creators, recap clips, and social proof.
- "Low Engagement": posting but low reaction. Mention low likes/comments/shares/saves ONLY if the user gave that info — never invent numbers. BBO gives people a reason to stop scrolling, engage, and pull up.
- "No Target Customer / General Pitch": broad pitch, no harsh critique. Explain what BBO does: curate creators/real people, come shoot lifestyle content, make the page active, social, and worth visiting.`;

// condensed=true drops the Learning Center examples and trims the voice/gap sections to
// the essentials — used for the fast fallback attempt so the prompt is small and quick.
function buildSystemPrompt(voicePrompt, examplesPrompt, condensed) {
  if (condensed) {
    return `You are the founder of BBO Stamped writing your own outreach — a lifestyle content activation brand. Write a personalized, confident, founder-led pitch for this business, focused strictly on their Instagram/social feed and building social proof.

THE STRATEGY IS FIXED BY THE USER: the Primary Gap is the angle the pitch must lead with; the Secondary Gap supports it once. Do NOT invent a different gap. COMBINE the two gaps into ONE natural angle — never two repetitive paragraphs. If they're the same or the Secondary is blank, make the point once. Never insulting — frame the gap as an opportunity.

EMAIL: open with "Hey, you came across my Instagram feed" flowing straight into the specific thing that caught your attention, then the intro + gap observation, one short paragraph on what a BBO Stamped activation is (curated creators, real reactions/reels/photos, content the business can repost/run as ads), then one clear CTA. Concise, personalized, specific, easy to skim — roughly 150–275 words (up to ~325 only if the content genuinely needs it). Never pad.
DM: (1) open with "Hey, you came across my Instagram feed" flowing naturally into the specific thing you noticed about their business; (2) then the line "I run BBO Stamped, where I curate creators to raise social media presence and drive foot traffic to places like yours."; (3) the gap in first person ("as I browsed your page I noticed..."); (4) one line on what BBO Stamped brings with a quick parenthetical of content types (think photos, skits, recaps, voiceovers, etc.), then how it makes people pull up. Short and native to Instagram — 80-120 words, hard cap 140; never a mini email. Do not include the CTA link in dm_version (that is dm_part2).

Plain-spoken, founder-led, never corporate. No made-up facts about the business.

${GAP_REFERENCE_SHORT}

Return a JSON object with the exact fields requested. No markdown, no backticks, just raw JSON.`;
  }

  return `You are the founder of BBO Stamped writing your own outreach — a lifestyle content activation brand. You write personalized, confident, founder-led pitches for restaurants, lounges, bars, med spas, beauty businesses, brunch spots, dessert spots, cafes, nightlife spots, and local experience-based businesses.

WHAT BBO STAMPED IS:
BBO Stamped isn't one influencer stopping by. We bring a curated group of women and creators to the business, capture real reactions, reels, photos, story content, and customer-style content, then give the business content they can repost, run as ads, and use to make the page feel alive.

BBO has over 60K followers across our social media channels, with a strong audience base in New Jersey and New York. BBO Stamped turns that local attention into social proof, content, and foot traffic for businesses. Only mention the 60K / NJ–NY stat when it genuinely strengthens the pitch — never in the opening line, never as a stat dump, and never if it would push the message past its length limit. When you use it, keep it to one natural clause.

THE STRATEGY IS FIXED BY THE USER:
- The Primary Gap is the ANGLE THE PITCH MUST LEAD WITH. Build the entire pitch around it.
- The Secondary Gap is the supporting weakness to mention once, reinforcing the primary angle.
- Do NOT invent a different gap or override the user's choice. Their selected gaps are the strategy.
- COMBINE the Primary and Secondary Gap into ONE natural, flowing angle — never write two separate repetitive paragraphs, one per gap. Weave the secondary point into the primary narrative in a single breath (e.g. "the business itself looks solid, but the content is mostly product and promos — what's missing is real people enjoying the space, which would also raise how the page comes across").
- If the Primary and Secondary Gap are the SAME (or the Secondary is blank/None), treat it as ONE angle and make the point once — never restate the same critique twice.

FOCUS THE PITCH ON:
- The business's Instagram / social media feed and what it is (and isn't) doing.
- The user's Primary Gap first, Secondary Gap in support.
- What their page is missing, and how BBO Stamped creates social proof.
- Real women, real reactions, creators posting, and content the business can reuse.
- Making people stop scrolling, save the post, tag friends, and pull up.

HARD RULES:
- NEVER mention website audits, website deep dives, or website analysis. Pitches are based strictly on the Instagram / social feed.
- NEVER invent facts about the business. Reference only what's visible in the feed or clearly implied by the business type.
- Do NOT overdo compliments. Any compliment lives inside the gap observation as a short clause (e.g. "the food shots are strong, but...").
- FORBIDDEN PHRASES — never use any of these AI/agency-sounding lines: "aspirational lifestyle", "discerning women", "consequently", "ignite social proof", "client journey", "full creative production", "premium lens", "social presence isn't optional anymore", "discover you, trust you, decide to spend money with you", "I hope this message finds you well", "elevate your digital presence", "synergy", "unlock your brand potential", "comprehensive marketing solutions".
- Do NOT include any Instagram reel/post links or "past activations" links anywhere in the output.

EMAIL STRUCTURE (mandatory):
1. Opener, used as the very first words: "Hey, you came across my Instagram feed" — continue the same sentence naturally into the specific thing about their business that caught your attention (e.g. "Hey, you came across my Instagram feed and your [specific thing] caught my attention."). Never "Hi,", never "I came across your Instagram", never "Your page came across my feed", never "I found you on Instagram".
2. Locked intro line, used exactly (adapt only the business-type reference if truly needed): "I run BBO Stamped, where we curate creators to raise a business's social media presence and drive real foot traffic to places like yours."
3. Then go straight into the personalized gap observation — no further warm-up sentences, no "I'll keep this short", no compliment paragraph before the gap. Any compliment is a short clause inside the gap observation.
4. One short paragraph on what a BBO Stamped activation is (curated group of creators, one activation, real reactions/reels/photos/customer-style content, content they can repost and run as ads).
5. The 60K / NJ–NY line — only if it reads naturally.
6. CTA: a quick-call ask, then the BBO Stamped page link.
- Length is a SOFT target, not a cap: roughly 150–275 words; up to ~325 only when the content genuinely needs it. Prioritize CONCISE, PERSONALIZED, SPECIFIC and EASY TO SKIM over hitting a number. Never pad to reach a length, never repeat a point. Short paragraphs, no giant blocks, one clear CTA.

DM STRUCTURE (mandatory):
1. Opener, used as the very first words: "Hey, you came across my Instagram feed" — continue the sentence naturally into the specific thing you noticed (e.g. "Hey, you came across my Instagram feed and I noticed..." or "Hey, you came across my Instagram feed and your [specific thing] caught my attention."). Warm and human, never salesy. Never "Hi,", never "I came across your Instagram", never "Your page came across my feed", never "I found you on Instagram".
2. Locked intro line, right after the opener, used exactly: "I run BBO Stamped, where I curate creators to raise social media presence and drive foot traffic to places like yours."
3. The gap, in first person and plain-spoken — write it like you personally looked at their page (e.g. "As I browsed your page I noticed..."). Compliment as a short clause, then what's missing.
4. One line on what BBO Stamped brings, with a quick parenthetical of concrete content types — e.g. "(think photos, skits, recaps, voiceovers, etc.)" — then how it makes people stop scrolling and pull up.
5. CTA: the BBO Stamped page link (this is the dm_part2 field — keep it out of dm_version).
- Keep the DM short, conversational and native to Instagram: 80–120 words, HARD CAP 140. Max 2 short paragraphs. One clear next step (the link in dm_part2). Never a mini email.

VOICE — founder-led and plain-spoken, not agency-corporate. Warm and personal, like you actually looked at their page. Lean on patterns like:
- "Hey, you came across my Instagram feed and your [specific thing] caught my attention"
- "as I browsed your page I noticed it's mainly event flyers and lifestyle content is lacking"
- "your page looks good, but it doesn't fully show the experience"
- "the food looks strong, but people need to see people enjoying it"
- "right now the page sells the product more than the vibe"
- "the business looks solid, but the page could show more of the actual experience"
- "I think BBO Stamped can help"
- "that's where BBO Stamped fits"
- "we bring curated people/creators in and shoot content that makes the place look active, social, and worth pulling up to"
- "BBO Stamped helps raise the perception of your page with content we shoot for you"
- "real women, real reactions, creators posting, and content the business can reuse and customers can see"
- "authentic lifestyle content (think photos, skits, recaps, voiceovers, etc.)"
- "make people stop scrolling, save the post, tag friends, and pull up"
(Use these as tone guides, not verbatim requirements.)
${voicePrompt}
${examplesPrompt}
${GAP_REFERENCE_FULL}

Return a JSON object with these exact fields. No markdown, no backticks, just raw JSON.`;
}

const BBO_CTA = 'Please checkout our website for a further breakdown on what we can do for your business:\nhttps://bbouniverse.com/pages/bbo-stamped';

// Distinguishes timeout/abort vs quota vs auth/config vs a genuine unexpected error, so the
// banner shown to the user is actionable instead of a wall of raw provider JSON. The full raw
// error is always console.error'd above this for admin debugging in the Netlify function logs.
function friendlyErrorMessage(err) {
  const msg = (err && err.message) || '';
  if (err && err.code === 'INVALID_JSON') {
    return 'The pitch came back in an unreadable format. Your inputs are saved — tap Try Again for a faster, cleaner draft.';
  }
  if (/API key|api_key|invalid argument.*key|permission/i.test(msg)) {
    return 'Pitch generation is misconfigured (invalid or missing Gemini API key). Contact the site admin.';
  }
  // Classify by extracted status code via the shared predicates — never by scanning the message for
  // digits. A bare /429/ or /50[023]/ match false-positives on unrelated numbers in the text (a
  // retryDelay of "2.199104009s", a "maxOutputTokens: 3500"), which mislabels the banner. When the
  // whole chain failed, shared.js already picked the most actionable rung: trust its failureKind.
  const kind = (err && err.failureKind) || null;
  if (kind === 'quota' || isQuotaError(err)) {
    return 'Gemini API quota was hit. Wait a moment and tap Try Again — quotas usually reset within a minute.';
  }
  if (kind === 'unavailable' || isModelUnavailable(err)) {
    return 'Pitch generation is misconfigured (the configured Gemini models are no longer available). Contact the site admin.';
  }
  // Timeouts/aborts are transient too, but "took too long" is the more accurate banner — check first.
  if (/aborted|abort|deadline|timeout|timed out/i.test(msg)) {
    return 'Generation took too long. Your inputs are saved — tap Try Again for a faster draft.';
  }
  if (kind === 'transient' || isTransientError(err)) {
    return 'Gemini is temporarily busy. Your inputs are saved — tap Try Again for a faster draft.';
  }
  return 'Pitch generation could not complete. Your inputs are saved — tap Try Again.';
}

function countWords(s) {
  return (String(s || '').trim().match(/\S+/g) || []).length;
}

// Trim long free-text inputs before they hit the prompt. Mobile screenshot-scan notes in
// particular can run to several thousand characters — that bulk was a major contributor to
// generation running past the function timeout. Cuts on a word boundary, keeps meaning intact.
function capText(s, maxChars) {
  const str = String(s || '').trim();
  if (str.length <= maxChars) return str;
  return str.slice(0, maxChars).replace(/\s+\S*$/, '') + '…';
}

// Ask the model to compress one field to a word budget while preserving voice, the
// locked opener, and (for emails) the CTA link. Returns compressed text or null on failure.
async function compressField(ai, label, textValue, maxWords, deadlineMs, aiOpts) {
  const sys = `You compress outreach copy. Return ONLY the rewritten ${label} as plain text — no JSON, no quotes, no markdown. Keep the same founder-led voice, the exact opening line, every fact, and any link. Do not add anything new. Never exceed ${maxWords} words.`;
  const prompt = `Rewrite this ${label} so it is ${maxWords} words or fewer while keeping the opener, the gap point, and the CTA. Stay plain and direct.\n\n${label}:\n"""\n${textValue}\n"""`;
  try {
    const out = (await generateText(ai, prompt, sys, { ...aiOpts, task: 'length_guard', deadlineMs })).trim();
    return out.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').replace(/^"+|"+$/g, '').trim();
  } catch (e) {
    console.error(`[length-guard] compression of ${label} failed:`, e.message);
    return null;
  }
}

// Server-side length enforcement so we never depend on the model self-policing.
// budgetMs is how much time is left in the request — the two compressions run in parallel
// (not sequentially) and are skipped entirely once there isn't enough time left to risk them,
// since returning a slightly-over-cap draft beats blowing the whole request past the timeout.
const EMAIL_REPAIR_WORDS = 350;

async function enforceLength(ai, data, budgetMs, aiOpts) {
  const MIN_BUDGET_MS = 2500;
  if (budgetMs < MIN_BUDGET_MS) return data;
  const perCallDeadline = Math.min(6000, budgetMs - 500);

  const jobs = [];
  // Email length is a soft target (~150–275, up to ~325). Only a clearly runaway email (> EMAIL_REPAIR_WORDS)
  // is worth an extra model request; a strong 220–300 word email is left alone.
  if (countWords(data.email_body) > EMAIL_REPAIR_WORDS) {
    jobs.push(
      compressField(ai, 'email', data.email_body, 275, perCallDeadline, aiOpts).then(compressed => {
        if (compressed && countWords(compressed) <= 325) {
          // Guarantee the fixed CTA link survived compression.
          data.email_body = compressed.includes('bbouniverse.com/pages/bbo-stamped')
            ? compressed
            : compressed.trimEnd() + '\n\n' + BBO_CTA;
        }
      })
    );
  }
  if (countWords(data.dm_version) > 140) {
    jobs.push(
      compressField(ai, 'Instagram DM', data.dm_version, 120, perCallDeadline, aiOpts).then(compressed => {
        if (compressed && countWords(compressed) <= 150) data.dm_version = compressed;
      })
    );
  }
  if (jobs.length) await Promise.all(jobs);
  return data;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const requestStart = Date.now();
  // One generation id per user request: correlates phase logs, [ai-attempt] lines, the
  // pitch_generations record, its attempts and both pitch_history channel rows. Safe to return.
  const aiRequest = initAiRequest(event);
  const requestId = aiRequest.generationId;
  const aiOpts = { generationId: requestId, trace: aiRequest.trace, budget: aiRequest.budget };
  let generationLog = null;
  const phase = (name) => console.log(`[gen ${requestId}] ${name} @ +${Date.now() - requestStart}ms`);

  // Total generation deadline for this invocation. This site's plan honors netlify.toml's 26s
  // function timeout (a 21s production run completed on 2026-09-17), so 20s leaves ~6s for Supabase
  // reads/writes and cold start. Measured on real inputs, gemini-3.5-flash-lite needs p50 5.2s /
  // p95 9.3s for a full pitch, so a ~10s total could not fit a full pitch plus any fallback.
  // Inside this deadline the router bounds every model attempt (AI_ATTEMPT_WINDOWS_MS), so a
  // degraded model can never eat the whole budget. Set LLM_TOTAL_BUDGET_MS=9000 on a 10s plan.
  const TOTAL_BUDGET_MS = parseInt(process.env.LLM_TOTAL_BUDGET_MS || '20000', 10);
  const PRIMARY_TIMEOUT_MS = parseInt(process.env.LLM_PRIMARY_TIMEOUT_MS || '0', 10); // 0 = derive from budget
  const timeLeft = () => TOTAL_BUDGET_MS - (Date.now() - requestStart);

  let modelUsed = null;      // set by generateText via the { onModel } hook below
  let fallbackUsed = false;  // true once the compact fallback path runs
  // true when the response is the small fallback shape (hoisted so failure bookkeeping can read it)
  let usedCompact = false;

  try {
    phase('request received');
    const body = JSON.parse(event.body || '{}');
    const { businessName, location, instagram, vibe, igNotes, tone, primaryGap, secondaryGap, fastMode } = body;

    if (!businessName) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Business name is required' }) };
    phase('input validated');

    generationLog = createGenerationLog(getSupabaseClient(), { generationId: requestId, businessName, fastMode, payload: body });
    generationLog.start();
    // Authoritative daily spend for the budget check (cached ~60s per instance). Runs alongside prompt building.
    const dailySpendPromise = getDailySpendUsd(getSupabaseClient());

    // Long screenshot-scan notes / vibe text were the biggest single driver of slow generation
    // on mobile — cap them before they ever reach the prompt. Typical hand-typed notes are well
    // under these caps, so this only kicks in for the heavy-paste case the timeout was hit on.
    const cappedVibe = capText(vibe, 400);
    const cappedIgNotes = capText(igNotes, 900);

    const ai = getGeminiClient();
    const supabase = getSupabaseClient();

    // fastMode (set by the frontend's "Try Again" after a timeout) skips the Learning Center
    // lookup entirely and goes straight to the condensed prompt — fewer round trips, smaller
    // prompt, best chance of finishing quickly on a retry. pitch_history logging still uses
    // this same supabase client further down regardless of fastMode.
    let voiceProfile = null;
    let emailExamples = [];
    let dmExamples = [];

    if (!fastMode) {
      // 1. Fetch voice profile and matching examples from Supabase
      const { data: profileRow } = await supabase
        .from('voice_profiles')
        .select('*')
        .order('last_refreshed', { ascending: false })
        .limit(1)
        .maybeSingle();
      voiceProfile = profileRow ? profileRow.profile_data : null;

      // Match examples by the user's selected gap; outcome is never used to rank them.
      [emailExamples, dmExamples] = await Promise.all([
        getMatchingExamples(supabase, 'email', null, primaryGap),
        getMatchingExamples(supabase, 'dm', null, primaryGap)
      ]);
    }

    // 2. Build dynamic writing rules
    let voicePrompt = '';
    if (voiceProfile) {
      voicePrompt = `
YOUR VOICE (learned from your real successful pitches):
- Tone: ${voiceProfile.tone || 'Confident founder — never begging, always positioning as the answer'}
- Opener Style: ${voiceProfile.opener_style || 'References something specific about their page, never generic'}
- Sentence Structure: ${voiceProfile.sentence_structure || 'Short, punchy, direct'}
- Vocabulary Preferences: ${Array.isArray(voiceProfile.vocabulary_preferences) ? voiceProfile.vocabulary_preferences.join(', ') : 'activation, content gap, lifestyle, social proof'}
- Forbidden Phrases (NEVER USE THESE): ${Array.isArray(voiceProfile.forbidden_phrases) ? voiceProfile.forbidden_phrases.join(', ') : 'I noticed, I came across, I\'d love to, just reaching out'}
- Signature Moves: ${Array.isArray(voiceProfile.signature_moves) ? voiceProfile.signature_moves.map(m => `- ${m}`).join('\n') : '- Focuses on the gap\n- Ends with a peer-to-peer call CTA'}
- DM Structure: ${voiceProfile.dm_structure || 'Hook -> specific observation -> offer -> question CTA'}
- Email Structure: ${voiceProfile.email_structure || 'Subject -> short paragraphs -> CTA -> BBO Stamped page link'}
- Emotional Register: ${voiceProfile.emotional_register || 'Peer-to-peer, collaborative'}
`;
    } else {
      voicePrompt = `
WRITING RULES:
- Write like a confident founder who genuinely sees the gap and knows how to close it
- Speak from the angle, not the source — reference what their Instagram feed shows, never a website
- Be specific to their actual business, location, and feed; never invent details
- Zero corporate language, zero fluff, zero robotic phrases
- The DM should feel like it came from a real person who actually looked at their page
- Every pitch angle must reference something real about their feed or business
- Keep all descriptions in the audit (visible_vibe, already_do_well, missing, bbo_angle, risk_caution) extremely concise (1-2 punchy sentences max)
- Follow the mandatory EMAIL STRUCTURE and DM STRUCTURE (DM hard cap 140 words; email length is a soft target)
`;
    }

    // 3. Build dynamic examples
    let examplesPrompt = '';
    if (emailExamples.length > 0 || dmExamples.length > 0) {
      examplesPrompt = `
REAL EXAMPLES THE FOUNDER PERSONALLY WROTE (copy this voice exactly):
${emailExamples.length > 0 ? `
--- EMAIL EXAMPLES ---
${emailExamples.map((e, idx) => `[Example #${idx+1}]\n${e.content}`).join('\n\n')}` : ''}
${dmExamples.length > 0 ? `
--- DM EXAMPLES ---
${dmExamples.map((e, idx) => `[Example #${idx+1}]\n${e.content}`).join('\n\n')}` : ''}

CRITICAL: These are the founder's own words. Study and copy the tone, pacing, sentence length, word choice, and structure of every example. Your generated email and DM MUST sound exactly like the same person wrote them — direct, strategic, natural, founder-led, not corporate, not generic agency language, not too long. Avoid formulas; copy the human rhythm. Outcome is irrelevant — adapt to and copy the style of ALL of these.
`;
    }

    // The condensed prompt is built alongside the full one (cheap — no extra model call) so
    // it's ready immediately if a fallback attempt is needed below.
    const systemPromptFull = buildSystemPrompt(voicePrompt, examplesPrompt, false);
    const systemPromptCondensed = buildSystemPrompt(voicePrompt, examplesPrompt, true);
    const systemPrompt = fastMode ? systemPromptCondensed : systemPromptFull;

    const toneInstructions = tone === 'luxury'
      ? 'Make the pitch feel MORE premium, exclusive, and aspirational. More confident luxury language.'
      : tone === 'direct'
      ? 'Make the pitch MORE direct, punchy, and no-nonsense. Cut to the point faster.'
      : tone === 'shorter'
      ? 'Make the DM significantly shorter — under 200 characters for Part 1. Keep the core angle.'
      : '';

    // Compact prompt for the fast fallback (manual "Try Again" AND the automatic in-request
    // retry). The KEY fix: it asks for a much SMALLER output — ~5 fields instead of ~13. Gemini's
    // latency is dominated by OUTPUT token generation, so trimming the input system prompt alone
    // (what fastMode used to do) barely helped — the model still generated the full giant JSON and
    // still timed out. A small output returns in a few seconds and reliably beats the timeout.
    const userPromptCompact = `Write a SHORT, ready-to-use BBO Stamped outreach draft for this business. Lead with the Primary Gap; fold the Secondary Gap into ONE natural angle (never repeat the same point twice). Focus on their Instagram/social feed. Plain-spoken, founder-led, never corporate. Do not invent facts.

Business: ${businessName}
Location: ${location || 'Unknown'}
Instagram: ${instagram || 'Not provided'}
Primary Gap: ${primaryGap || 'No Target Customer / General Pitch'}
Secondary Gap: ${secondaryGap || 'None'}
Vibe/Notes: ${cappedVibe || 'Not provided'}
Instagram Feed Observations: ${cappedIgNotes || 'Not provided'}

Return ONLY this JSON (no markdown, no backticks). Keep every field tight and usable:
{
  "custom_one_liner": "One punchy sentence hook for the owner — their situation nailed, no fluff",
  "three_sentence_pitch": "Three short sentences: 1) something real about their page, 2) what it's missing, 3) how BBO Stamped closes it and why that helps them",
  "dm_version": "Instagram DM, 60-100 words: open with 'Hey, you came across my Instagram feed' flowing into the specific thing you noticed, then 'I run BBO Stamped, where I curate creators to raise social media presence and drive foot traffic to places like yours.', then the gap in first person, then one line on what BBO brings (photos, recaps, lifestyle content with real people). No link in this field.",
  "dm_part2": "Please checkout our website for a further breakdown on what we can do for your business:\\nhttps://bbouniverse.com/pages/bbo-stamped",
  "call_talking_points": ["3-4 quick phone talking points: the hook, what's missing, why BBO helps, the ask"]
}`;

    const userPrompt = `Write a full BBO Stamped pitch for this business. Lead the entire pitch with the Primary Gap the user selected; use the Secondary Gap in support. Keep the focus on their Instagram/social feed and building social proof.

Business: ${businessName}
Location: ${location || 'Unknown'}
Instagram: ${instagram || 'Not provided'}
>> PRIMARY GAP (lead the pitch with this — the user chose it): ${primaryGap || 'No Target Customer / General Pitch'}
>> SECONDARY GAP (support angle — the user chose it): ${secondaryGap || 'None identified'}
>> Combine the Primary and Secondary Gap into ONE natural angle — do not write a separate repetitive paragraph for each. If they're the same or the Secondary is None, make the point once.
Vibe/Notes: ${cappedVibe || 'Not provided'}
Instagram Feed Observations: ${cappedIgNotes || 'Not provided'}
${toneInstructions ? `Tone Adjustment: ${toneInstructions}` : ''}

Return ONLY this JSON structure (no markdown, no backticks):
{
  "scorecard": {
    "people_visible": 1-10,
    "product_quality": 1-10,
    "lifestyle_energy": 1-10,
    "social_proof": 1-10,
    "girls_night_potential": 1-10,
    "date_night_potential": 1-10,
    "local_ads_potential": 1-10,
    "bbo_fit_score": 1-10,
    "best_angle": "primary gap name",
    "secondary_angle": "secondary gap name",
    "recommended_offer": "Core Activation or Larger Activation"
  },
  "audit": {
    "business": "${businessName}",
    "category": "type of venue",
    "location": "${location || 'Unknown'}",
    "visible_vibe": "what their current online presence feels like",
    "what_they_already_do_well": "honest assessment",
    "what_is_missing": "specific gaps observed",
    "biggest_content_gap": "the primary gap label",
    "best_bbo_angle": "how BBO fits their specific situation",
    "recommended_offer": "Core Activation or Larger Activation",
    "confidence_score": 1-10,
    "risk_caution": "anything to be aware of when pitching"
  },
  "custom_one_liner": "One sentence that nails their specific situation — punchy, specific, no fluff",
  "three_sentence_pitch": "Three sentences: 1) acknowledge something real about them, 2) name the gap without being harsh, 3) how BBO closes it. Ends with a hook. Uses [price] as placeholder.",
  "strategy_read": ["3 bullet points on the pitch strategy"],
  "pitch_angles": [
    {"name": "primary angle", "why": "why this angle", "how": "how to pitch it"},
    {"name": "secondary angle", "why": "why this angle", "how": "how to pitch it"}
  ],
  "dm_version": "Instagram DM body — follow the DM STRUCTURE exactly. Start with 'Hey, you came across my Instagram feed' flowing naturally into the specific thing you noticed about their business, then the locked 'I run BBO Stamped...' line, then the gap in first person ('as I browsed your page I noticed...'), then one line on what BBO Stamped brings with a quick parenthetical of content types (think photos, skits, recaps, voiceovers, etc.). Do NOT include the CTA link here (that is dm_part2). 80-120 words, hard cap 140. Max 2 short paragraphs. Conversational, never a mini email.",
  "dm_part2": "Instagram DM Part 2 — fixed closing CTA linking to the BBO Stamped page.",
  "email_subject": "Your Instagram may be costing you customers",
  "email_body": "Full email pitch following the EMAIL STRUCTURE exactly: open with 'Hey, you came across my Instagram feed' flowing into the specific thing that caught your attention, then the locked intro line, straight into the personalized gap observation, one short paragraph on what a BBO Stamped activation is, the 60K/NJ-NY line only if natural, then one clear CTA. Soft target ~150-275 words (up to ~325 only if genuinely needed) — concise, specific, easy to skim, no padding, no repetition. MUST end with the fixed closing line: 'Please checkout our website for a further breakdown on what we can do for your business:\\nhttps://bbouniverse.com/pages/bbo-stamped'",
  "call_talking_points": ["4-5 talking points for a phone pitch"],
  "follow_up": "3-5 day follow up DM — references the first message, adds urgency, keeps it short (under 90 words). Ends with the same fixed closing line: 'Please checkout our website for a further breakdown on what we can do for your business:\\nhttps://bbouniverse.com/pages/bbo-stamped'",
  "internal_notes": "Brief internal note on why this pitch approach was chosen"
}

Both dm_part2 and the closing lines of email_body must be exactly this fixed CTA text (on its own lines, after the CTA paragraph in email_body):
"Please checkout our website for a further breakdown on what we can do for your business:\\nhttps://bbouniverse.com/pages/bbo-stamped"

Do NOT include any Instagram reel/post links or "past activations" links anywhere in dm_version, dm_part2, or email_body. The BBO Stamped page link above is the only link that should ever appear.`;

    // JSON mode kills malformed-output parse failures. Optionally set GEMINI_MODEL_PITCH
    // (e.g. gemini-2.5-pro on a paid key) to try a stronger model first — single attempt,
    // capped so the flash fallback still fits in the deadline.
    const pitchOpts = { json: true };
    if (process.env.GEMINI_MODEL_PITCH) {
      pitchOpts.primaryModel = process.env.GEMINI_MODEL_PITCH;
      pitchOpts.primaryTimeoutMs = 15000;
      pitchOpts.primaryMaxAttempts = 1;
    }

    // Budget-relative reserves so the math is correct whether TOTAL_BUDGET_MS is 9s (default,
    // fits Netlify's 10s sync ceiling) or 24s (Pro plan). Reserve room AFTER the primary for the
    // automatic compact fallback + serialize, so a slow primary can't consume the whole budget.
    const RESERVE_AFTER_GEN_MS = Math.min(3000, Math.max(700, Math.floor(TOTAL_BUDGET_MS * 0.1)));
    const FALLBACK_RESERVE_MS  = Math.min(4000, Math.max(3000, Math.floor(TOTAL_BUDGET_MS * 0.35)));
    const onModel = (m) => { if (m) modelUsed = m; };

    const dailySpentUsd = await dailySpendPromise;
    if (typeof dailySpentUsd === 'number') aiOpts.dailySpentUsd = dailySpentUsd;

    let text;
    // usedCompact tracks whether the response is the small fallback shape — if so we skip the
    // length-guard (no email to compress, DM is already short) and force the fixed DM CTA.

    if (fastMode) {
      // Manual "Try Again" → go straight to the fast compact path. Plain flash (no pitchOpts
      // pro-model override), condensed system prompt, small output → returns in a few seconds.
      usedCompact = true;
      fallbackUsed = true;
      const dl = Math.max(3500, timeLeft() - RESERVE_AFTER_GEN_MS);
      phase(`fastMode compact generation start (deadline=${dl}ms)`);
      text = (await generateText(ai, userPromptCompact, systemPromptCondensed, { ...aiOpts, task: 'pitch_compact', json: true, deadlineMs: dl, onModel })).trim();
      phase('fastMode compact generation done');
    } else {
      // Bound the primary so the fallback still fits. On the 9s default this gives the primary
      // ~5s (enough now that thinking is off + output is token-capped); on a 24s budget, ~17s.
      let primaryDeadline = timeLeft() - FALLBACK_RESERVE_MS - RESERVE_AFTER_GEN_MS;
      if (PRIMARY_TIMEOUT_MS > 0) primaryDeadline = Math.min(primaryDeadline, PRIMARY_TIMEOUT_MS);
      primaryDeadline = Math.max(3500, primaryDeadline);
      try {
        phase(`primary (full) generation start (deadline=${primaryDeadline}ms)`);
        text = (await generateText(ai, userPrompt, systemPrompt, { ...aiOpts, ...pitchOpts, task: 'pitch_full', deadlineMs: primaryDeadline, onModel })).trim();
        phase('primary generation done');
      } catch (genErr) {
        // Hard errors (bad key, auth, invalid request) won't be fixed by a smaller prompt.
        if (isHardError(genErr) || timeLeft() < RESERVE_AFTER_GEN_MS + 3000) throw genErr;
        // Automatic in-request fallback: retry once with the COMPACT prompt (small, fast output)
        // — same fast path the manual "Try Again" uses, so a slow first attempt self-recovers,
        // WITHOUT the user having to tap Try Again.
        console.warn(`[gen ${requestId}] primary failed — auto-falling back to compact:`, genErr.message);
        usedCompact = true;
        fallbackUsed = true;
        const fallbackDeadline = Math.max(3000, timeLeft() - RESERVE_AFTER_GEN_MS);
        phase(`auto-fallback compact generation start (deadline=${fallbackDeadline}ms)`);
        text = (await generateText(ai, userPromptCompact, systemPromptCondensed, { ...aiOpts, task: 'pitch_compact', json: true, deadlineMs: fallbackDeadline, onModel })).trim();
        phase('auto-fallback compact generation done');
      }
    }

    const tryParse = (t) => JSON.parse(t.replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '').trim());
    let data;
    try {
      data = tryParse(text);
      phase('json parsed');
    } catch (parseErr) {
      // Malformed JSON is NOT a timeout — don't let it get mislabeled downstream. If the full
      // attempt produced junk and there's still time, retry once with the compact prompt (smaller,
      // easier for the model to emit valid JSON). Otherwise surface a clear "invalid response".
      console.warn(`[gen ${requestId}] primary output was not valid JSON: ${parseErr.message}`);
      if (!usedCompact && timeLeft() > 3500) {
        usedCompact = true;
        fallbackUsed = true;
        const dl = Math.max(3000, timeLeft() - RESERVE_AFTER_GEN_MS);
        phase(`malformed-json fallback compact generation start (deadline=${dl}ms)`);
        const t2 = (await generateText(ai, userPromptCompact, systemPromptCondensed, { ...aiOpts, task: 'pitch_compact', json: true, deadlineMs: dl, onModel })).trim();
        data = tryParse(t2); // if THIS throws, the outer catch returns a clean "invalid response"
        phase('malformed-json fallback json parsed');
      } else {
        const e = new Error('invalid response'); e.code = 'INVALID_JSON'; throw e;
      }
    }

    // Fixed subject line for all Stamped pitches — enforced here so the model can never drift.
    data.email_subject = 'Your Instagram may be costing you customers';

    if (usedCompact) {
      // Compact fallback: guarantee the DM CTA link survived, and skip the length guard entirely
      // (no email_body to compress, DM is already short) so we make ZERO extra model calls.
      if (!data.dm_part2 || !String(data.dm_part2).includes('bbouniverse.com')) data.dm_part2 = BBO_CTA;
    } else if (process.env.GEMINI_FREE_TIER === 'true') {
      // Free tier: skip the length-guard's extra model calls (each is another request against the
      // ~20/min quota) — the prompt's length guidance is enough. Keeps generation to ONE request.
      // Belt-and-suspenders: still guarantee the DM CTA link is present.
      if (!data.dm_part2 || !String(data.dm_part2).includes('bbouniverse.com')) data.dm_part2 = BBO_CTA;
    } else {
      // Server-side length guard: compress over-cap email/DM bodies before returning. Budget-aware
      // so it's skipped once there isn't enough time left to risk it (see enforceLength above).
      await enforceLength(ai, data, timeLeft(), aiOpts);
    }

    // 4. Log the deliverables to pitch_history: one row per channel (dm, email). The frontend marks
    // each channel sent separately and records outcomes per row, so these two rows are intentional —
    // they are linked to ONE logical generation via generation_id. Written only on success, in a
    // single insert (both rows or neither), so failed attempts never add history rows.
    let historyIds = { dm: null, email: null };
    const historyRow = (channel, draft) => ({
      business_name: businessName, venue_type: null, gap_type: primaryGap || null, channel,
      ai_draft: draft, pitch_payload: body, outcome: 'pending', outcome_score: 50,
    });
    try {
      historyIds = await insertPitchHistoryRows(supabase,
        [historyRow('dm', data.dm_version), historyRow('email', data.email_body)], requestId, generationLog);
    } catch (dbErr) {
      console.error('Failed to log pitch history:', dbErr && dbErr.message);
    }

    // Add history IDs to the response
    data.history_ids = historyIds;

    // Operational metadata — safe for the client (no secrets). The frontend keeps it in dev mode
    // / logs; it doesn't need to be shown prominently in the UI.
    const summary = summarizeTrace(aiRequest.trace);
    data._meta = {
      requestId,
      modelUsed: modelUsed || null,
      fallbackUsed,
      compact: usedCompact,
      attempts: summary.attemptsCount,
      estimatedCostUsd: summary.estimatedCostUsd,
      totalDurationMs: Date.now() - requestStart
    };
    phase(`response returned (model=${modelUsed}, fallback=${fallbackUsed}, compact=${usedCompact})`);
    await completeGeneration('success', { data });

    return { statusCode: 200, headers, body: JSON.stringify(data) };

  } catch (err) {
    console.error(`[gen ${requestId}] error after +${Date.now() - requestStart}ms:`, err && err.message);
    await completeGeneration('failed', { err });
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: friendlyErrorMessage(err), requestId })
    };
  }

  // One summary line per generation — answers "why was this request slow?" — then persist the
  // generation record + attempts and the breaker/spend state. Bounded; never throws.
  async function completeGeneration(status, { data, err }) {
    const latencyMs = Date.now() - requestStart;
    const summary = summarizeTrace(aiRequest.trace);
    console.log('[ai-generation] ' + JSON.stringify({
      generationId: requestId, status, totalLatencyMs: latencyMs, modelUsed: modelUsed || null,
      providerUsed: summary.providerUsed, attempts: summary.attemptsCount, fallbackUsed, compact: usedCompact,
      fallbackReasons: summary.fallbackReasons, inputTokens: summary.inputTokens, outputTokens: summary.outputTokens,
      estimatedCostUsd: summary.estimatedCostUsd, errorKind: err ? (err.errorClass || err.failureKind || err.code || 'error') : null,
    }));
    try {
      await Promise.all([
        generationLog && generationLog.finish({ status, summary, latencyMs, compact: usedCompact, fallbackUsed,
          error: err || null, finalPitch: data || null, attempts: aiRequest.trace.attempts }),
        finishAiRequest(),
      ]);
    } catch (e) {
      console.warn(`[gen ${requestId}] generation bookkeeping failed: ${e && e.message}`);
    }
  }
};
