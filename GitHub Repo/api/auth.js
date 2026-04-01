// ============================================================
//  api/auth.js  —  Hornhub Auth Route (Vercel Version)
//  Netlify se Vercel pe migrate kiya — sirf format badla
//  Sab logic: _shared/algorithm.js mein hai
// ============================================================

"use strict";

const engine = require("./_shared/algorithm");

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "Method not allowed" });

  const payload = req.body;
  if (!["signup", "login"].includes(payload?.action)) {
    return res.status(400).json({ error: "action must be signup or login" });
  }

  const result = await engine.process(payload.action, payload);
  return res.status(result.statusCode).json(result.body);
};
