// api/auth.js — Vercel Serverless Function
// Firebase Authentication — signup & login handle karta hai

const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getAuth }                       = require('firebase-admin/auth');
const { getFirestore }                  = require('firebase-admin/firestore');

// ── Firebase init ─────────────────────────────────────────────────
function getServices() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  }
  return { auth: getAuth(), db: getFirestore() };
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
  if (req.method === 'OPTIONS') return res.status(200).setHeaders(CORS).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { action, email, password, name } = body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const { auth, db } = getServices();

  // ── SIGNUP ────────────────────────────────────────────────────
  if (action === 'signup') {
    try {
      const userRecord = await auth.createUser({
        email,
        password,
        displayName: name || 'Creator',
      });

      await db.collection('users').doc(userRecord.uid).set({
        email,
        name:       name || 'Creator',
        uid:        userRecord.uid,
        joined:     new Date().toISOString(),
        uploads:    0,
        totalViews: 0,
      });

      return res.status(200).json({
        success: true,
        user: { email, name: name || 'Creator', uid: userRecord.uid },
      });

    } catch (err) {
      if (err.code === 'auth/email-already-exists')
        return res.status(400).json({ error: 'This email is already registered. Please login.' });
      if (err.code === 'auth/invalid-email')
        return res.status(400).json({ error: 'Invalid email address.' });
      if (err.code === 'auth/weak-password')
        return res.status(400).json({ error: 'Password must be at least 6 characters.' });

      console.error('[auth/signup]', err);
      return res.status(500).json({ error: 'Signup failed. Please try again.' });
    }
  }

  // ── LOGIN ─────────────────────────────────────────────────────
  if (action === 'login') {
    try {
      const fbRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.FIREBASE_WEB_API_KEY}`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ email, password, returnSecureToken: true }),
        }
      );
      const fbData = await fbRes.json();

      if (fbData.error) {
        const code = fbData.error.message;
        if (code === 'EMAIL_NOT_FOUND' || code === 'INVALID_PASSWORD' || code === 'INVALID_LOGIN_CREDENTIALS')
          return res.status(401).json({ error: 'Invalid email or password.' });
        if (code === 'USER_DISABLED')
          return res.status(403).json({ error: 'Your account has been disabled.' });
        return res.status(401).json({ error: 'Login failed. Please try again.' });
      }

      const uid      = fbData.localId;
      const userSnap = await db.collection('users').doc(uid).get();
      const profile  = userSnap.exists ? userSnap.data() : {};

      return res.status(200).json({
        success: true,
        user: {
          email,
          name: profile.name || fbData.displayName || 'Creator',
          uid,
        },
      });

    } catch (err) {
      console.error('[auth/login]', err);
      return res.status(500).json({ error: 'Login failed. Please try again.' });
    }
  }

  return res.status(400).json({ error: `Unknown action: ${action}` });
};
