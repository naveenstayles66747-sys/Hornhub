// api/seek-token.js — Vercel Serverless Function
// SeekStreaming API key securely return karta hai admin password verify karke

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json',
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).setHeaders(CORS).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { adminPass } = body;

  // Admin password verify karo (Vercel env variable se)
  if (!adminPass || adminPass !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // SeekStreaming API key env variable se do
  const key = process.env.SEEK_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'API key not configured on server' });
  }

  return res.status(200).json({ key });
};
