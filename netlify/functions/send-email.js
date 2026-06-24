const { Resend } = require('resend');
const { getSupabaseClient, getGeminiClient, updatePitchHistoryAndExtractCorrections } = require('./shared');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const bodyData = JSON.parse(event.body || '{}');
    const to = bodyData.to || bodyData.toEmail;
    const toName = bodyData.toName;
    const subject = bodyData.subject || bodyData.emailSubject;
    const emailBody = bodyData.body || bodyData.emailBody;
    const historyId = bodyData.historyId;

    if (!to || !subject || !emailBody) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields: to, subject, body' }) };
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const fromEmail = process.env.BBO_FROM_EMAIL || 'BBO Stamped <ops@bbouniverse.com>';
    const bccEmail = process.env.BBO_BCC_EMAIL || 'ops@bbouniverse.com';

    const toAddress = toName ? `${toName} <${to}>` : to;

    const result = await resend.emails.send({
      from: fromEmail,
      to: [toAddress],
      bcc: [bccEmail],
      subject,
      text: emailBody,
    });

    if (result.error) throw new Error(result.error.message);

    // Update pitch history with what was actually sent
    if (historyId) {
      try {
        const supabase = getSupabaseClient();
        const ai = getGeminiClient();
        await updatePitchHistoryAndExtractCorrections(supabase, ai, historyId, emailBody);
      } catch (dbErr) {
        console.error('Failed to log sent email in pitch history:', dbErr);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, id: result.data?.id })
    };

  } catch (err) {
    console.error('send-email error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Email send failed: ' + err.message })
    };
  }
};
