// api/db.js — Vercel Serverless Function
// Firebase Firestore se embed codes, video stats, activity log handle karta hai

const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore }                  = require('firebase-admin/firestore');

// ── Firebase init (cold start pe ek baar) ────────────────────────
function getDB() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
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

// ── Main handler ──────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // Preflight
  if (req.method === 'OPTIONS') return res.status(200).setHeaders(CORS).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { action } = body;
  const db = getDB();

  try {
    // ── 1. GET all stats + uploads on startup ───────────────────
    if (action === 'get_stats') {
      const [statsSnap, actSnap] = await Promise.all([
        db.collection('video_stats').get(),
        db.collection('activity_log').orderBy('ts', 'desc').limit(100).get(),
      ]);

      const video_stats = {};
      statsSnap.forEach(doc => { video_stats[doc.id] = doc.data(); });

      const activity_log = actSnap.docs.map(d => d.data());

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
        type,
        data: data || {},
        ts: Date.now(),
      });
      return res.status(200).json({ success: true });
    }

    // ── 4. SAVE embed codes (CS uploads) for a user ─────────────
    // csUploads = [{ id, title, embedCode, thumb, ts, ... }, ...]
    if (action === 'save_uploads') {
      const { email, cs_uploads } = body;
      if (!email)      return res.status(400).json({ error: 'email required' });
      if (!cs_uploads) return res.status(400).json({ error: 'cs_uploads missing' });

      // Email ko safe Firestore doc ID banao
      const safeEmail = email.toLowerCase().replace(/[^a-z0-9]/g, '_');

      await db.collection('cs_uploads').doc(safeEmail).set(
        { email, uploads: cs_uploads, updatedAt: Date.now() },
        { merge: true }
      );
      return res.status(200).json({ success: true });
    }

    // ── 5. GET embed codes for a user ───────────────────────────
    if (action === 'get_uploads') {
      const { email } = body;
      if (!email) return res.status(400).json({ error: 'email required' });

      const safeEmail = email.toLowerCase().replace(/[^a-z0-9]/g, '_');
      const snap = await db.collection('cs_uploads').doc(safeEmail).get();

      if (!snap.exists) return res.status(200).json({ success: true, cs_uploads: [] });

      const { uploads } = snap.data();
      return res.status(200).json({ success: true, cs_uploads: uploads || [] });
    }

    // ── 6. PING online (heartbeat — active users count) ─────────
    if (action === 'ping_online') {
      const { session_id, ts } = body;
      if (session_id) {
        await db.collection('online_sessions').doc(session_id).set(
          { ts: ts || Date.now(), active: true },
          { merge: true }
        );
      }

      // 3 minute se purane sessions remove karo
      const cutoff = Date.now() - 3 * 60 * 1000;
      const staleSnap = await db.collection('online_sessions')
        .where('ts', '<', cutoff).get();

      const cleanBatch = db.batch();
      staleSnap.forEach(doc => cleanBatch.delete(doc.ref));
      if (!staleSnap.empty) await cleanBatch.commit();

      // Active count
      const activeSnap = await db.collection('online_sessions')
        .where('ts', '>=', cutoff).get();

      return res.status(200).json({ success: true, online_count: activeSnap.size || 1 });
    }

    // ── 7. LEAVE online (tab close) ─────────────────────────────
    if (action === 'leave_online') {
      const { session_id } = body;
      if (session_id) {
        await db.collection('online_sessions').doc(session_id).delete();
      }
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (err) {
    console.error('[db]', err);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
};
