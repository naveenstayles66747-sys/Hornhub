// =====================================================
// Netlify Function: seek-token.js
// SeekStreaming API key securely return karta hai
// Sirf sahi admin password hone par key milegi
// =====================================================

exports.handler = async (event) => {
  // Sirf POST allow karo
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { adminPass } = JSON.parse(event.body || '{}');

    // Netlify Environment Variable se admin password check karo
    // (Netlify Dashboard > Site Settings > Environment Variables)
    const correctPass = process.env.ADMIN_PASSWORD;
    const seekKey     = process.env.SEEK_API_KEY;

    if (!correctPass || !seekKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Server environment variables not set' })
      };
    }

    if (adminPass !== correctPass) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Unauthorized' })
      };
    }

    // Sahi password — key return karo
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: seekKey })
    };

  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Bad request' })
    };
  }
};
