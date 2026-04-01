// ============================================================
//  _shared/syncManager.js  —  Firebase RTDB Sync Layer
//
//  JSONBin se Firebase Realtime Database pe migrate kiya.
//  Koi npm package nahi — sirf Firebase REST API (fetch).
//  Algorithm.js ko kuch bhi nahi badlna — API same hai.
//
//  ENV VARS (Netlify Dashboard > Site Settings > Env Vars):
//    FIREBASE_DB_URL    = https://save-links-3d931-default-rtdb.firebaseio.com
//    FIREBASE_DB_SECRET = (optional — sirf tab chahiye jab rules locked hon)
//                         Agar rules { ".read":true, ".write":true } hain
//                         toh secret zaroorat nahi.
// ============================================================

"use strict";

// Firebase project URL — env var se, ya hardcoded fallback
const DB_URL    = (process.env.FIREBASE_DB_URL || "https://save-links-3d931-default-rtdb.firebaseio.com").replace(/\/$/, "");
const DB_SECRET = process.env.FIREBASE_DB_SECRET || "";
const ROOT      = "hornhub_data"; // sab data is path ke andar jayega

if (!DB_URL) {
  console.error("[syncManager] FIREBASE_DB_URL env variable missing!");
}

// ── Auth query string (agar secret hai toh) ──────────────────────
function _url(path) {
  const base = `${DB_URL}/${ROOT}/${path}.json`;
  return DB_SECRET ? `${base}?auth=${DB_SECRET}` : base;
}

// ── Firebase REST calls ───────────────────────────────────────────
async function _get(path) {
  const res = await fetch(_url(path));
  if (!res.ok) throw new Error(`Firebase GET /${path} → HTTP ${res.status}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function _put(path, data) {
  const res = await fetch(_url(path), {
    method : "PUT",
    headers: { "Content-Type": "application/json" },
    body   : JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Firebase PUT /${path} → HTTP ${res.status}`);
  return true;
}

// ════════════════════════════════════════════════════════════════
//  PUBLIC API — bilkul same interface jaise JSONBin version tha.
//  Algorithm.js mein zero change.
// ════════════════════════════════════════════════════════════════

// Poora record padhna
async function readBin() {
  const data = await _get("record");
  return data || {};
}

// Poora record likhna (full replace)
async function writeBin(record) {
  await _put("record", record);
  return true;
}

// Safe update: read → modify → write
// Sirf patchFn jo field badalna chahta hai woh badlega,
// baaki sab data safe rahega.
async function patchBin(patchFn) {
  const record  = await readBin();
  const updated = await patchFn(record);
  await writeBin(updated);
  return updated;
}

// SHA-256 password hash (Node 18+ Web Crypto)
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const salt    = DB_URL.split("/").pop() || "hornhub";
  const buffer  = await crypto.subtle.digest("SHA-256", encoder.encode(password + salt));
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

module.exports = { readBin, writeBin, patchBin, hashPassword };
