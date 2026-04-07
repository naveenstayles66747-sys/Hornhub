// api/db.js — Vercel Serverless Function
// Firebase Firestore se video stats, uploads, online counter handle karta hai

const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore }                  = require('firebase-admin/firestore');

// ── Firebase init (cold start pe ek baar) ────────────────────────
function getDB() {
  if (!getApps().length) {
    const projectId   = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey  = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error(
        'Firebase env variables missing: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY'
      );
    }
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
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

// ── Batch chunks — Firestore max 500 ops per batch ───────────────
function chunkArray(arr, size = 499) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

// ── Email → safe Firestore doc ID ────────────────────────────────
function safeEmail(email) {
  return (email || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
}

// ── Main handler ──────────────────────────────────────────────────
module.exports = async function handler(req, res) {
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

    // ── 1. GET stats ──────────────────────────────────────────────
    if (action === 'get_stats') {
      const { email } = body;

      const promises = [db.collection('video_stats').get()];
      if (email) {
        promises.push(db.collection('cs_uploads').doc(safeEmail(email)).get());
      }

      const [statsSnap, uploadsSnap] = await Promise.all(promises);

      const video_stats = {};
      statsSnap.forEach(doc => { video_stats[doc.id] = doc.data(); });

      const response = { success: true, video_stats };

      if (uploadsSnap) {
        response.cs_uploads = uploadsSnap.exists
          ? (uploadsSnap.data().uploads || [])
          : [];
      }

      return res.status(200).json(response);
    }

    // ── 2. SAVE video stats ──────────────────────────────────────
    if (action === 'save_stats') {
      const { video_stats } = body;
      if (!video_stats || typeof video_stats !== 'object')
        return res.status(400).json({ error: 'video_stats missing' });

      const entries = Object.entries(video_stats);
      if (!entries.length) return res.status(200).json({ success: true });

      for (const chunk of chunkArray(entries)) {
        const batch = db.batch();
        chunk.forEach(([id, stats]) => {
          batch.set(db.collection('video_stats').doc(String(id)), stats, { merge: true });
        });
        await batch.commit();
      }

      return res.status(200).json({ success: true });
    }

    // ── 3. SAVE uploads for a user ───────────────────────────────
    if (action === 'save_uploads') {
      const { email, cs_uploads } = body;
      if (!email)
        return res.status(400).json({ error: 'email required' });
      if (!Array.isArray(cs_uploads))
        return res.status(400).json({ error: 'cs_uploads must be an array' });

      await db.collection('cs_uploads').doc(safeEmail(email)).set(
        { email, uploads: cs_uploads, updatedAt: Date.now() },
        { merge: true }
      );
      return res.status(200).json({ success: true });
    }

    // ── 4. GET uploads for a user ────────────────────────────────
    if (action === 'get_uploads') {
      const { email } = body;
      if (!email)
        return res.status(400).json({ error: 'email required' });

      const snap = await db.collection('cs_uploads').doc(safeEmail(email)).get();
      if (!snap.exists) return res.status(200).json({ success: true, cs_uploads: [] });

      return res.status(200).json({
        success:    true,
        cs_uploads: snap.data().uploads || [],
      });
    }

    // ── 5. PING online ───────────────────────────────────────────
    if (action === 'ping_online') {
      const { session_id, ts } = body;
      const now    = ts || Date.now();
      const cutoff = now - 3 * 60 * 1000;

      if (session_id) {
        await db.collection('online_sessions').doc(String(session_id)).set(
          { ts: now, active: true },
          { merge: true }
        );
      }

      const [staleSnap, activeSnap] = await Promise.all([
        db.collection('online_sessions').where('ts', '<', cutoff).get(),
        db.collection('online_sessions').where('ts', '>=', cutoff).get(),
      ]);

      if (!staleSnap.empty) {
        for (const chunk of chunkArray(staleSnap.docs)) {
          const batch = db.batch();
          chunk.forEach(doc => batch.delete(doc.ref));
          await batch.commit();
        }
      }

      return res.status(200).json({
        success:      true,
        online_count: Math.max(activeSnap.size, 1),
      });
    }

    // ── 6. LEAVE online ──────────────────────────────────────────
    if (action === 'leave_online') {
      const { session_id } = body;
      if (session_id) {
        await db.collection('online_sessions').doc(String(session_id)).delete();
      }
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (err) {
    console.error('[db] Error in action:', action, err);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
};
