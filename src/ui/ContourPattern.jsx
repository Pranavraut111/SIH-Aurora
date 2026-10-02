/* ═══════════════════════════════════════════════════════════════
   Aurora — faint topographic contours behind the page header (polar identity,
   docs/ui-redesign.md §10). Nested, roughly parallel closed loops around three
   "summits", generated once at module load from a few low-frequency sines, so
   it is deterministic and costs no asset. Inline SVG (CSP-safe: no data: URI,
   no external file), 1 px strokes in the text colour at 4 % opacity, faded out
   towards the bottom so it never reaches the content. Decorative: aria-hidden.
   ═══════════════════════════════════════════════════════════════ */
import { Box } from '@mui/material';

const VIEW_W = 1200;
const VIEW_H = 260;

// [cx, cy, first radius, ring spacing, rings, phase]
const SUMMITS = [
  [180, 40, 26, 22, 9, 0.3],
  [760, 150, 18, 20, 11, 1.7],
  [1130, 10, 30, 24, 7, 4.1],
];

function ring(cx, cy, r, phase, k) {
  const pts = [];
  const steps = 72;
  for (let i = 0; i <= steps; i += 1) {
    const a = (i / steps) * Math.PI * 2;
    // Shared low-frequency shape per summit, growing slightly with each ring, so rings
    // stay near-parallel like real contours instead of crossing.
    const w = 1 + (0.12 + k * 0.012) * Math.sin(2 * a + phase) + 0.07 * Math.sin(3 * a + phase * 2.3)
      + 0.04 * Math.sin(5 * a + phase * 0.7 + k * 0.15);
    pts.push(`${(cx + r * w * Math.cos(a) * 1.35).toFixed(1)} ${(cy + r * w * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join('L')}Z`;
}

const PATH = SUMMITS.flatMap(([cx, cy, r0, dr, n, ph]) =>
  Array.from({ length: n }, (_, k) => ring(cx, cy, r0 + k * dr, ph, k))).join('');

export default function ContourPattern({ sx }) {
  return (
    <Box
      component="svg"
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="xMidYMin slice"
      sx={[(theme) => ({
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        color: theme.vars.palette.text.primary,
        opacity: 0.045,
        maskImage: 'linear-gradient(to bottom, #000 40%, transparent)',
        WebkitMaskImage: 'linear-gradient(to bottom, #000 40%, transparent)',
      }), ...(Array.isArray(sx) ? sx : [sx])]}
    >
      <path d={PATH} fill="none" stroke="currentColor" strokeWidth={1} vectorEffect="non-scaling-stroke" />
    </Box>
  );
}
