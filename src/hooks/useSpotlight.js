/* ═══════════════════════════════════════════════════════════════
   useSpotlight — Cursor-following radial glow on glass cards
   Usage: const { ref, style } = useSpotlight();
   Apply ref to the card element, spread style to get --spot-x/y.
   ═══════════════════════════════════════════════════════════════ */
import { useRef, useState, useCallback } from 'react';

export function useSpotlight(radius = 200) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ x: -1000, y: -1000 });

  const handleMove = useCallback((e) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  }, []);

  const handleLeave = useCallback(() => {
    setPos({ x: -1000, y: -1000 });
  }, []);

  const style = {
    '--spot-x': `${pos.x}px`,
    '--spot-y': `${pos.y}px`,
    '--spot-radius': `${radius}px`,
  };

  return { ref, style, handleMove, handleLeave };
}
