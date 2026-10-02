/* ═══════════════════════════════════════════════════════════════
   Aurora — Hint: a small tooltip for the always-visible shell.
   MUI Tooltip needs Popper (~30 kB), which would sit in the startup bundle for a
   handful of app-bar and sidebar labels; this positions one fixed-position box
   below (or right of) its trigger instead. Shows after 400 ms on hover and at
   once on keyboard focus, hides on leave/blur/Escape, and is linked to the
   trigger with aria-describedby. Page content keeps using MUI Tooltip.
   ═══════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Box } from '@mui/material';

export default function Hint({ title, placement = 'bottom', children, sx }) {
  const id = useId();
  const anchor = useRef(null);
  const timer = useRef(null);
  const [pos, setPos] = useState(null);

  const show = useCallback((delay) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const el = anchor.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const vw = window.innerWidth;
      // Centred under the trigger, or aligned to its nearer edge close to the viewport sides.
      setPos(placement === 'right' ? { left: r.right + 8, top: r.top + r.height / 2, transform: 'translateY(-50%)' }
        : cx > vw - 168 ? { right: Math.max(vw - r.right, 8), top: r.bottom + 8 }
          : cx < 168 ? { left: Math.max(r.left, 8), top: r.bottom + 8 }
            : { left: cx, top: r.bottom + 8, transform: 'translateX(-50%)' });
    }, delay);
  }, [placement]);
  const hide = useCallback(() => { clearTimeout(timer.current); setPos(null); }, []);

  useEffect(() => {
    if (!pos) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') hide(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', hide, true);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('scroll', hide, true); };
  }, [pos, hide]);
  useEffect(() => () => clearTimeout(timer.current), []);

  if (!title) return children;
  return (
    <Box
      component="span"
      ref={anchor}
      aria-describedby={pos ? id : undefined}
      onMouseEnter={() => show(400)}
      onMouseLeave={hide}
      onFocus={(e) => { if (e.target.matches?.(':focus-visible')) show(0); }}
      onBlur={hide}
      sx={[{ display: 'inline-flex', flex: 'none', minWidth: 0 }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
      {children}
      {pos && (
        <Box
          role="tooltip"
          id={id}
          sx={(theme) => ({
            position: 'fixed',
            ...pos,
            zIndex: theme.zIndex.tooltip,
            maxWidth: 'min(320px, calc(100vw - 16px))',
            width: 'max-content',
            px: 2,
            py: 1.5,
            borderRadius: '6px',
            bgcolor: 'aurora.surfaceOverlay',
            color: 'text.primary',
            border: 1,
            borderColor: 'divider',
            boxShadow: theme.vars?.palette.aurora?.shadowFloat,
            fontSize: 12,
            lineHeight: '16px',
            fontWeight: 400,
            whiteSpace: 'normal',
            pointerEvents: 'none',
          })}
        >
          {title}
        </Box>
      )}
    </Box>
  );
}
