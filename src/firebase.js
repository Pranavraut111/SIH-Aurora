/* ═══════════════════════════════════════════════════════════════
   Aurora — Firebase Configuration
   OFF BY DEFAULT (security: PROJECT_CONTEXT.md §15 / P0-6).
   Firebase (RTDB + Analytics) is initialised ONLY when
     VITE_ENABLE_FIREBASE === "true"  AND  the VITE_FIREBASE_* config is present.
   Otherwise every Firebase call in databaseService / analyticsService is a
   silent no-op (one console.info).

   The SDK is loaded with a dynamic import(), so when Firebase is disabled — the
   default, and the only supported setup — none of it is in the bundle the browser
   downloads. Nothing here touches the network until something asks for the db or
   analytics handle.
   ═══════════════════════════════════════════════════════════════ */

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

/** Synchronous: true only when the flag is on AND the config is complete. */
export const firebaseEnabled = enabledFlag && missing.length === 0;

if (!enabledFlag) {
  console.info('[Firebase] Disabled (set VITE_ENABLE_FIREBASE=true to enable).');
} else if (missing.length > 0) {
  console.info(`[Firebase] Disabled: VITE_ENABLE_FIREBASE=true but config missing (${missing.join(', ')}).`);
}

let initPromise = null;

/** Load the SDK and initialise the app once. Resolves to null when disabled or broken. */
function init() {
  if (!firebaseEnabled) return Promise.resolve(null);
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const [{ initializeApp }, dbMod] = await Promise.all([
        import('firebase/app'),
        import('firebase/database'),
      ]);
      const app = initializeApp(firebaseConfig);
      return { app, db: dbMod.getDatabase(app), dbMod };
    } catch (err) {
      console.error('[Firebase] Initialisation failed:', err);
      return null;
    }
  })();
  return initPromise;
}

/** `{ db, ref, push, set, serverTimestamp }` when Firebase is on, else null. */
export async function getFirebaseDatabase() {
  const inst = await init();
  if (!inst) return null;
  const { ref, push, set, serverTimestamp } = inst.dbMod;
  return { db: inst.db, ref, push, set, serverTimestamp };
}

let analyticsPromise = null;

/** `{ analytics, logEvent }` when Analytics is on and supported, else null. */
export async function getFirebaseAnalytics() {
  if (!firebaseEnabled) return null;
  if (analyticsPromise) return analyticsPromise;
  analyticsPromise = (async () => {
    const inst = await init();
    if (!inst) return null;
    try {
      // Analytics is unavailable in some environments (e.g. no cookies/IndexedDB).
      const mod = await import('firebase/analytics');
      if (!(await mod.isSupported())) return null;
      return { analytics: mod.getAnalytics(inst.app), logEvent: mod.logEvent };
    } catch (err) {
      console.warn('[Firebase] Analytics unavailable:', err.message);
      return null;
    }
  })();
  return analyticsPromise;
}
