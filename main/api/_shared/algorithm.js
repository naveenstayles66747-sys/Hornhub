// ============================================================
//  _shared/algorithm.js  —  Hornhub Algorithm Engine
//
//  YE FILE KYA KARTI HAI:
//  db.js   → request aati hai → algorithm.process() call hota hai
//  auth.js → request aati hai → algorithm.process() call hota hai
//  Dono files ka POORA LOGIC yahan hai. Wahan ZERO logic hai.
//
//  ACTIONS:
//  ✅ ping_online, leave_online, get_online
//  ✅ get_stats, save_stats
//  ✅ save_uploads, get_uploads
//  ✅ add_view, get_views
//  ✅ like_video, get_likes
//  ✅ add_comment, get_comments, delete_comment
//  ✅ add_share
//  ✅ add_download, get_video_counters
//  ✅ signup, login
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
    for (const mw of this._middleware) {
      const early = await mw(action, payload);
      if (early) return early;
    }
    const handler = this._handlers.get(action);
    if (!handler) return this._err(400, `Unknown action: "${action}"`);
    try {
      return await handler(payload);
    } catch (err) {
      console.error(`[Algorithm] "${action}" error:`, err.message);
      return this._err(500, "Server error: " + err.message);
    }
  }

  _ok(data = {})      { return { statusCode: 200, headers: CORS, body: { success: true,  ...data } }; }
  _err(code, message) { return { statusCode: code, headers: CORS, body: { success: false, error: message } }; }
}

const engine = new AlgorithmEngine();

engine.use(async (action) => {
  console.log(`[Algorithm] ▶ ${action} | ${new Date().toISOString()}`);
});

// ════════════════════════════════════════════════════════════
//  ONLINE COUNTER
//  user_id (device_id) use karta hai — same browser = 1 count
//  TTL = 90s, ping every 60s
// ════════════════════════════════════════════════════════════

const ONLINE_TTL = 90 * 1000;

engine.on("ping_online", async ({ user_id }) => {
  if (!user_id) return engine._err(400, "user_id required");

  let online_count = 0;
  await sync.patchBin((rec) => {
    rec.online_sessions = rec.online_sessions || {};
    rec.online_sessions[user_id] = Date.now();

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
//  STATS
// ════════════════════════════════════════════════════════════

engine.on("get_stats", async () => {
  const rec  = await sync.readBin();
  const now  = Date.now();
  const online_count = Object.values(rec.online_sessions || {})
    .filter(ts => now - ts < ONLINE_TTL).length;
  return engine._ok({
    video_stats : rec.video_stats || {},
    online_count,
  });
});

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

// ════════════════════════════════════════════════════════════
//  UPLOADS — creator videos save/load
// ════════════════════════════════════════════════════════════

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

engine.on("get_uploads", async ({ email }) => {
  const rec = await sync.readBin();
  const all = rec.cs_uploads || {};
  return engine._ok({ cs_uploads: email ? (all[email] || []) : (all["_global"] || []) });
});

// ════════════════════════════════════════════════════════════
//  VIEWS
//  Frontend sessionStorage tab reload block karta hai.
//  Server sirf increment karta hai.
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
//  Server counter rakhta hai.
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
//  SHARES & DOWNLOADS
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
// ════════════════════════════════════════════════════════════

engine.on("signup", async ({ email, password, name }) => {
  if (!email || !password) return engine._err(400, "email and password required");

  const key        = email.trim().toLowerCase();
  const hashedPass = await sync.hashPassword(password);

  let userExists = false;
  let newUser    = null;

  await sync.patchBin((rec) => {
    rec.users = rec.users || {};
    if (rec.users[key]) {
      userExists = true;
      return rec;
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
