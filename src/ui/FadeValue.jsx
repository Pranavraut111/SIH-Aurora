/* ═══════════════════════════════════════════════════════════════
   Aurora — a 150 ms crossfade when a displayed value changes: the old text
   fades out while the new one fades in, stacked in one grid cell (tabular
   figures keep the width steady). prefers-reduced-motion removes it (the
   global rule in theme.js shortens every animation to ~0).
   Screen readers only ever see the current text.
   ═══════════════════════════════════════════════════════════════ */
import { useEffect, useState } from 'react';
import { Box } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import { motion } from '../theme/tokens';

const fadeIn = keyframes`from { opacity: 0; } to { opacity: 1; }`;
const fadeOut = keyframes`from { opacity: 1; } to { opacity: 0; }`;

export default function FadeValue({ children }) {
  const text = String(children ?? '');
  const [state, setState] = useState({ text, prev: null, gen: 0 });
  // A new value: remember the outgoing text for one crossfade (state adjusted during render).
  if (state.text !== text) setState({ text, prev: state.text, gen: state.gen + 1 });

  const { prev, gen } = state;
  useEffect(() => {
    if (prev == null) return undefined;
    const t = setTimeout(() => setState((s) => (s.gen === gen ? { ...s, prev: null } : s)), motion.duration.value);
    return () => clearTimeout(t);
  }, [prev, gen]);

  const anim = (k) => `${k} ${motion.duration.value}ms ${motion.easing} both`;
  return (
    <Box component="span" sx={{ display: 'inline-grid', '& > span': { gridArea: '1 / 1' } }}>
      {prev != null && (
        <Box component="span" aria-hidden="true" key={`o${gen}`} sx={{ animation: anim(fadeOut) }}>{prev}</Box>
      )}
      <Box component="span" key={`n${gen}`} sx={{ animation: prev != null ? anim(fadeIn) : 'none' }}>{text}</Box>
    </Box>
  );
}
