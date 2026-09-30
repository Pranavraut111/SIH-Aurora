/* ═══════════════════════════════════════════════════════════════
   Aurora — Firebase Configuration
   OFF BY DEFAULT (security: PROJECT_CONTEXT.md §15 / P0-6).
   Firebase (RTDB + Analytics) is initialised ONLY when
     VITE_ENABLE_FIREBASE === "true"  AND  the VITE_FIREBASE_* config is present.
   Otherwise `app`/`db`/analytics are null and every Firebase call in
   databaseService / analyticsService is a silent no-op (one console.info).
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
const enabledFlag = env.VITE_ENABLE_FIREBASE === 'true';

let app = null;
let analytics = null;
let db = null;

if (!enabledFlag) {
  console.info('[Firebase] Disabled (set VITE_ENABLE_FIREBASE=true to enable).');
} else if (missing.length > 0) {
  console.info(`[Firebase] Disabled: VITE_ENABLE_FIREBASE=true but config missing (${missing.join(', ')}).`);
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
