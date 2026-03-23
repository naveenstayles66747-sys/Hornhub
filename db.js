// ============================================================
//  netlify/functions/db.js  —  Hornhub DB Route
//
//  YE FILE SIRF ROUTER HAI. KOI LOGIC NAHI.
//  Kaam: HTTP request lo → algorithm ko do → response bhejo.
//
//  Sab logic: _shared/algorithm.js mein hai
// ============================================================

"use strict";

const engine = require("./_shared/algorithm");

const CORS = {
  "Access-Control-Allow-Origin" : "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type"                : "application/json",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (event.httpMethod !== "POST")    return respond(405, { error: "Method not allowed" });

  let payload;
  try { payload = JSON.parse(event.body); }
  catch { return respond(400, { error: "Invalid JSON" }); }

  if (!payload.action) return respond(400, { error: "action required" });

  const result = await engine.process(payload.action, payload);
  return respond(result.statusCode, result.body);
};

function respond(statusCode, data) {
  return { statusCode, headers: CORS, body: JSON.stringify(data) };
}
