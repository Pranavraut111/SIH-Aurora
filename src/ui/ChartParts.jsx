/* ═══════════════════════════════════════════════════════════════
   Aurora — small chart parts shared by every page's charts: the legend
   (line swatches, so raw vs average is legible without colour alone) and the
   tooltip surface (theme colours + the floating shadow).
   ═══════════════════════════════════════════════════════════════ */
import { Box, Stack } from '@mui/material';

/** items: [{label, color, width = 2, opacity = 1, dash?, dot?}] */
export function ChartLegend({ items, sx }) {
  return (
    <Stack direction="row" component="ul" aria-label="Legend"
      sx={[{ gap: 4, rowGap: 1, m: 0, p: 0, mb: 2, listStyle: 'none', flexWrap: 'wrap' }, ...(Array.isArray(sx) ? sx : [sx])]}>
      {items.map((it) => (
        <Stack key={it.label} direction="row" component="li" sx={{ alignItems: 'center', gap: 1.5, fontSize: 12, color: 'text.secondary' }}>
          {it.dot ? (
            <Box aria-hidden="true" sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: it.color }} />
          ) : it.band ? (
            <Box aria-hidden="true" sx={{ width: 16, height: 8, borderRadius: '2px', backgroundColor: it.color, opacity: it.opacity ?? 0.25 }} />
          ) : (
            <Box component="svg" aria-hidden="true" width={20} height={6} sx={{ flex: 'none', opacity: it.opacity ?? 1 }}>
              <line x1="0" x2="20" y1="3" y2="3" stroke={it.color} strokeWidth={it.width ?? 2}
                strokeDasharray={it.dash === true ? '5 3' : it.dash || undefined} />
            </Box>
          )}
          {it.label}
        </Stack>
      ))}
    </Stack>
  );
}

/** Tooltip container matching the chart theme. */
export function ChartTipBox({ chart, title, children }) {
  return (
    <Box sx={{
      ...chart.tooltip.contentStyle,
      boxShadow: chart.mode === 'dark' ? '0 8px 24px rgba(0,0,0,.45)' : '0 8px 24px rgba(23,27,33,.12)',
    }}>
      {title && <Box sx={{ color: chart.tooltip.labelStyle.color, mb: 0.5 }}>{title}</Box>}
      {children}
    </Box>
  );
}
