const { getGeminiClient, getModelName } = require('./shared');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const genAI = getGeminiClient();
    const modelName = getModelName();
    console.log('[list-models] key prefix:', process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.slice(0, 8) : 'MISSING');
    console.log('[list-models] model:', modelName);

    const model = genAI.getGenerativeModel({ model: modelName });
    const result = await model.generateContent('Reply with the single word: WORKING');
    const text = result.response.text();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        currentModel: modelName,
        testResponse: text,
        status: 'API key and model confirmed working'
      })
    };
  } catch (err) {
    console.error('[list-models] error:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
