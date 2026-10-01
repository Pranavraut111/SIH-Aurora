/* ═══════════════════════════════════════════════════════════════
   Aurora — usePolling: the ONE way panels poll the backend.
   - runs the task immediately, then every `intervalMs` AFTER it finishes
     (no overlapping requests);
   - pauses while the browser tab is hidden and runs again as soon as the
     tab becomes visible;
   - backs off exponentially when the task throws (interval × 2^failures,
     capped at maxBackoffMs) and returns to normal after a success;
   - restarts when `key` changes (e.g. the active station) or `enabled` flips.

   The task receives isActive(); check it before setting state after an
   await, so a stale response never overwrites newer state.
   ═══════════════════════════════════════════════════════════════ */
import { useEffect, useRef } from 'react';

export function nextPollDelay(intervalMs, failures, maxBackoffMs) {
  return Math.min(maxBackoffMs, intervalMs * 2 ** failures);
}

export function usePolling(task, intervalMs, { key = '', enabled = true, maxBackoffMs = 60000 } = {}) {
  const taskRef = useRef(task);
  useEffect(() => {
    taskRef.current = task;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    let stopped = false;
    let running = false;
    let failures = 0;
    let timer = null;
    const isActive = () => !stopped;

    const schedule = (ms) => {
      clearTimeout(timer);
      timer = setTimeout(run, ms);
    };

    async function run() {
      if (stopped || running) return;
      if (typeof document !== 'undefined' && document.hidden) return;   // resumed on visibilitychange
      running = true;
      try {
        await taskRef.current(isActive);
        failures = 0;
      } catch (err) {
        failures += 1;
        console.warn(`[usePolling] task failed (${failures}x); next try in ${nextPollDelay(intervalMs, failures, maxBackoffMs) / 1000}s`, err);
      } finally {
        running = false;
      }
      if (!stopped && !(typeof document !== 'undefined' && document.hidden)) {
        schedule(nextPollDelay(intervalMs, failures, maxBackoffMs));
      }
    }

    const onVisibility = () => {
      if (document.hidden) clearTimeout(timer);
      else schedule(0);
    };
    document.addEventListener('visibilitychange', onVisibility);
    run();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, intervalMs, key, maxBackoffMs]);
}
