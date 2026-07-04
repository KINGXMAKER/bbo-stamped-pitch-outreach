const { getGeminiClient, getSupabaseClient, getMatchingExamples, generateText } = require('./shared');

function buildSystemPrompt(voicePrompt, examplesPrompt) {
  return `You are the founder of BBO Stamped writing your own outreach — a lifestyle content activation brand. You write personalized, confident, founder-led pitches for restaurants, lounges, bars, med spas, beauty businesses, brunch spots, dessert spots, cafes, nightlife spots, and local experience-based businesses.

WHAT BBO STAMPED IS:
BBO Stamped isn't one influencer stopping by. We bring a curated group of women and creators to the business, capture real reactions, reels, photos, story content, and customer-style content, then give the business content they can repost, run as ads, and use to make the page feel alive.

BBO has over 60K followers across our social media channels, with a strong audience base in New Jersey and New York. BBO Stamped turns that local attention into social proof, content, and foot traffic for businesses. Only mention the 60K / NJ–NY stat when it genuinely strengthens the pitch — never in the opening line, never as a stat dump, and never if it would push the message past its length limit. When you use it, keep it to one natural clause.

THE STRATEGY IS FIXED BY THE USER:
- The Primary Gap is the ANGLE THE PITCH MUST LEAD WITH. Build the entire pitch around it.
- The Secondary Gap is the supporting weakness to mention once, reinforcing the primary angle.
- Do NOT invent a different gap or override the user's choice. Their selected gaps are the strategy.

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
- FORBIDDEN PHRASES — never use any of these: "aspirational lifestyle", "discerning women", "consequently", "ignite social proof", "client journey", "full creative production", "premium lens", "social presence isn't optional anymore", "discover you, trust you, decide to spend money with you".
- Do NOT include any Instagram reel/post links or "past activations" links anywhere in the output.

EMAIL STRUCTURE (mandatory):
1. Greeting: "Hi," (or "Hi [name]," only if a real contact name is available).
2. Locked intro line, used exactly (adapt only the business-type reference if truly needed): "I run BBO Stamped, where we curate creators to raise a business's social media presence and drive real foot traffic to places like yours."
3. Go straight into the personalized gap observation — no warm-up sentences, no "I'll keep this short", no compliment paragraph before the gap. Any compliment is a short clause inside the gap observation.
4. One short paragraph on what a BBO Stamped activation is (curated group of creators, one activation, real reactions/reels/photos/customer-style content, content they can repost and run as ads).
5. The 60K / NJ–NY line — only if it reads naturally.
6. CTA: a quick-call ask, then the BBO Stamped page link.
- Target 120–170 words. HARD CAP 190 words. Max 4 short paragraphs. No giant paragraphs.

DM STRUCTURE (mandatory):
1. Open exactly: "I run BBO Stamped, where I curate creators to raise social media presence and drive foot traffic to places like yours."
2. Go straight into the gap: compliment as a short clause, then what's missing, then one line on what BBO Stamped brings.
3. CTA: the BBO Stamped page link (this is the dm_part2 field — keep it out of dm_version).
- Target 70–110 words for the DM body. HARD CAP 130 words. Max 2 short paragraphs.

VOICE — founder-led and plain-spoken, not agency-corporate. Lean on patterns like:
- "your page looks good, but it doesn't fully show the experience"
- "the food looks strong, but people need to see people enjoying it"
- "right now the page sells the product more than the vibe"
- "that's where BBO Stamped fits"
- "real women, real reactions, creators posting, and content the business can reuse"
- "make people stop scrolling, save the post, tag friends, and pull up"
(Use these as tone guides, not verbatim requirements.)
${voicePrompt}
${examplesPrompt}
GAP REFERENCE (the user's selected Primary Gap leads; keep it plain-spoken):
- "No People" Gap: The food/product shots are there, but there aren't real people in them, so the place can look empty.
- "Empty Room" Gap: Posts exist, but the place never looks busy or alive.
- "Product-Only" Gap: Your page does a good job showing the products, but it's missing more real people actually enjoying the spot. Right now the feed sells what you offer more than the feeling of being there.
- "No Social Proof" Gap: The page looks clean, but there isn't enough content showing real customers, real reactions, and people choosing the spot. That's what makes someone feel like they should pull up.
- "Good Business, Weak Perception" Gap: The business is clearly strong, but the feed doesn't match the quality.
- "No Vibe" Gap: The products look good, but the page doesn't fully show the energy of the space. People need to see the vibe before they decide to visit.
- "No Target Customer" Gap: You can't tell who this place is for from the feed.
- "Flyer-Only Marketing" Gap: The feed is mostly announcements, menus, and flyers — not real lifestyle content.
- "Low Engagement" Gap: The content is decent, but it isn't getting reach, comments, or shares.
- "General Pitch" Angle: Use only when the user leaves the gap blank — focus on the lifestyle / social-proof gap generally.

Return a JSON object with these exact fields. No markdown, no backticks, just raw JSON.`;
}

const BBO_CTA = 'Please checkout our website for a further breakdown on what we can do for your business:\nhttps://bbouniverse.com/pages/bbo-stamped';

function countWords(s) {
  return (String(s || '').trim().match(/\S+/g) || []).length;
}

// Ask the model to compress one field to a word budget while preserving voice, the
// locked opener, and (for emails) the CTA link. Returns compressed text or null on failure.
async function compressField(ai, label, textValue, maxWords) {
  const sys = `You compress outreach copy. Return ONLY the rewritten ${label} as plain text — no JSON, no quotes, no markdown. Keep the same founder-led voice, the exact opening line, every fact, and any link. Do not add anything new. Never exceed ${maxWords} words.`;
  const prompt = `Rewrite this ${label} so it is ${maxWords} words or fewer while keeping the opener, the gap point, and the CTA. Stay plain and direct.\n\n${label}:\n"""\n${textValue}\n"""`;
  try {
    const out = (await generateText(ai, prompt, sys, { deadlineMs: 12000 })).trim();
    return out.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').replace(/^"+|"+$/g, '').trim();
  } catch (e) {
    console.error(`[length-guard] compression of ${label} failed:`, e.message);
    return null;
  }
}

// Server-side length enforcement so we never depend on the model self-policing.
async function enforceLength(ai, data) {
  if (countWords(data.email_body) > 190) {
    const compressed = await compressField(ai, 'email', data.email_body, 170);
    if (compressed && countWords(compressed) <= 200) {
      // Guarantee the fixed CTA link survived compression.
      data.email_body = compressed.includes('bbouniverse.com/pages/bbo-stamped')
        ? compressed
        : compressed.trimEnd() + '\n\n' + BBO_CTA;
    }
  }
  if (countWords(data.dm_version) > 130) {
    const compressed = await compressField(ai, 'Instagram DM', data.dm_version, 110);
    if (compressed && countWords(compressed) <= 140) data.dm_version = compressed;
  }
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

  try {
    const body = JSON.parse(event.body || '{}');
    const { businessName, location, instagram, vibe, igNotes, tone, primaryGap, secondaryGap } = body;

    if (!businessName) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Business name is required' }) };

    const ai = getGeminiClient();

    // 1. Fetch voice profile and matching examples from Supabase
    const supabase = getSupabaseClient();

    const { data: profileRow } = await supabase
      .from('voice_profiles')
      .select('*')
      .order('last_refreshed', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Match examples by the user's selected gap; outcome is never used to rank them.
    const emailExamples = await getMatchingExamples(supabase, 'email', null, primaryGap);
    const dmExamples = await getMatchingExamples(supabase, 'dm', null, primaryGap);

    // 2. Build dynamic writing rules
    const voiceProfile = profileRow ? profileRow.profile_data : null;
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
- Follow the mandatory EMAIL STRUCTURE and DM STRUCTURE and their length caps exactly
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

    const systemPrompt = buildSystemPrompt(voicePrompt, examplesPrompt);

    const toneInstructions = tone === 'luxury'
      ? 'Make the pitch feel MORE premium, exclusive, and aspirational. More confident luxury language.'
      : tone === 'direct'
      ? 'Make the pitch MORE direct, punchy, and no-nonsense. Cut to the point faster.'
      : tone === 'shorter'
      ? 'Make the DM significantly shorter — under 200 characters for Part 1. Keep the core angle.'
      : '';

    const userPrompt = `Write a full BBO Stamped pitch for this business. Lead the entire pitch with the Primary Gap the user selected; use the Secondary Gap in support. Keep the focus on their Instagram/social feed and building social proof.

Business: ${businessName}
Location: ${location || 'Unknown'}
Instagram: ${instagram || 'Not provided'}
>> PRIMARY GAP (lead the pitch with this — the user chose it): ${primaryGap || 'General Pitch / Fallback'}
>> SECONDARY GAP (support angle — the user chose it): ${secondaryGap || 'None identified'}
Vibe/Notes: ${vibe || 'Not provided'}
Instagram Feed Observations: ${igNotes || 'Not provided'}
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
  "dm_version": "Instagram DM body — follow the DM STRUCTURE exactly. Open with the locked DM line, then the gap (compliment as a short clause, what's missing, one line on what BBO Stamped brings). Do NOT include the CTA link here (that is dm_part2). 70-110 words, hard cap 130. Max 2 short paragraphs.",
  "dm_part2": "Instagram DM Part 2 — fixed closing CTA linking to the BBO Stamped page.",
  "email_subject": "Your Instagram may be costing you customers",
  "email_body": "Full email pitch following the EMAIL STRUCTURE exactly: 'Hi,' greeting, the locked intro line, straight into the personalized gap observation, one short paragraph on what a BBO Stamped activation is, the 60K/NJ-NY line only if natural, then the CTA. 120-170 words, hard cap 190, max 4 short paragraphs. MUST end with the fixed closing line: 'Please checkout our website for a further breakdown on what we can do for your business:\\nhttps://bbouniverse.com/pages/bbo-stamped'",
  "call_talking_points": ["4-5 talking points for a phone pitch"],
  "follow_up": "3-5 day follow up DM — references the first message, adds urgency, keeps it short (under 90 words). Ends with the same fixed closing line: 'Please checkout our website for a further breakdown on what we can do for your business:\\nhttps://bbouniverse.com/pages/bbo-stamped'",
  "internal_notes": "Brief internal note on why this pitch approach was chosen"
}

The dm_part2 should always be exactly:
"Please checkout our website for a further breakdown on what we can do for your business:\\nhttps://bbouniverse.com/pages/bbo-stamped"

The email_body must end with this exact same closing line (on its own lines, after the CTA paragraph):
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
    const text = (await generateText(ai, userPrompt, systemPrompt, pitchOpts)).trim();
    const cleaned = text.replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
    const data = JSON.parse(cleaned);

    // Fixed subject line for all Stamped pitches — enforced here so the model can never drift.
    data.email_subject = 'Your Instagram may be costing you customers';

    // Server-side length guard: compress over-cap email/DM bodies before returning.
    await enforceLength(ai, data);

    // 4. Log the generation to pitch_history in Supabase
    let dmHistoryId = null;
    let emailHistoryId = null;
    try {
      const { data: dmRow } = await supabase
        .from('pitch_history')
        .insert({
          business_name: businessName,
          venue_type: null,
          gap_type: primaryGap || null,
          channel: 'dm',
          ai_draft: data.dm_version,
          pitch_payload: body,
          outcome: 'pending',
          outcome_score: 50
        })
        .select('id')
        .single();
      if (dmRow) dmHistoryId = dmRow.id;

      const { data: emailRow } = await supabase
        .from('pitch_history')
        .insert({
          business_name: businessName,
          venue_type: null,
          gap_type: primaryGap || null,
          channel: 'email',
          ai_draft: data.email_body,
          pitch_payload: body,
          outcome: 'pending',
          outcome_score: 50
        })
        .select('id')
        .single();
      if (emailRow) emailHistoryId = emailRow.id;
    } catch (dbErr) {
      console.error('Failed to log pitch history:', dbErr);
    }

    // Add history IDs to the response
    data.history_ids = {
      dm: dmHistoryId,
      email: emailHistoryId
    };

    return { statusCode: 200, headers, body: JSON.stringify(data) };

  } catch (err) {
    console.error('generate-pitch error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Pitch generation failed: ' + err.message })
    };
  }
};
