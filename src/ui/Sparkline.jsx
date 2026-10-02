/* ═══════════════════════════════════════════════════════════════
   Aurora — sparkline: a plain SVG line with a faint area under it (≤ 12 % of
   the accent). No chart library, so KPI cards stay light. Decorative: the
   card states the value and the delta in text, so the SVG is aria-hidden.

   points: [[timestampMs, value], …] oldest first. Time maps to x, so gaps in
   the data show as gaps in time rather than being squeezed out. Plotted as
   bucket means (1 h of replay time, or 1 min of wall clock: see
   lib/modelClock) once the window spans 3 buckets: a trend without the
   model's per-tick noise (the full-size charts keep every sample).
   ═══════════════════════════════════════════════════════════════ */
import { Box } from '@mui/material';

import { sparkPath, SPARK_W as W } from './sparkPath';

const VB_H = 40;   // viewBox height; CSS sets the drawn height

export default function Sparkline({ points, height = 32, fill = false, bucketMs = 60_000, sx }) {
  const d = sparkPath(points, VB_H, 2, bucketMs);
  return (
    <Box
      component="svg"
      viewBox={`0 0 ${W} ${VB_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      sx={[(theme) => ({
        display: 'block',
        width: '100%',
        height: fill ? '100%' : height,
        minHeight: height,
        overflow: 'visible',
        color: theme.vars.palette.primary.main,
      }), ...(Array.isArray(sx) ? sx : [sx])]}
    >
      {d ? (
        <>
          <path d={d.area} fill="currentColor" fillOpacity={0.1} stroke="none" />
          <path d={d.line} fill="none" stroke="currentColor" strokeWidth={1.5}
            strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </>
      ) : (
        // Not enough samples yet: a quiet baseline, not an invented curve.
        <line x1="0" x2={W} y1={VB_H - 1} y2={VB_H - 1} stroke="currentColor" strokeOpacity={0.2}
          strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
      )}
    </Box>
  );
}
