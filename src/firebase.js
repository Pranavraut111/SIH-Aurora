/* ═══════════════════════════════════════════════════════════════
   Aurora — Firebase Configuration
   Config is read from VITE_FIREBASE_* env vars (see .env.example).
   If the required vars are missing, Firebase is NOT initialised and
   `app`, `analytics` and `db` are exported as null — callers must
   treat Firebase as optional.
   ═══════════════════════════════════════════════════════════════ */
import { initializeApp } from 'firebase/app';
import { getAnalytics, isSupported } from 'firebase/analytics';
import { getDatabase } from 'firebase/database';

const env = import.meta.env;

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: env.VITE_FIREBASE_DATABASE_URL,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID,
};

const REQUIRED_KEYS = ['apiKey', 'projectId', 'appId', 'databaseURL'];
const missing = REQUIRED_KEYS.filter((k) => !firebaseConfig[k]);

let app = null;
let analytics = null;
let db = null;

if (missing.length > 0) {
  console.warn(
    `[Firebase] Disabled — missing env vars for: ${missing.join(', ')}. ` +
    'Copy .env.example to .env and fill in VITE_FIREBASE_* to enable persistence.'
  );
} else {
  try {
    app = initializeApp(firebaseConfig);
    db = getDatabase(app);
    // Analytics is unavailable in some environments (e.g. no cookies/IndexedDB)
    isSupported()
      .then((ok) => {
        if (ok) analytics = getAnalytics(app);
      })
      .catch((err) => console.warn('[Firebase] Analytics unavailable:', err.message));
  } catch (err) {
    console.error('[Firebase] Initialisation failed:', err);
    app = null;
    db = null;
  }
}

export const firebaseEnabled = db !== null;
export function getFirebaseAnalytics() {
  return analytics;
}
export { app, db };
export default app;
