/* ═══════════════════════════════════════════════════════════════
   Aurora — MUI theme. Built from tokens.js only.

   CSS-variables mode with two colour schemes selected by `data-color-scheme` on
   <html> (dark is the default). The same attribute on any element re-scopes the
   variables, which is how not-yet-migrated panels stay dark inside a light shell
   (see LegacySurface).

   The overrides deliberately move MUI away from stock Material: no elevation
   shadows on surfaces (1 px borders instead), no uppercase buttons, 4/6 px radii,
   denser controls, tabular figures, and no Paper gradient overlay in dark mode.
   ═══════════════════════════════════════════════════════════════ */
import { createTheme } from '@mui/material/styles';
import { fonts, layout, motion, palette, radius, SPACING_UNIT, status, type } from './tokens';

function schemePalette(mode) {
  const p = palette[mode];
  const s = status[mode];
  return {
    mode,
    primary: { main: p.accent.main, dark: p.accent.strong, light: p.accent.strong, contrastText: p.accent.contrastText },
    secondary: { main: p.text.secondary, contrastText: p.surface.base },
    success: { main: s.normal.main, contrastText: p.surface.base },
    warning: { main: s.warning.main, contrastText: p.surface.base },
    error: { main: s.critical.main, contrastText: p.surface.base },
    info: { main: p.accent.main, contrastText: p.accent.contrastText },
    background: { default: p.surface.app, paper: p.surface.base },
    text: { primary: p.text.primary, secondary: p.text.secondary, disabled: p.text.muted },
    divider: p.border.default,
    action: {
      hover: mode === 'dark' ? 'rgba(231, 234, 238, 0.06)' : 'rgba(23, 27, 33, 0.05)',
      selected: p.accent.tint,
      focus: p.accent.tint,
    },
    // Aurora-specific groups, available as theme.vars.palette.aurora.* / .status.*
    aurora: {
      surfaceRaised: p.surface.raised,
      surfaceOverlay: p.surface.overlay,
      borderSubtle: p.border.subtle,
      borderControl: p.border.control,
      textMuted: p.text.muted,
      accentTint: p.accent.tint,
    },
    status: {
      normal: s.normal.main, normalTint: s.normal.tint,
      warning: s.warning.main, warningTint: s.warning.tint,
      critical: s.critical.main, criticalTint: s.critical.tint,
      offline: s.offline.main, offlineTint: s.offline.tint,
      simulated: s.simulated.main, simulatedTint: s.simulated.tint,
    },
  };
}

const px = (n) => `${n}px`;
const t = (k) => ({ ...type[k], fontSize: px(type[k].fontSize), lineHeight: px(type[k].lineHeight) });

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'data-color-scheme', cssVarPrefix: 'aur' },
  defaultColorScheme: 'dark',
  colorSchemes: { dark: { palette: schemePalette('dark') }, light: { palette: schemePalette('light') } },
  spacing: SPACING_UNIT,
  shape: { borderRadius: radius.card },
  typography: {
    fontFamily: fonts.ui,
    fontSize: type.body.fontSize,
    htmlFontSize: 16,
    h1: t('pageTitle'),
    h2: t('title'),
    h3: { ...t('title'), fontSize: '14px', lineHeight: '20px' },
    h4: t('label'), h5: t('label'), h6: t('label'),
    subtitle1: t('title'),
    subtitle2: { ...t('label'), textTransform: 'none' },
    body1: t('body'),
    body2: t('bodySm'),
    caption: t('caption'),
    overline: { ...t('label'), textTransform: 'uppercase', letterSpacing: '0.06em' },
    button: { ...t('body'), fontWeight: 600, textTransform: 'none' },
    // Custom variants
    kpi: { ...t('kpi'), fontFamily: fonts.mono, fontVariantNumeric: 'tabular-nums' },
    mono: { fontFamily: fonts.mono, fontSize: '13px', lineHeight: '18px', fontVariantNumeric: 'tabular-nums' },
  },
  transitions: {
    duration: {
      shortest: motion.duration.short, shorter: motion.duration.short, short: motion.duration.standard,
      standard: motion.duration.standard, complex: motion.duration.enter,
      enteringScreen: motion.duration.enter, leavingScreen: motion.duration.exit,
    },
    easing: { easeInOut: motion.easing, easeOut: motion.easing, easeIn: motion.easing, sharp: motion.easing },
  },
  shadows: Array(25).fill('none').map((v, i) => (i === 8 ? '0 8px 24px rgba(0, 0, 0, 0.28)' : v)),
  zIndex: { appBar: 1200, drawer: 1100 },
  components: {
    MuiCssBaseline: {
      styleOverrides: (theme) => ({
        'html, body, #root': { height: '100%' },
        body: {
          backgroundColor: theme.vars.palette.background.default,
          fontFeatureSettings: '"tnum" 1, "cv01" 1',
          WebkitFontSmoothing: 'antialiased',
        },
        ':focus-visible': { outline: `2px solid ${theme.vars.palette.primary.main}`, outlineOffset: 2 },
        '@media (prefers-reduced-motion: reduce)': {
          '*, *::before, *::after': {
            animationDuration: '0.01ms !important',
            animationIterationCount: '1 !important',
            transitionDuration: '0.01ms !important',
            scrollBehavior: 'auto !important',
          },
        },
      }),
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: { backgroundImage: 'none' },
        outlined: ({ theme }) => ({ borderColor: theme.vars.palette.divider }),
      },
    },
    MuiCard: {
      defaultProps: { variant: 'outlined' },
      styleOverrides: { root: { borderRadius: radius.card } },
    },
    MuiCardContent: { styleOverrides: { root: { padding: 16, '&:last-child': { paddingBottom: 16 } } } },
    MuiAppBar: {
      defaultProps: { elevation: 0, color: 'inherit' },
      styleOverrides: {
        root: ({ theme }) => ({
          backgroundColor: theme.vars.palette.background.paper,
          borderBottom: `1px solid ${theme.vars.palette.divider}`,
        }),
      },
    },
    MuiToolbar: { styleOverrides: { root: { minHeight: `${layout.appBarHeight}px !important` } } },
    MuiButtonBase: { defaultProps: { disableRipple: true } },
    MuiButton: {
      defaultProps: { disableElevation: true, size: 'medium' },
      styleOverrides: {
        root: { borderRadius: radius.control, minHeight: 32, paddingInline: 12, paddingBlock: 4, gap: 6 },
        sizeSmall: { minHeight: 28, paddingInline: 10, fontSize: '13px' },
        outlined: ({ theme }) => ({ borderColor: theme.vars.palette.aurora.borderControl, color: theme.vars.palette.text.primary }),
        text: ({ theme }) => ({ color: theme.vars.palette.text.primary }),
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: radius.control,
          color: theme.vars.palette.text.secondary,
          '&:hover': { color: theme.vars.palette.text.primary },
        }),
        sizeSmall: { padding: 6 },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: radius.control, height: 22, fontSize: '12px', fontWeight: 500 },
        label: { paddingInline: 8 },
        outlined: ({ theme }) => ({ borderColor: theme.vars.palette.divider }),
        icon: { fontSize: 14, marginLeft: 6 },
      },
    },
    MuiTooltip: {
      defaultProps: { arrow: false, enterDelay: 400, disableInteractive: true },
      styleOverrides: {
        tooltip: ({ theme }) => ({
          backgroundColor: theme.vars.palette.aurora.surfaceOverlay,
          color: theme.vars.palette.text.primary,
          border: `1px solid ${theme.vars.palette.divider}`,
          fontSize: '12px',
          lineHeight: '16px',
          padding: '6px 8px',
          maxWidth: 320,
        }),
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: ({ theme }) => ({ backgroundColor: theme.vars.palette.background.paper, borderColor: theme.vars.palette.divider }),
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: ({ theme }) => ({
          border: `1px solid ${theme.vars.palette.divider}`,
          boxShadow: theme.shadows[8],
          backgroundColor: theme.vars.palette.aurora.surfaceOverlay,
        }),
      },
    },
    MuiDialogTitle: { styleOverrides: { root: { ...t('title'), padding: '16px 20px 8px' } } },
    MuiDialogContent: { styleOverrides: { root: { padding: '8px 20px' } } },
    MuiDialogActions: { styleOverrides: { root: { padding: '12px 20px 16px', gap: 8 } } },
    MuiBackdrop: { styleOverrides: { root: { backgroundColor: 'rgba(8, 10, 13, 0.55)' } } },
    MuiMenu: {
      styleOverrides: {
        paper: ({ theme }) => ({ border: `1px solid ${theme.vars.palette.divider}`, boxShadow: theme.shadows[8], backgroundColor: theme.vars.palette.aurora.surfaceOverlay }),
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: radius.control,
          minHeight: 36,
          paddingBlock: 6,
          color: theme.vars.palette.text.secondary,
          '&:hover': { color: theme.vars.palette.text.primary },
          '&.Mui-selected': {
            color: theme.vars.palette.text.primary,
            backgroundColor: theme.vars.palette.aurora.surfaceOverlay,
            boxShadow: `inset 2px 0 0 ${theme.vars.palette.primary.main}`,
            '&:hover': { backgroundColor: theme.vars.palette.aurora.surfaceOverlay },
          },
        }),
      },
    },
    MuiListItemIcon: { styleOverrides: { root: { minWidth: 32, color: 'inherit' } } },
    MuiListItemText: { styleOverrides: { primary: { fontSize: '14px', fontWeight: 500 } } },
    MuiListSubheader: {
      styleOverrides: {
        root: ({ theme }) => ({
          ...t('label'),
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: theme.vars.palette.aurora.textMuted,
          backgroundColor: 'transparent',
          lineHeight: '16px',
          paddingTop: 16,
          paddingBottom: 6,
        }),
      },
    },
    MuiTabs: {
      styleOverrides: {
        root: ({ theme }) => ({ minHeight: 40, borderBottom: `1px solid ${theme.vars.palette.divider}` }),
        indicator: { height: 2 },
      },
    },
    MuiTab: { styleOverrides: { root: { minHeight: 40, textTransform: 'none', fontWeight: 600, paddingInline: 12, minWidth: 0 } } },
    MuiToggleButton: {
      styleOverrides: {
        root: ({ theme }) => ({
          textTransform: 'none',
          fontWeight: 600,
          borderColor: theme.vars.palette.aurora.borderControl,
          color: theme.vars.palette.text.secondary,
          paddingBlock: 4,
          '&.Mui-selected': {
            color: theme.vars.palette.text.primary,
            backgroundColor: theme.vars.palette.aurora.accentTint,
            '&:hover': { backgroundColor: theme.vars.palette.aurora.accentTint },
          },
        }),
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: ({ theme }) => ({ borderColor: theme.vars.palette.aurora.borderSubtle, padding: '8px 12px', fontSize: '13px' }),
        head: ({ theme }) => ({ color: theme.vars.palette.text.secondary, fontWeight: 600, fontSize: '12px' }),
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { borderRadius: radius.control },
        notchedOutline: ({ theme }) => ({ borderColor: theme.vars.palette.aurora.borderControl }),
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: ({ theme }) => ({ height: 4, borderRadius: 2, backgroundColor: theme.vars.palette.aurora.surfaceRaised }),
        bar: { borderRadius: 2 },
      },
    },
    MuiSkeleton: { defaultProps: { animation: 'wave' } },
    MuiAlert: {
      styleOverrides: { root: { borderRadius: radius.card, alignItems: 'flex-start' }, message: { fontSize: '13px' } },
    },
    MuiDivider: { styleOverrides: { root: ({ theme }) => ({ borderColor: theme.vars.palette.divider }) } },
  },
});

export default theme;
