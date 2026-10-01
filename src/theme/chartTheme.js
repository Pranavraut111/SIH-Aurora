/* ═══════════════════════════════════════════════════════════════
   Aurora — Recharts adopts the theme through this hook.

   Recharts writes colours into SVG presentation attributes, which do not
   resolve CSS variables reliably, so it receives resolved hex values for the
   active colour scheme instead of theme.vars references.
   ═══════════════════════════════════════════════════════════════ */
import { useColorScheme } from '@mui/material/styles';
import { fonts, palette, series, status } from './tokens';

export function chartTheme(mode) {
  const m = mode === 'light' ? 'light' : 'dark';
  const p = palette[m];
  return {
    series: series[m],
    status: Object.fromEntries(Object.entries(status[m]).map(([k, v]) => [k, v.main])),
    grid: p.border.subtle,
    axis: p.border.default,
    tick: { fill: p.text.muted, fontSize: 12, fontFamily: fonts.mono },
    tooltip: {
      contentStyle: {
        background: p.surface.overlay,
        border: `1px solid ${p.border.default}`,
        borderRadius: 4,
        fontSize: 12,
        fontFamily: fonts.ui,
        color: p.text.primary,
        padding: '6px 8px',
      },
      labelStyle: { color: p.text.secondary, marginBottom: 2 },
      itemStyle: { color: p.text.primary, padding: 0 },
      cursor: { stroke: p.border.control, strokeWidth: 1 },
    },
    referenceLine: { warning: status[m].warning.main, critical: status[m].critical.main },
  };
}

/** Chart colours for the colour scheme currently on screen. */
export function useChartTheme() {
  const { mode, systemMode } = useColorScheme();
  return chartTheme(mode === 'system' ? systemMode : mode);
}
