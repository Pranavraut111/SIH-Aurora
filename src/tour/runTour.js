/* ═══════════════════════════════════════════════════════════════
   Aurora — runs a product tour with driver.js (docs/ui-redesign.md §6).
   Loaded on first start, so driver.js and its stylesheet stay out of startup.

   driver.js highlights DOM nodes; this file adds what the app needs around it:
     · before each step: switch page, open/close the phone nav drawer, click a
       tab, then wait for the target to be visible (or show the step centred);
     · Next / Back / Skip tour, "3 of 12", ← → Esc (driver.js), focus on Next
       at every step and back where it was when the tour ends;
     · driver.js's own animation is off: a Next pressed mid-transition left the
       previous target highlighted and swallowed ← →. The popover fades in via
       tour.css instead (not under reduced motion), and scrolling is smooth only
       without reduced motion;
     · themed through tour.css with the app's CSS variables (both schemes).
   ═══════════════════════════════════════════════════════════════ */
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import './tour.css';
import { tourSteps } from './steps';

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

function isVisible(el) {
  if (!el) return false;
  if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.right > 0 && r.left < window.innerWidth;
}

function firstVisible(selectors) {
  for (const sel of selectors) {
    const el = [...document.querySelectorAll(sel)].find(isVisible);
    if (el) return { el, sel };
  }
  return null;
}

/** Poll (per frame) until the target is visible and has stopped moving (drawer slide, lazy page). */
async function waitForTarget(selectors, timeout = 2500) {
  const end = performance.now() + timeout;
  let last = null;
  while (performance.now() < end) {
    const hit = firstVisible(selectors);
    if (hit) {
      const r = hit.el.getBoundingClientRect();
      const pos = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}`;
      if (pos === last) return hit;
      last = pos;
    }
    await new Promise((res) => { requestAnimationFrame(res); });
  }
  return firstVisible(selectors);
}

const text = (v, ctx) => (typeof v === 'function' ? v(ctx) : v);

// driver.js marks the highlighted element as opening its popover (aria-haspopup /
// -expanded / -controls) and strips those attributes again afterwards. On a plain
// <div> that is invalid ARIA (axe aria-allowed-attr), and on a real menu button
// it would erase the button's own values. Keep each target's own values instead.
const ARIA = ['aria-haspopup', 'aria-expanded', 'aria-controls'];
const ownAria = new WeakMap();
function rememberAria(el) {
  if (el && !ownAria.has(el)) ownAria.set(el, ARIA.map((a) => el.getAttribute(a)));
}
function restoreAria(el) {
  const own = el && ownAria.get(el);
  if (!own) return;
  ARIA.forEach((a, i) => (own[i] === null ? el.removeAttribute(a) : el.setAttribute(a, own[i])));
}

/**
 * Start a tour. `app` is supplied by App.jsx:
 *   { drawerNav, isPhone, scheme, writeProtected, stations, returnFocus,
 *     getModule(), goTo(moduleId), setNavOpen(bool), onEnd(outcome) }
 * Returns a stop() function.
 */
export function runTour(kind, app) {
  const defs = tourSteps(kind);
  if (!defs.length) { app.onEnd('empty'); return () => {}; }
  const reduced = reducedMotion();
  const returnFocus = app.returnFocus ?? document.activeElement;
  const total = defs.length;
  let navOpen = false;
  let busy = false;
  let finished = false;
  let outcome = 'closed';

  const steps = defs.map(() => ({ popover: { title: '', description: '' } }));

  async function setNav(open) {
    if (!app.drawerNav || open === navOpen) return;
    navOpen = open;
    app.setNavOpen(open);
    if (!open) await sleep(reduced ? 30 : 260);   // let the drawer slide away before the next highlight
  }

  async function prepare(i) {
    const def = defs[i];
    if (def.page && app.getModule() !== def.page) app.goTo(def.page);
    await setNav(Boolean(def.nav));
    if (def.click) {
      const hit = await waitForTarget([def.click], 2000);
      hit?.el.click();
    }
    const hit = await waitForTarget(def.targets);
    const ctx = { ...app, target: hit?.sel ?? null };
    rememberAria(hit?.el);
    steps[i].element = hit?.el;   // undefined → a centred popover rather than a stuck tour
    steps[i].popover = {
      title: text(def.title, ctx),
      description: text(def.body, ctx),
      showButtons: i === 0 ? ['next'] : ['next', 'previous'],
      side: def.side,
    };
  }

  async function go(i) {
    if (busy || finished) return;
    if (i >= total) { end('completed'); return; }
    if (i < 0) return;
    busy = true;
    try {
      await prepare(i);
      if (!finished) d.moveTo(i);
    } finally {
      busy = false;
    }
  }

  const dark = app.scheme === 'dark';
  const d = driver({
    steps,
    animate: false,
    smoothScroll: !reduced,
    allowClose: true,
    // ← → Esc are handled below: driver.js ignores keys until the frame after a step
    // renders, so a quick arrow press was silently dropped.
    allowKeyboardControl: false,
    overlayClickBehavior: () => {},          // a stray click never ends the tour; Skip or Esc do
    overlayColor: dark ? '#05070A' : '#171B21',
    overlayOpacity: dark ? 0.66 : 0.45,
    stagePadding: 6,
    stageRadius: 10,
    popoverOffset: 12,
    popoverClass: 'aurora-tour',
    showProgress: true,
    progressText: '{{current}} of {{total}}',
    nextBtnText: 'Next',
    prevBtnText: 'Back',
    doneBtnText: 'Done',
    disableActiveInteraction: true,          // the highlighted control is shown, not used, mid-tour
    onHighlighted: (el) => {
      restoreAria(el);
      // Exactly one highlighted element, whatever happened before.
      document.querySelectorAll('.driver-active-element').forEach((other) => {
        if (other === el) return;
        other.classList.remove('driver-active-element', 'driver-no-interaction');
        restoreAria(other);
      });
    },
    onDeselected: (el) => { requestAnimationFrame(() => restoreAria(el)); },
    onNextClick: () => { go((d.getActiveIndex() ?? 0) + 1); },
    onPrevClick: () => { go((d.getActiveIndex() ?? 0) - 1); },
    onPopoverRender: (popover, { state }) => {
      const i = state.activeIndex ?? 0;
      popover.wrapper.setAttribute('data-testid', 'tour-popover');
      popover.wrapper.setAttribute('data-tour-step', String(i + 1));
      popover.wrapper.setAttribute('aria-modal', 'false');
      // driver.js renders the title as a <header>, which at body level is a second
      // banner landmark: swap it for an <h2> with the same id (aria-labelledby).
      const h2 = document.createElement('h2');
      h2.id = popover.title.id;
      h2.className = popover.title.className;
      h2.style.cssText = popover.title.style.cssText;
      h2.textContent = popover.title.textContent;
      popover.title.replaceWith(h2);
      popover.progress.setAttribute('aria-live', 'off');
      popover.previousButton.setAttribute('data-testid', 'tour-back');
      popover.nextButton.setAttribute('data-testid', 'tour-next');
      if (i === total - 1) popover.nextButton.textContent = kind === 'main' ? 'Finish tour' : 'Done';
      if (i < total - 1) {
        const skip = document.createElement('button');
        skip.type = 'button';
        skip.className = 'aurora-tour-skip';
        skip.textContent = 'Skip tour';
        skip.setAttribute('data-testid', 'tour-skip');
        skip.addEventListener('click', () => end('skipped'));
        popover.footerButtons.prepend(skip);
      }
      // driver.js focuses the first control; Next is the one people want.
      requestAnimationFrame(() => popover.nextButton.focus());
    },
    onDestroyed: () => cleanup(),
  });

  // Runs once however the tour ends. driver.js skips onDestroyed when it is destroyed
  // before its first frame (a very quick Esc), so every end path also calls this.
  function cleanup() {
    if (finished) return;
    finished = true;
    document.removeEventListener('keydown', onKey, true);
    if (navOpen) { navOpen = false; app.setNavOpen(false); }
    app.onEnd(outcome);
    // Back to where the person was; else the page's main region.
    const back = returnFocus && returnFocus.isConnected && returnFocus !== document.body ? returnFocus : document.getElementById('main');
    requestAnimationFrame(() => back?.focus({ preventScroll: true }));
  }
  const end = (why) => { outcome = why; d.destroy(); cleanup(); };

  function onKey(e) {
    if (finished || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end('closed'); return; }
    const i = d.getActiveIndex();
    if (i === undefined) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); go(i + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1); }
  }
  document.addEventListener('keydown', onKey, true);

  prepare(0).then(() => { if (!finished) d.drive(0); }).catch((err) => {
    console.error('[tour] could not start', err);
    finished = true;
    app.onEnd('error');
  });

  return () => { if (!finished) end('stopped'); };
}
