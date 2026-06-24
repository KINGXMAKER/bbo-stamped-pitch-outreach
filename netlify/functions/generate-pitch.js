const { getGeminiClient, getSupabaseClient, getMatchingExamples, generateText } = require('./shared');

function buildSystemPrompt(voicePrompt, examplesPrompt) {
  return `You are a founder-level brand strategist and sales closer for BBO Stamped — a premium lifestyle content activation brand. Your job is to write highly personalized, confident, and persuasive pitches for restaurants, bars, lounges, and lifestyle venues.

BBO Stamped brings a curated group of women and creators to a venue and produces lifestyle content: reels, photos, stories, voiceovers, and social proof. The venue gets content they can repost, run as ads, and use to position themselves as the place to be.
${voicePrompt}
${examplesPrompt}
PITCH ANGLES (use the primaryGap to drive the entire pitch):
- "No People" Gap: Great food/product shots but nobody in them. The venue looks empty.
- "Empty Room" Gap: Posts exist but the venue never looks busy or alive.
- "Product-Only" Gap: All plates and products, no lifestyle, no people, no energy.
- "No Social Proof" Gap: No customer photos, no tags, no evidence real people show up and love it.
- "Good Business, Weak Perception" Gap: The business is clearly strong but the Instagram doesn't match the quality.
- "No Vibe" Gap: Posts exist but there's no atmosphere, energy, or feeling.
- "No Target Customer" Gap: You can't tell who this place is for from the feed.
- "Flyer-Only Marketing" Gap: The feed is all announcements, menus, and promotions — no lifestyle.
- "Low Engagement" Gap: Good content but no reach, no comments, no shares.
- "General Pitch" Angle: Use when no specific gap is detected — focus on lifestyle content gap universally.

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
    const { businessName, location, vertical, instagram, websiteUrl, vibe, igNotes, websiteInsights, tone, primaryGap, secondaryGap } = body;

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

    const emailExamples = await getMatchingExamples(supabase, 'email', vertical, primaryGap);
    const dmExamples = await getMatchingExamples(supabase, 'dm', vertical, primaryGap);

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
- Signature Moves: ${Array.isArray(voiceProfile.signature_moves) ? voiceProfile.signature_moves.map(m => `- ${m}`).join('\n') : '- Name-drops past activations early\n- Focuses on the gap\n- Ends with a peer-to-peer call CTA'}
- DM Structure: ${voiceProfile.dm_structure || 'Hook -> specific observation -> offer -> question CTA'}
- Email Structure: ${voiceProfile.email_structure || 'Subject -> short paragraphs -> portfolio links -> CTA'}
- Emotional Register: ${voiceProfile.emotional_register || 'Peer-to-peer, collaborative'}
`;
    } else {
      voicePrompt = `
WRITING RULES:
- Write like a confident founder who genuinely sees the gap and knows how to close it
- Never say "I noticed your website says" or "The site states" — speak from the angle, not the source
- Be specific to their actual business, location, and vibe
- Zero corporate language, zero fluff, zero robotic phrases
- The DM should feel like it came from a real person who actually looked at their page
- Every pitch angle must reference something real about their business
- Keep all descriptions in the audit (visible_vibe, already_do_well, missing, bbo_angle, risk_caution) extremely concise (1-2 punchy sentences max)
- Keep the email body under 200 words (2-3 short paragraphs maximum). Be direct, crisp, and high-impact
`;
    }

    // 3. Build dynamic examples
    let examplesPrompt = '';
    if (emailExamples.length > 0 || dmExamples.length > 0) {
      examplesPrompt = `
REAL EXAMPLES OF PITCHES THAT WORKED:
${emailExamples.length > 0 ? `
--- EMAIL EXAMPLES ---
${emailExamples.map((e, idx) => `[Example #${idx+1} — Outcome: ${e.outcome}]\n${e.content}`).join('\n\n')}` : ''}
${dmExamples.length > 0 ? `
--- DM EXAMPLES ---
${dmExamples.map((e, idx) => `[Example #${idx+1} — Outcome: ${e.outcome}]\n${e.content}`).join('\n\n')}` : ''}

CRITICAL: Carefully study the tone, pacing, sentence length, and structure of these real examples. Your generated email and DM MUST sound exactly like they were written by the same person who wrote these examples. Avoid formulas; copy the human rhythm.
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

    const websiteContext = websiteInsights
      ? `Website analysis: ${JSON.stringify(websiteInsights)}`
      : websiteUrl ? `Website: ${websiteUrl} (not analyzed)` : 'No website data available.';

    const userPrompt = `Write a full BBO Stamped pitch for this business:

Business: ${businessName}
Location: ${location || 'Unknown'}
Vertical: ${vertical || 'Restaurant/Venue'}
Instagram: ${instagram || 'Not provided'}
Primary Content Gap: ${primaryGap || 'General Pitch / Fallback'}
Secondary Content Gap: ${secondaryGap || 'None identified'}
Vibe/Notes: ${vibe || 'Not provided'}
Instagram Content Observations: ${igNotes || 'Not provided'}
${websiteContext}
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
  "dm_part2": "Instagram DM Part 2 — portfolio links. Fixed text with past activation links.",
  "email_subject": "BBO Stamped x ${businessName} — Content Activation",
  "email_body": "Full professional email pitch. 4-5 paragraphs. Personalized opener, specific gap observation, BBO solution, past activation references, CTA for 5-min call.",
  "call_talking_points": ["4-5 talking points for a phone pitch"],
  "follow_up": "3-5 day follow up DM — references the first message, adds urgency, keeps it short",
  "internal_notes": "Brief internal note on why this pitch approach was chosen"
}

The dm_part2 should always be:
"Here are past activations we did.\\n\\n1Republik in North Arlington, NJ.\\nhttps://www.instagram.com/dabboshow/reel/DXvH2HIRf-3/\\nhttps://www.instagram.com/p/DX7Ro4jGsnt/?img_index=6\\nhttps://www.instagram.com/dabboshow/reel/DXzJIMmRKmz/\\n\\nHyde and Seek speakeasy in Brooklyn:\\nhttps://www.instagram.com/reels/DYYanF-Fr96/\\nhttps://www.instagram.com/p/DYiLhhnocst/\\nhttps://www.instagram.com/bbohub/p/DZFleqljodX/"`;

    const text = (await generateText(ai, userPrompt, systemPrompt)).trim();
    const cleaned = text.replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
    const data = JSON.parse(cleaned);

    // 4. Log the generation to pitch_history in Supabase
    let dmHistoryId = null;
    let emailHistoryId = null;
    try {
      const { data: dmRow } = await supabase
        .from('pitch_history')
        .insert({
          business_name: businessName,
          venue_type: vertical || null,
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
          venue_type: vertical || null,
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
