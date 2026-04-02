// api/db.js — Vercel Serverless Function
// Firebase Firestore se embed codes, video stats, activity log handle karta hai

const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue }      = require('firebase-admin/firestore');

// ── Firebase init (cold start pe ek baar) ────────────────────────
function getDB() {
  if (!getApps().length) {
    const projectId   = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey  = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error('Firebase env variables missing: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY');
    }

    initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
    });
  }
  return getFirestore();
}

// ── CORS headers ──────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json',
};

function setCORS(res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
}

// ── Main handler ──────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // Preflight
  if (req.method === 'OPTIONS') {
    setCORS(res);
    return res.status(200).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  setCORS(res);

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { action } = body || {};
  if (!action) return res.status(400).json({ error: 'action field missing' });

  let db;
  try {
    db = getDB();
  } catch (initErr) {
    console.error('[db] Firebase init failed:', initErr.message);
    return res.status(500).json({ error: 'Firebase init failed', detail: initErr.message });
  }

  try {
    // ── 1. GET all stats + activity log on startup ──────────────
    if (action === 'get_stats') {
      const [statsSnap, actSnap] = await Promise.all([
        db.collection('video_stats').get(),
        db.collection('activity_log').get(),
      ]);

      const video_stats = {};
      statsSnap.forEach(doc => { video_stats[doc.id] = doc.data(); });

      const activity_log = actSnap.docs
        .map(d => d.data())
        .sort((a, b) => (b.ts || 0) - (a.ts || 0))
        .slice(0, 100);

      return res.status(200).json({ success: true, video_stats, activity_log });
    }

    // ── 2. SAVE video stats (views, likes, ratings) ─────────────
    if (action === 'save_stats') {
      const { video_stats } = body;
      if (!video_stats || typeof video_stats !== 'object')
        return res.status(400).json({ error: 'video_stats missing' });

      const batch = db.batch();
      Object.entries(video_stats).forEach(([id, stats]) => {
        batch.set(db.collection('video_stats').doc(String(id)), stats, { merge: true });
      });
      await batch.commit();

      return res.status(200).json({ success: true });
    }

    // ── 3. LOG activity (watch, login, signup, upload etc.) ──────
    if (action === 'log_activity') {
      const { type, data } = body;
      await db.collection('activity_log').add({
        type:  type || 'unknown',
        data:  data || {},
        ts:    Date.now(),
      });
      return res.status(200).json({ success: true });
    }

    // ── 4. CLEAR activity log ────────────────────────────────────
    if (action === 'clear_activity') {
      const snap = await db.collection('activity_log').get();
      if (!snap.empty) {
        const chunks = [];
        let chunk = [];
        snap.docs.forEach(doc => {
          chunk.push(doc);
          if (chunk.length === 499) { chunks.push(chunk); chunk = []; }
        });
        if (chunk.length) chunks.push(chunk);

        for (const ch of chunks) {
          const b = db.batch();
          ch.forEach(doc => b.delete(doc.ref));
          await b.commit();
        }
      }
      return res.status(200).json({ success: true });
    }

    // ── 5. SAVE embed codes (CS uploads) for a user ─────────────
    if (action === 'save_uploads') {
      const { email, cs_uploads } = body;
      if (!email)      return res.status(400).json({ error: 'email required' });
      if (!cs_uploads) return res.status(400).json({ error: 'cs_uploads missing' });

      const safeEmail = email.toLowerCase().replace(/[^a-z0-9]/g, '_');
      await db.collection('cs_uploads').doc(safeEmail).set(
        { email, uploads: cs_uploads, updatedAt: Date.now() },
        { merge: true }
      );
      return res.status(200).json({ success: true });
    }

    // ── 6. GET embed codes for a user ───────────────────────────
    if (action === 'get_uploads') {
      const { email } = body;
      if (!email) return res.status(400).json({ error: 'email required' });

      const safeEmail = email.toLowerCase().replace(/[^a-z0-9]/g, '_');
      const snap = await db.collection('cs_uploads').doc(safeEmail).get();

      if (!snap.exists) return res.status(200).json({ success: true, cs_uploads: [] });

      const { uploads } = snap.data();
      return res.status(200).json({ success: true, cs_uploads: uploads || [] });
    }

    // ── 7. PING online (heartbeat — active users count) ─────────
    if (action === 'ping_online') {
      const { session_id, ts } = body;
      const now = ts || Date.now();
      const cutoff = now - 3 * 60 * 1000;

      if (session_id) {
        await db.collection('online_sessions').doc(String(session_id)).set(
          { ts: now, active: true },
          { merge: true }
        );
      }

      const staleSnap = await db.collection('online_sessions')
        .where('ts', '<', cutoff).get();

      if (!staleSnap.empty) {
        const b = db.batch();
        staleSnap.forEach(doc => b.delete(doc.ref));
        await b.commit();
      }

      const activeSnap = await db.collection('online_sessions')
        .where('ts', '>=', cutoff).get();

      return res.status(200).json({ success: true, online_count: activeSnap.size || 1 });
    }

    // ── 8. LEAVE online (tab close) ─────────────────────────────
    if (action === 'leave_online') {
      const { session_id } = body;
      if (session_id) {
        await db.collection('online_sessions').doc(String(session_id)).delete();
      }
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (err) {
    console.error('[db] Error:', err);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
};
