// ============================================================
//  api/seek-token.js  —  SeekStreaming API Key (Vercel Version)
//  Sirf sahi admin password hone par key milegi
// ============================================================

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).send("Method Not Allowed");

  const { adminPass } = req.body || {};
  const correctPass   = process.env.ADMIN_PASSWORD;
  const seekKey       = process.env.SEEK_API_KEY;

  if (!correctPass || !seekKey) {
    return res.status(500).json({ error: "Server environment variables not set" });
  }

  if (adminPass !== correctPass) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  return res.status(200).json({ key: seekKey });
};
