'use strict';
// The outreach email, in the founder's own live format (emails sent 2026-07-02 and 2026-07-06).
// The copy is fixed so it can never drift; the model supplies only the personalized page
// observation that completes "I checked your page out and …".
// (lib/ has no index.js / lib.js, so Netlify does not deploy it as a function.)

const EMAIL_SUBJECT = 'Your Instagram is costing you customers';
const PAGE_LINK = 'https://bbouniverse.com/pages/bbo-stamped';
const FALLBACK_OBSERVATION = 'the content looks good, but the lifestyle component is missing';
const COMMON_LEADING_WORDS = new Set(['The', 'Your', 'Their', 'It', 'Its', "It's", 'There', 'While', 'Everything', 'Most', 'All', 'Right', 'Although']);

// Normalizes the model's observation into a clause that reads after "I checked your page out and ".
function cleanObservation(raw) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim().replace(/^["'“”]+|["'“”]+$/g, '');
  s = s.replace(/^(hey,?\s*)?i\s+checked\s+your\s+page\s+out(\s+and)?\s*/i, '');
  s = s.replace(/^and\s+/i, '').replace(/[.!\s]+$/, '');
  if (!s || s.split(' ').length < 4) return null;
  // Mid-sentence clause: lower-case a leading common word, but keep proper nouns ("Island Social's").
  const firstWord = s.split(' ')[0];
  if (COMMON_LEADING_WORDS.has(firstWord)) s = firstWord.toLowerCase() + s.slice(firstWord.length);
  return s;
}

function buildEmailBody(observation) {
  const clause = cleanObservation(observation) || FALLBACK_OBSERVATION;
  return [
    'Hey,',
    '',
    'I run BBO Stamped — we bring a curated group of 5+ women creators into venues and shoot lifestyle content around the food, drinks, and vibe.',
    '',
    [
      `The real reason I reached out is because I believe I can make you money. A lot of spots have great food, strong service, and a good vibe — but social pages, i.e. Instagram/TikTok, don't always show that. Flyers, plain food shots, and random reposts don't move people the way they used to. I checked your page out and ${clause}. We should show people actually enjoying your place.`,
      "Every day your page doesn't sell the experience, there's a potential customer who checks you out, doesn't feel pulled in, and chooses another spot. Not because your business isn't good — but because the content didn't make them want to come.",
      'What works now is social proof: the right crowd in the room, showing the actual aesthetic of your place and having REAL PEOPLE enjoying themselves, creators posting the experience, and your venue looking like somewhere people need to pull up to.',
      "That's the gap BBO Stamped fills. We differ because you're getting 5+ content creators for the price of 1. We provide review, interview, skit, photo content and more.",
    ].join('\n'),
    '',
    `Worth a 10-minute call this week? I can send the package breakdown. Check us out here: ${PAGE_LINK}`,
  ].join('\n');
}

module.exports = { EMAIL_SUBJECT, PAGE_LINK, buildEmailBody, cleanObservation, FALLBACK_OBSERVATION };
