/* Aurora assistant — per-viewer settings (a browser convenience only: storage can be
   unavailable or cleared, and then the defaults apply for this page load).
   v2: calmer default rate (0.92), a chosen voice, and every incident announced by default
   (the operator asked to be told whenever something happens, not only for their own demos). */
const KEY = 'aurora-assistant-v2';

export const DEFAULT_PREFS = { voice: true, autoNavigate: true, rate: 0.92, conversation: false, lang: 'en', announceAll: true, voiceName: null };

export function loadPrefs() {
  try {
    const raw = window.localStorage.getItem(KEY);
    const p = raw ? JSON.parse(raw) : {};
    return {
      voice: typeof p.voice === 'boolean' ? p.voice : DEFAULT_PREFS.voice,
      autoNavigate: typeof p.autoNavigate === 'boolean' ? p.autoNavigate : DEFAULT_PREFS.autoNavigate,
      rate: Number.isFinite(p.rate) ? Math.min(1.3, Math.max(0.7, p.rate)) : DEFAULT_PREFS.rate,
      conversation: typeof p.conversation === 'boolean' ? p.conversation : DEFAULT_PREFS.conversation,
      lang: p.lang === 'hi' ? 'hi' : 'en',
      announceAll: typeof p.announceAll === 'boolean' ? p.announceAll : DEFAULT_PREFS.announceAll,
      voiceName: typeof p.voiceName === 'string' && p.voiceName ? p.voiceName : null,
    };
  } catch (err) {
    console.warn('[Aurora] settings unavailable; using defaults', err);
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(p) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch (err) {
    console.warn('[Aurora] could not save settings', err);
  }
}
