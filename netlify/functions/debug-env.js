exports.handler = async () => ({
  statusCode: 200,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    cwd: process.cwd(),
    geminiKeySet: !!process.env.GEMINI_API_KEY,
    geminiKeyPrefix: process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.slice(0, 8) : 'MISSING',
    geminiModel: process.env.GEMINI_MODEL || 'NOT SET',
    supabaseUrl: process.env.SUPABASE_URL ? 'SET' : 'MISSING'
  })
});
