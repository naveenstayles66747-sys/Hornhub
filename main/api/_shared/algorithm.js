// ============================================================
//  _shared/algorithm.js  —  Hornhub Algorithm Engine
//
//  YE FILE KYA KARTI HAI:
//  db.js   → request aati hai → algorithm.process() call hota hai
//  auth.js → request aati hai → algorithm.process() call hota hai
//  Dono files ka POORA LOGIC yahan hai. Wahan ZERO logic hai.
//
//  ORIGINAL FILES SE KYA LIYA:
//  ✅ db.js   → ping_online, leave_online, get_online
//              get_stats, save_stats
//              log_activity, get_activity, clear_activity
//              save_uploads, get_uploads
//  ✅ auth.js → signup, login
//
//  NAYA JO HUMNE ADD KIYA:
//  ✅ add_view, get_views          (views counter)
//  ✅ like_video, get_likes        (likes counter)
//  ✅ add_comment, get_comments,   (comments)
//     delete_comment
//  ✅ add_share                    (share counter)
//  ✅ add_download,                (download counter)
//     get_video_counters
//
//  BUGS JO HUMNE FIX KIE:
//  🔴 auth.js writeUsers() → sirf { users } likhta tha
//     → poora bin wipe ho jaata tha (videos, likes, sab kuch delete)
//     ✅ FIX: ab patchBin() use hota hai — sirf users update hote hain
//
//  🔴 db.js session_id → har tab ek naya count
//     ✅ FIX: user_id (device_id) use hota hai — same browser = 1 count
// ============================================================

"use strict";

const sync = require("./syncManager");

// ── CORS headers — har response mein yahi jaayenge ───────────
const CORS = {
  "Access-Control-Allow-Origin" : "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type"                : "application/json",
};

// ── AlgorithmEngine class ─────────────────────────────────────
class AlgorithmEngine {
  constructor() {
    this._handlers   = new Map();
    this._middleware = [];
  }

  use(fn) { this._middleware.push(fn); return this; }

  on(action, handler) { this._handlers.set(action, handler); return this; }

  async process(action, payload = {}) {
    // Middleware chalao
    for (const mw of this._middleware) {
      const early = await mw(action, payload);
      if (early) return early;
    }
    // Handler dhundho
    const handler = this._handlers.get(action);
    if (!handler) return this._err(400, `Unknown action: "${action}"`);
    // Handler chalao
    try {
      return await handler(payload);
    } catch (err) {
      console.error(`[Algorithm] "${action}" error:`, err.message);
      return this._err(500, "Server error: " + err.message);
    }
  }

  // Response helpers
  _ok(data = {})      { return { statusCode: 200, headers: CORS, body: { success: true,  ...data } }; }
  _err(code, message) { return { statusCode: code, headers: CORS, body: { success: false, error: message } }; }
}

const engine = new AlgorithmEngine();

// Middleware: request logger
engine.use(async (action) => {
  console.log(`[Algorithm] ▶ ${action} | ${new Date().toISOString()}`);
  // kuch return nahi → handler continue hota hai
});

// ════════════════════════════════════════════════════════════
//  ONLINE COUNTER
//
//  ORIGINAL (db.js): session_id use karta tha → har tab = alag count ❌
//  FIX: user_id (device_id) use karta hai → same browser = 1 count ✅
//
//  Kaise kaam karta hai:
//  • user_id key ban jaata hai online_sessions mein
//  • Same browser ke 3 tabs → same key → count = 1
//  • Tab band → leave_online call → key turant hata dena
//  • 90s TTL → agar tab crash ho toh bhi expire ho jaaye
// ════════════════════════════════════════════════════════════

const ONLINE_TTL = 90 * 1000; // 90 seconds

engine.on("ping_online", async ({ user_id }) => {
  if (!user_id) return engine._err(400, "user_id required");

  let online_count = 0;
  await sync.patchBin((rec) => {
    rec.online_sessions = rec.online_sessions || {};

    // Same key overwrite → multiple tabs = 1 entry
    rec.online_sessions[user_id] = Date.now();

    // Expire purane sessions
    const now = Date.now();
    for (const [k, ts] of Object.entries(rec.online_sessions)) {
      if (now - ts >= ONLINE_TTL) delete rec.online_sessions[k];
    }

    online_count = Object.keys(rec.online_sessions).length;
    return rec;
  });

  return engine._ok({ online_count });
});

engine.on("leave_online", async ({ user_id }) => {
  if (!user_id) return engine._ok();
  await sync.patchBin((rec) => {
    if (rec.online_sessions) delete rec.online_sessions[user_id];
    return rec;
  });
  return engine._ok();
});

engine.on("get_online", async () => {
  const record = await sync.readBin();
  const now    = Date.now();
  const count  = Object.values(record.online_sessions || {})
    .filter(ts => now - ts < ONLINE_TTL).length;
  return engine._ok({ online_count: count });
});

// ════════════════════════════════════════════════════════════
//  ORIGINAL DB.JS ACTIONS — as-is, sirf yahan move kiye
// ════════════════════════════════════════════════════════════

// ── get_stats ─────────────────────────────────────────────────
engine.on("get_stats", async () => {
  const rec  = await sync.readBin();
  const now  = Date.now();
  const online_count = Object.values(rec.online_sessions || {})
    .filter(ts => now - ts < ONLINE_TTL).length;
  return engine._ok({
    video_stats  : rec.video_stats  || {},
    activity_log : rec.activity_log || [],
    cs_uploads   : rec.cs_uploads   || {},
    online_count,
  });
});

// ── save_stats ────────────────────────────────────────────────
engine.on("save_stats", async ({ video_stats }) => {
  if (!video_stats || typeof video_stats !== "object")
    return engine._err(400, "video_stats object required");

  await sync.patchBin((rec) => {
    rec.video_stats = rec.video_stats || {};
    Object.assign(rec.video_stats, video_stats);
    return rec;
  });
  return engine._ok();
});

// ── log_activity ──────────────────────────────────────────────
engine.on("log_activity", async ({ type, data }) => {
  if (!type) return engine._err(400, "type required");
  await sync.patchBin((rec) => {
    const log = rec.activity_log || [];
    log.unshift({ type, data: data || {}, ts: Date.now() });
    if (log.length > 100) log.length = 100;
    rec.activity_log = log;
    return rec;
  });
  return engine._ok();
});

// ── get_activity ──────────────────────────────────────────────
engine.on("get_activity", async ({ limit = 50 }) => {
  const rec = await sync.readBin();
  return engine._ok({ activity_log: (rec.activity_log || []).slice(0, limit) });
});

// ── clear_activity ────────────────────────────────────────────
engine.on("clear_activity", async () => {
  await sync.patchBin((rec) => { rec.activity_log = []; return rec; });
  return engine._ok();
});

// ── save_uploads ──────────────────────────────────────────────
engine.on("save_uploads", async ({ cs_uploads, email }) => {
  if (!Array.isArray(cs_uploads))
    return engine._err(400, "cs_uploads array required");

  await sync.patchBin((rec) => {
    rec.cs_uploads = rec.cs_uploads || {};
    rec.cs_uploads[email || "_global"] = cs_uploads;
    return rec;
  });
  return engine._ok();
});

// ── get_uploads ───────────────────────────────────────────────
engine.on("get_uploads", async ({ email }) => {
  const rec = await sync.readBin();
  const all = rec.cs_uploads || {};
  return engine._ok({ cs_uploads: email ? (all[email] || []) : (all["_global"] || []) });
});

// ════════════════════════════════════════════════════════════
//  VIEWS
//  Frontend sessionStorage tab reload block karta hai.
//  Server sirf increment karta hai — koi restriction nahi.
// ════════════════════════════════════════════════════════════

engine.on("add_view", async ({ video_id }) => {
  if (!video_id) return engine._err(400, "video_id required");
  let count = 0;
  await sync.patchBin((rec) => {
    rec.video_views = rec.video_views || {};
    rec.video_views[video_id] = (rec.video_views[video_id] || 0) + 1;
    count = rec.video_views[video_id];
    return rec;
  });
  return engine._ok({ video_id, count });
});

engine.on("get_views", async ({ video_id }) => {
  if (!video_id) return engine._err(400, "video_id required");
  const rec = await sync.readBin();
  return engine._ok({ video_id, count: rec.video_views?.[video_id] || 0 });
});

// ════════════════════════════════════════════════════════════
//  LIKES
//  Server sirf counter rakhta hai.
//  Frontend localStorage se per-device ek like ensure karta hai.
// ════════════════════════════════════════════════════════════

engine.on("like_video", async ({ video_id }) => {
  if (!video_id) return engine._err(400, "video_id required");
  let count = 0;
  await sync.patchBin((rec) => {
    rec.video_likes = rec.video_likes || {};
    rec.video_likes[video_id] = (rec.video_likes[video_id] || 0) + 1;
    count = rec.video_likes[video_id];
    return rec;
  });
  return engine._ok({ video_id, count });
});

engine.on("get_likes", async ({ video_id }) => {
  if (!video_id) return engine._err(400, "video_id required");
  const rec = await sync.readBin();
  return engine._ok({ video_id, count: rec.video_likes?.[video_id] || 0 });
});

// ════════════════════════════════════════════════════════════
//  COMMENTS
//  No account needed — nickname + text.
//  device_id sirf delete ownership check ke liye store hota hai.
// ════════════════════════════════════════════════════════════

engine.on("add_comment", async ({ video_id, user_id, name, text }) => {
  if (!video_id)     return engine._err(400, "video_id required");
  if (!text?.trim()) return engine._err(400, "text required");

  const comment = {
    id  : `c_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    uid : user_id || "anon",
    name: (name || "Anonymous").trim(),
    text: text.trim(),
    ts  : Date.now(),
  };

  let total = 0;
  await sync.patchBin((rec) => {
    rec.video_comments = rec.video_comments || {};
    const list = rec.video_comments[video_id] || [];
    list.unshift(comment);
    if (list.length > 500) list.length = 500;
    rec.video_comments[video_id] = list;
    total = list.length;
    return rec;
  });

  return engine._ok({ video_id, comment, total });
});

engine.on("get_comments", async ({ video_id, page = 1, limit = 20 }) => {
  if (!video_id) return engine._err(400, "video_id required");
  const rec   = await sync.readBin();
  const all   = rec.video_comments?.[video_id] || [];
  const start = (page - 1) * limit;
  return engine._ok({
    video_id,
    comments : all.slice(start, start + limit),
    total    : all.length,
    page,
    has_more : start + limit < all.length,
  });
});

engine.on("delete_comment", async ({ video_id, comment_id, user_id }) => {
  if (!video_id || !comment_id) return engine._err(400, "video_id and comment_id required");
  let deleted = false;
  await sync.patchBin((rec) => {
    const list = rec.video_comments?.[video_id] || [];
    const idx  = list.findIndex(c => c.id === comment_id && c.uid === user_id);
    if (idx !== -1) { list.splice(idx, 1); deleted = true; }
    if (rec.video_comments) rec.video_comments[video_id] = list;
    return rec;
  });
  return deleted
    ? engine._ok({ deleted: true })
    : engine._err(403, "Comment not found or not yours");
});

// ════════════════════════════════════════════════════════════
//  SHARES & DOWNLOADS — unlimited counters
// ════════════════════════════════════════════════════════════

engine.on("add_share", async ({ video_id }) => {
  if (!video_id) return engine._err(400, "video_id required");
  let count = 0;
  await sync.patchBin((rec) => {
    rec.video_shares = rec.video_shares || {};
    rec.video_shares[video_id] = (rec.video_shares[video_id] || 0) + 1;
    count = rec.video_shares[video_id];
    return rec;
  });
  return engine._ok({ video_id, count });
});

engine.on("add_download", async ({ video_id }) => {
  if (!video_id) return engine._err(400, "video_id required");
  let count = 0;
  await sync.patchBin((rec) => {
    rec.video_downloads = rec.video_downloads || {};
    rec.video_downloads[video_id] = (rec.video_downloads[video_id] || 0) + 1;
    count = rec.video_downloads[video_id];
    return rec;
  });
  return engine._ok({ video_id, count });
});

engine.on("get_video_counters", async ({ video_id }) => {
  if (!video_id) return engine._err(400, "video_id required");
  const rec = await sync.readBin();
  return engine._ok({
    video_id,
    shares    : rec.video_shares?.[video_id]    || 0,
    downloads : rec.video_downloads?.[video_id] || 0,
  });
});

// ════════════════════════════════════════════════════════════
//  AUTH (optional — site works without login too)
//
//  ORIGINAL auth.js KA BUG:
//  writeUsers() → JSON.stringify({ users }) likhta tha
//  → Iska matlab poora JSONBin sirf { users: {...} } ban jaata tha
//  → videos, likes, comments, views — sab DATA WIPE ho jaata tha ❌
//
//  FIX: Ab patchBin() use karta hai
//  → Pehle poora record padhta hai
//  → Sirf rec.users update karta hai
//  → Baaki sab (video_views, video_likes, etc.) safe rehta hai ✅
// ════════════════════════════════════════════════════════════

engine.on("signup", async ({ email, password, name }) => {
  if (!email || !password) return engine._err(400, "email and password required");

  const key        = email.trim().toLowerCase();
  const hashedPass = await sync.hashPassword(password);

  // patchBin use karo — sirf users update hoga, baaki data safe rahega
  let userExists = false;
  let newUser    = null;

  await sync.patchBin((rec) => {
    rec.users = rec.users || {};
    if (rec.users[key]) {
      userExists = true;
      return rec; // kuch mat badlo
    }
    rec.users[key] = {
      name  : (name || "User").trim(),
      email : key,
      pass  : hashedPass,
      joined: new Date().toISOString(),
    };
    newUser = { email: key, name: rec.users[key].name };
    return rec;
  });

  if (userExists) return engine._err(200, "Email already registered. Please login!");
  return engine._ok({ user: newUser });
});

engine.on("login", async ({ email, password }) => {
  if (!email || !password) return engine._err(400, "email and password required");

  const key        = email.trim().toLowerCase();
  const hashedPass = await sync.hashPassword(password);
  const rec        = await sync.readBin();
  const user       = (rec.users || {})[key];

  if (!user)                    return engine._err(200, "No account found. Please sign up first!");
  if (user.pass !== hashedPass) return engine._err(200, "Incorrect password. Please try again!");

  return engine._ok({ user: { email: key, name: user.name } });
});

// ════════════════════════════════════════════════════════════

module.exports = engine;
