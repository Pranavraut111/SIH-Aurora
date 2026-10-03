/* Aurora — guided-story metadata needed at startup (deep links, the availability check);
   the stories themselves (stories.js) load with the tour runner. Startup code: keep tiny.

   Welcome card: shown once on a first visit (localStorage `aurora-welcome-v1`; storage
   errors fall back to memory for this page load), reopened from Help. URL:
   ?story=blizzard|generator|fuel|linkloss starts that story (removed from the URL after reading). */

export const STORY_META = {
  blizzard: { station: 'maitri', scenario: 'blizzard' },
  generator: { station: 'bharati', scenario: 'generator_failure' },
  fuel: { station: 'maitri', scenario: null },
  linkloss: { station: 'bharati', scenario: 'link_loss' },
};

const WELCOME_KEY = 'aurora-welcome-v1';
let welcomeInMemory = false;

export function welcomeSeen() {
  if (welcomeInMemory) return true;
  try {
    return window.localStorage.getItem(WELCOME_KEY) !== null;
  } catch (err) {
    console.warn('[welcome] localStorage unavailable; remembering for this page load only', err);
    return false;
  }
}

export function markWelcomeSeen(choice) {
  welcomeInMemory = true;
  try {
    window.localStorage.setItem(WELCOME_KEY, JSON.stringify({ choice, at: new Date().toISOString() }));
  } catch (err) {
    console.warn('[welcome] could not store the welcome flag', err);
  }
}

/** The story id from ?story=, read once and removed from the URL. */
export function readStoryParam() {
  if (typeof window === 'undefined') return null;
  const p = new URLSearchParams(window.location.search);
  const v = p.get('story');
  if (v === null) return null;
  p.delete('story');
  const q = p.toString();
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${q ? `?${q}` : ''}${window.location.hash}`);
  return Object.hasOwn(STORY_META, v) ? v : null;
}
