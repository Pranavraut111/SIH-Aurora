/* ═══════════════════════════════════════════════════════════════
   Aurora — theme provider: MUI theme (CSS variables, dark/light) + baseline.
   The chosen mode is remembered per browser by MUI (localStorage key
   "aurora-color-scheme"); with nothing stored it is dark, whatever the OS prefers.
   ═══════════════════════════════════════════════════════════════ */
import { CssBaseline, ThemeProvider } from '@mui/material';
import theme from './theme';

export default function AppThemeProvider({ children }) {
  return (
    <ThemeProvider theme={theme} defaultMode="dark" modeStorageKey="aurora-color-scheme" disableTransitionOnChange>
      <CssBaseline enableColorScheme />
      {children}
    </ThemeProvider>
  );
}
