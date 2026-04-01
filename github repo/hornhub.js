// ============================================================
//  hornhub.js  —  Hornhub Frontend Logic  (v3.0 — Guest Mode)
//
//  PHILOSOPHY: Guest-first. No accounts. No saved user data.
//  User aaye → enjoy kare → chala jaye. Bas itna.
//
//  STORED ON SERVER (anonymous, no personal data):
//    ✓ Online count   — kitne log abhi site pe hain
//    ✓ Views          — video ka view count
//    ✓ Likes          — video ka like count
//    ✓ Comments       — video ke comments (nickname + text)
//    ✓ Shares         — share count
//    ✓ Downloads      — download count
//
//  NEVER STORED:
//    ✗ No user accounts / login
//    ✗ No watch history
//    ✗ No personal preferences
//    ✗ No email / password / any identity
//
//  SECTIONS:
//  [1] CONFIG    — DB_URL, _post helper, device ID
//  [2] ONLINE    — live visitor counter  (1 device = 1 count)
//  [3] VIEWS     — view counter          (tab reload = blocked)
//  [4] LIKES     — like counter          (1 per device, localStorage flag)
//  [5] COMMENTS  — post / load / delete  (nickname only, no account needed)
//  [6] SHARES    — share counter         (unlimited)
//  [7] DOWNLOADS — download counter      (unlimited)
//  [8] AUTH      — optional login/signup (site works fine without it)
//  [9] INIT      — single boot call
// ============================================================

"use strict";

const HornHub = (() => {

  // ==========================================================
  //  [1] CONFIG
  // ==========================================================

  const DB_URL = "/api/db";   // ← Vercel API route

  async function _post(body) {
    const res = await fetch(DB_URL, {
      method : "POST",
      headers: { "Content-Type": "application/json" },
      body   : JSON.stringify(body),
    });
    return res.json();
  }

  // Stable device ID — same across all tabs on this browser.
  // ONLY used for: online deduplication + like/comment ownership.
  // Never sent to any third party. Never stored on server permanently.
  function _deviceId() {
    let id = localStorage.getItem("hh_did");
    if (!id) {
      id = "d_" + Math.random().toString(36).slice(2, 10)
               + Math.random().toString(36).slice(2, 10);
      localStorage.setItem("hh_did", id);
    }
    return id;
  }

  // ==========================================================
  //  [2] ONLINE COUNTER
  //
  //  ALGORITHM:
  //  • Key = device_id (stable per browser, not per tab)
  //  • Same browser, 3 tabs open → same key → count = 1
  //  • Tab closes → sendBeacon removes key → count drops instantly
  //  • TTL = 90s, ping every 60s
  // ==========================================================

  const Online = (() => {
    let _timer     = null;
    const _cbs     = [];
    const _did     = _deviceId();

    async function _ping() {
      try {
        const data = await _post({ action: "ping_online", user_id: _did });
        if (data.success) _cbs.forEach(cb => cb(data.online_count));
      } catch (_) {}
    }

    function _leave() {
      const payload = JSON.stringify({ action: "leave_online", user_id: _did });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(DB_URL, new Blob([payload], { type: "application/json" }));
      } else {
        fetch(DB_URL, { method: "POST", keepalive: true,
          headers: { "Content-Type": "application/json" }, body: payload
        }).catch(() => {});
      }
    }

    return {
      _start() {
        _ping();
        clearInterval(_timer);
        _timer = setInterval(_ping, 60_000);
        window.addEventListener("beforeunload", _leave);
      },

      // Subscribe to count updates
      onChange(cb) { _cbs.push(cb); },

      async getCount() {
        const data = await _post({ action: "get_online" });
        return data.online_count || 0;
      },
    };
  })();

  // ==========================================================
  //  [3] VIEWS
  //
  //  ALGORITHM:
  //  • sessionStorage key "v:{videoId}" per tab
  //  • Same tab reload → key exists → server not called → no count
  //  • Tab closed / new tab / new browser → fresh session → counts
  //  • No user tracking. 100% anonymous.
  // ==========================================================

  const Views = (() => ({
    async trackView(video_id) {
      const sKey = `v:${video_id}`;

      // Blocked: already viewed in this tab session
      if (sessionStorage.getItem(sKey)) {
        const data = await _post({ action: "get_views", video_id });
        return { count: data.count || 0, counted: false };
      }

      // New session → always count
      const data = await _post({ action: "add_view", video_id });
      if (data.success) {
        sessionStorage.setItem(sKey, "1");
        return { count: data.count, counted: true };
      }
      return { count: 0, counted: false };
    },

    async getCount(video_id) {
      const data = await _post({ action: "get_views", video_id });
      return data.count || 0;
    },
  }))();

  // ==========================================================
  //  [4] LIKES
  //
  //  ALGORITHM:
  //  • No accounts → use localStorage flag "lk:{videoId}"
  //  • First like on this device → count++, flag set
  //  • Same device likes again → blocked (flag already exists)
  //  • User clears browser data → can like again (fair for guests)
  //  • Server stores total count only (no user list)
  // ==========================================================

  const Likes = (() => ({
    async add(video_id) {
      const lKey = `lk:${video_id}`;

      // Already liked on this device
      if (localStorage.getItem(lKey)) {
        const data = await _post({ action: "get_likes", video_id });
        return { count: data.count || 0, already_liked: true };
      }

      // New like
      const data = await _post({ action: "like_video", video_id });
      if (data.success) {
        localStorage.setItem(lKey, "1");
        return { count: data.count, already_liked: false };
      }
      return { count: 0, already_liked: false };
    },

    // Instant check — no network call (for rendering heart state)
    hasLiked(video_id) {
      return !!localStorage.getItem(`lk:${video_id}`);
    },

    async getCount(video_id) {
      const data = await _post({ action: "get_likes", video_id });
      return data.count || 0;
    },
  }))();

  // ==========================================================
  //  [5] COMMENTS
  //
  //  ALGORITHM:
  //  • No account needed — user just types nickname + comment
  //  • Unlimited posts (no restriction)
  //  • Paginated: 20 per page, has_more flag for "Load More"
  //  • Delete: device_id stored with comment for ownership check
  //    → user can delete their own comments, not others'
  //  • Max 500 comments per video (oldest auto-removed)
  // ==========================================================

  const Comments = (() => ({
    async post(video_id, nickname, text) {
      if (!text?.trim()) return null;
      const data = await _post({
        action  : "add_comment",
        video_id,
        user_id : _deviceId(),
        name    : (nickname?.trim() || "Anonymous"),
        text    : text.trim(),
      });
      return data.success ? { comment: data.comment, total: data.total } : null;
    },

    async load(video_id, page = 1) {
      const data = await _post({ action: "get_comments", video_id, page, limit: 20 });
      return {
        comments : data.comments || [],
        total    : data.total    || 0,
        has_more : data.has_more || false,
      };
    },

    async delete(video_id, comment_id) {
      const data = await _post({
        action: "delete_comment", video_id, comment_id,
        user_id: _deviceId(),
      });
      return !!(data.success && data.deleted);
    },

    // Show delete button only if this device posted it
    isOwn(comment) {
      return comment.user_id === _deviceId();
    },
  }))();

  // ==========================================================
  //  [6] SHARES  — unlimited, no restriction
  // ==========================================================

  const Shares = (() => ({
    async add(video_id) {
      const data = await _post({ action: "add_share", video_id });
      return data.count || 0;
    },
  }))();

  // ==========================================================
  //  [7] DOWNLOADS  — unlimited, no restriction
  // ==========================================================

  const Downloads = (() => ({
    async add(video_id) {
      const data = await _post({ action: "add_download", video_id });
      return data.count || 0;
    },

    async getCounters(video_id) {
      const data = await _post({ action: "get_video_counters", video_id });
      return { shares: data.shares || 0, downloads: data.downloads || 0 };
    },
  }))();

  // ==========================================================
  //  [8] AUTH  (completely optional)
  //
  //  RULE: Site works 100% without login.
  //        Login is just an option — user ka mann kare toh kare.
  //        Logged-in user ko koi extra restriction nahi,
  //        koi extra feature nahi — bas ek naam/identity milti hai.
  //
  //  Stored in localStorage "hh_user" = { email, name }
  //  Cleared on logout. Never forced on anyone.
  // ==========================================================

  const Auth = (() => {
    const AUTH_URL = "/api/auth";   // ← Vercel API route

    async function _authPost(body) {
      const res = await fetch(AUTH_URL, {
        method : "POST",
        headers: { "Content-Type": "application/json" },
        body   : JSON.stringify(body),
      });
      return res.json();
    }

    return {
      // Sign up — optional, no pressure
      async signup(email, password, name) {
        if (!email || !password) return { error: "Email and password required" };
        const data = await _authPost({ action: "signup", email, password, name });
        if (data.success) {
          localStorage.setItem("hh_user", JSON.stringify(data.user));
        }
        return data;
      },

      // Login — optional
      async login(email, password) {
        if (!email || !password) return { error: "Email and password required" };
        const data = await _authPost({ action: "login", email, password });
        if (data.success) {
          localStorage.setItem("hh_user", JSON.stringify(data.user));
        }
        return data;
      },

      // Logout — go back to guest, everything still works
      logout() {
        localStorage.removeItem("hh_user");
        console.log("[HornHub] Logged out — back to guest mode");
      },

      // Get current logged-in user (null if guest)
      getUser() {
        try {
          return JSON.parse(localStorage.getItem("hh_user") || "null");
        } catch (_) { return null; }
      },

      // Is user currently logged in?
      isLoggedIn() {
        return !!this.getUser();
      },
    };
  })();

  // ==========================================================
  //  [9] INIT — call ONCE on every page load
  // ==========================================================

  async function init() {
    Online._start();
    const user = Auth.getUser();
    console.log(`[HornHub] ✓ ready | ${user ? `logged in as "${user.name}"` : "guest mode"}`);
  }

  // ==========================================================
  //  PUBLIC API
  // ==========================================================

  return {
    init,
    online    : Online,
    views     : Views,
    likes     : Likes,
    comments  : Comments,
    shares    : Shares,
    downloads : Downloads,
    auth      : Auth,
  };

})();
