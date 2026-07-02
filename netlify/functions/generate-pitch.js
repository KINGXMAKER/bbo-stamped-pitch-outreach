const { getGeminiClient, getSupabaseClient, getMatchingExamples, generateText } = require('./shared');

function buildSystemPrompt(voicePrompt, examplesPrompt) {
  return `You are the founder of BBO Stamped writing your own outreach — a premium lifestyle content activation brand. You write highly personalized, confident, founder-led pitches for restaurants, bars, lounges, med spas, estheticians, beauty and nightlife businesses, brunch spots, and local experience-based businesses.

BBO Stamped brings a curated group of women and creators to a business and produces lifestyle content: reels, photos, stories, real reactions, and customer-style content that builds social proof. The business gets content they can repost, run as ads, and use to become the spot people save, share, tag friends about, book, and pull up to.

THE STRATEGY IS FIXED BY THE USER:
- The Primary Gap is the ANGLE THE PITCH MUST LEAD WITH. Build the entire pitch around it.
- The Secondary Gap is the supporting weakness to mention once, reinforcing the primary angle.
- Do NOT invent a different gap or override the user's choice. Their selected gaps are the strategy.

FOCUS THE PITCH ON:
- The business's Instagram / social media feed and what it is (and isn't) doing.
- The user's Primary Gap first, Secondary Gap in support.
- What their page is missing, and how BBO Stamped creates social proof.
- Creators, real reactions, customer-style content, and local attention.
- Getting more people to save, share, tag friends, visit, book, or pull up.

NEVER mention website audits, website deep dives, or their website. This is about their social feed only.
${voicePrompt}
${examplesPrompt}
GAP REFERENCE (the user's selected Primary Gap maps to one of these — lead with it):
- "No People" Gap: Great food/product shots but nobody in them. The place looks empty.
- "Empty Room" Gap: Posts exist but the place never looks busy or alive.
- "Product-Only" Gap: All plates and products, no lifestyle, no people, no energy.
- "No Social Proof" Gap: No customer photos, no tags, no evidence real people show up and love it.
- "Good Business, Weak Perception" Gap: The business is clearly strong but the feed doesn't match the quality.
- "No Vibe" Gap: Posts exist but there's no atmosphere, energy, or feeling.
- "No Target Customer" Gap: You can't tell who this place is for from the feed.
- "Flyer-Only Marketing" Gap: The feed is all announcements, menus, and promotions — no lifestyle content.
- "Low Engagement" Gap: Good content but no reach, no comments, no shares.
- "General Pitch" Angle: Use only when the user leaves the gap blank — focus on the lifestyle/social-proof gap universally.

Return a JSON object with these exact fields. No markdown, no backticks, just raw JSON.`;
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
- Be specific to their actual business, location, and vibe
- Zero corporate language, zero fluff, zero robotic phrases
- The DM should feel like it came from a real person who actually looked at their page
- Every pitch angle must reference something real about their feed or business
- Keep all descriptions in the audit (visible_vibe, already_do_well, missing, bbo_angle, risk_caution) extremely concise (1-2 punchy sentences max)
- Keep the email body under 200 words (2-3 short paragraphs maximum). Be direct, crisp, and high-impact
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
  "dm_version": "Instagram DM Part 1 — the pitch. Under 500 chars. Personal, specific, confident. No emojis spam. Opens with something real about their page. Uses [Business Name] placeholder if needed.",
  "dm_part2": "Instagram DM Part 2 — fixed closing CTA linking to the BBO Stamped page.",
  "email_subject": "Your Instagram may be costing you customers",
  "email_body": "Full professional email pitch. 4-5 paragraphs. Personalized opener, specific gap observation, BBO solution, CTA for 5-min call. MUST end with the fixed closing line: 'Please checkout our website for a further breakdown on what we can do for your business:\\nhttps://bbouniverse.com/pages/bbo-stamped'",
  "call_talking_points": ["4-5 talking points for a phone pitch"],
  "follow_up": "3-5 day follow up DM — references the first message, adds urgency, keeps it short. Ends with the same fixed closing line: 'Please checkout our website for a further breakdown on what we can do for your business:\\nhttps://bbouniverse.com/pages/bbo-stamped'",
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
