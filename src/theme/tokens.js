/* ═══════════════════════════════════════════════════════════════
   Aurora — design tokens (docs/ui-redesign.md §2). The ONE place colours, type,
   spacing, radius, elevation and motion are defined; theme.js feeds them to MUI
   and chartTheme.js to Recharts. Never hardcode a hex value in a component.

   Depth comes from tone, not outlines (v2): the page is the darkest (dark mode) /
   greyest (light mode) layer, cards sit one step lighter, raised wells and hover
   one more step. Hairline borders are kept only where tone alone is too weak
   (cards in light mode, controls). One soft shadow, for floating layers only.

   Every text and status colour below clears WCAG AA (4.5:1) on every surface of
   its mode, and on its own 16 % (dark) / 10 % (light) tint; control borders clear
   the 3:1 non-text minimum. Ratios are recorded in docs/ui-redesign.md.
   ═══════════════════════════════════════════════════════════════ */

export const palette = {
  dark: {
    surface: {
      app: '#0D1014',       // page background
      base: '#171B21',      // cards, app bar, nav (one tonal step up)
      raised: '#1F242C',    // hover, inset wells, selected segments
      overlay: '#252B34',   // menus, dialogs, tooltips
    },
    text: { primary: '#E7EAEE', secondary: '#AAB2BD', muted: '#8C95A1' },
    border: { subtle: '#232830', default: '#2E353F', control: '#646E7C' },
    accent: { main: '#7FB2E5', strong: '#A3C8EE', contrastText: '#0D1014', tint: 'rgba(127, 178, 229, 0.14)' },
  },
  light: {
    surface: { app: '#F1F3F6', base: '#FFFFFF', raised: '#F5F6F8', overlay: '#FFFFFF' },
    text: { primary: '#171B21', secondary: '#454E5A', muted: '#5C6672' },
    border: { subtle: '#E3E6EB', default: '#D3D8DE', control: '#8A939E' },
    accent: { main: '#1F5E9E', strong: '#174A7D', contrastText: '#FFFFFF', tint: 'rgba(31, 94, 158, 0.09)' },
  },
};

/** Status colours are reserved for status — never for decoration or categories. */
export const status = {
  dark: {
    normal: { main: '#5DBB86', tint: 'rgba(93, 187, 134, 0.16)' },
    warning: { main: '#E0A84A', tint: 'rgba(224, 168, 74, 0.16)' },
    critical: { main: '#F0716A', tint: 'rgba(240, 113, 106, 0.16)' },
    offline: { main: '#9AA3AE', tint: 'rgba(154, 163, 174, 0.16)' },
    simulated: { main: '#A99BE8', tint: 'rgba(169, 155, 232, 0.16)' },
  },
  light: {
    normal: { main: '#17703F', tint: 'rgba(23, 112, 63, 0.10)' },
    warning: { main: '#8A5800', tint: 'rgba(138, 88, 0, 0.10)' },
    critical: { main: '#B3261E', tint: 'rgba(179, 38, 30, 0.10)' },
    offline: { main: '#5C6672', tint: 'rgba(92, 102, 114, 0.10)' },
    simulated: { main: '#5B47B3', tint: 'rgba(91, 71, 179, 0.10)' },
  },
};

/**
 * Categorical ramp for breakdowns: two hues, blue → teal, ordered so neighbours
 * alternate in both hue and lightness (adjacent segments stay distinguishable,
 * including for deuteranopes, where the hue step collapses but lightness does not).
 * The teal end stays cyan-leaning so it never reads as the "normal" status green.
 * `rest` is the neutral swatch for "unallocated / other".
 */
export const series = {
  dark: ['#7FB2E5', '#3E8F9E', '#A9CBEF', '#4C79B0', '#7CCBD6'],
  light: ['#1F5E9E', '#4BA3B3', '#123E6B', '#7FA9D6', '#1D6B78'],
};
export const seriesRest = { dark: '#5A6370', light: '#B4BBC4' };

export const fonts = {
  ui: '"IBM Plex Sans Variable", "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace',
};

/**
 * Type scale (px). Nothing in the UI is smaller than 12. Figures (kpi*) are IBM
 * Plex Sans with tabular figures, not mono — mono is for timestamps, ids and code.
 * Labels are small and secondary; values large and primary: the contrast is the
 * hierarchy.
 */
export const type = {
  caption: { fontSize: 12, lineHeight: 16, fontWeight: 500 },
  bodySm: { fontSize: 13, lineHeight: 18, fontWeight: 400 },
  body: { fontSize: 14, lineHeight: 20, fontWeight: 400 },
  label: { fontSize: 13, lineHeight: 18, fontWeight: 500 },
  title: { fontSize: 16, lineHeight: 22, fontWeight: 600 },
  pageTitle: { fontSize: 30, lineHeight: 36, fontWeight: 600, letterSpacing: '-0.02em' },
  kpi: { fontSize: 30, lineHeight: 36, fontWeight: 500, letterSpacing: '-0.02em' },
  kpiHero: { fontSize: 52, lineHeight: 56, fontWeight: 500, letterSpacing: '-0.03em' },
};

/** 4-px base unit: theme.spacing(n) = 4n px. Use 1, 2, 3, 4, 6, 8, 12. */
export const SPACING_UNIT = 4;

export const radius = { control: 8, card: 12, chip: 6 };

/** One shadow, for floating layers only (menus, dialogs, tooltips, popovers). */
export const elevation = {
  dark: '0 12px 32px rgba(0, 0, 0, 0.45), 0 2px 6px rgba(0, 0, 0, 0.3)',
  light: '0 12px 32px rgba(23, 27, 33, 0.12), 0 2px 6px rgba(23, 27, 33, 0.06)',
};

export const motion = {
  // Short and functional: state changes only, never decoration.
  duration: { short: 120, standard: 180, enter: 200, exit: 150, value: 150 },
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
};

export const layout = {
  appBarHeight: 56,
  navWidth: 248,
  navWidthCollapsed: 68,
  contentMaxWidth: 1320,
};
