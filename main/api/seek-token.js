// api/seek-token.js — Vercel Serverless Function
// SeekStreaming API key securely return karta hai

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

  // SeekStreaming API key env variable se do
  const key = process.env.SEEK_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'API key not configured on server' });
  }

  return res.status(200).json({ key });
};
