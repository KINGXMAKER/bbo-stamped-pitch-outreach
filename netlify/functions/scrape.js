const { getGeminiClient, generateText } = require('./shared');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { url, businessName, location } = JSON.parse(event.body || '{}');
    if (!url) return { statusCode: 400, headers, body: JSON.stringify({ scrapedSuccessfully: false, error: 'No URL provided' }) };

    let markdown = '';
    let rawTitle = '';
    let wordCount = 0;

    try {
      const jinaRes = await fetch(`https://r.jina.ai/${url}`, {
        headers: { 'Accept': 'text/markdown' }
      });
      if (!jinaRes.ok) throw new Error(`Jina returned ${jinaRes.status}`);
      markdown = await jinaRes.text();
      const titleMatch = markdown.match(/^#\s+(.+)$/m);
      rawTitle = titleMatch ? titleMatch[1] : '';
      wordCount = markdown.split(/\s+/).filter(Boolean).length;
    } catch (scrapeErr) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          scrapedSuccessfully: false,
          error: 'SCRAPE_BLOCKED',
          reason: 'Site blocked scraping. Add notes manually.'
        })
      };
    }

    if (!markdown || wordCount < 10) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          scrapedSuccessfully: false,
          error: 'EMPTY_CONTENT',
          reason: 'Site returned no readable content.'
        })
      };
    }

    // Use Gemini to extract structured insights
    const ai = getGeminiClient();

    const prompt = `You are analyzing a business website for a sales pitch tool. Extract key details from this website content.

Business: ${businessName || 'Unknown'}
Location: ${location || 'Unknown'}
Website content (markdown):
${markdown.slice(0, 3000)}

Return ONLY a JSON object (no markdown):
{
  "scrapedSuccessfully": true,
  "category": "Restaurant | Bar/Lounge | Cafe | Retail | Beauty | Other",
  "description": "1-2 sentence business description",
  "atmosphere": "vibe and aesthetic observed from the site",
  "locationRelevance": "location context and local market notes",
  "socialProofGap": "what lifestyle/social content is missing based on site",
  "markdown": "${markdown.slice(0, 500).replace(/"/g, '\\"').replace(/\n/g, '\\n')}"
}`;

    const text = (await generateText(ai, prompt)).trim();
    const cleaned = text.replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
    const insights = JSON.parse(cleaned);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        scrapedSuccessfully: true,
        insights,
        rawTitle,
        wordCount
      })
    };

  } catch (err) {
    console.error('scrape error:', err);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        scrapedSuccessfully: false,
        error: 'SCRAPE_FAILED',
        reason: err.message
      })
    };
  }
};
