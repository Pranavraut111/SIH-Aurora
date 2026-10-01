/* ═══════════════════════════════════════════════════════════════
   Aurora — app bar: product name, station switcher, colour-scheme toggle.
   Status lives in the strip below it; navigation in the sidebar.
   ═══════════════════════════════════════════════════════════════ */
import { AppBar, Box, IconButton, Toolbar, Tooltip, Typography } from '@mui/material';
import { useColorScheme } from '@mui/material/styles';
import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlined from '@mui/icons-material/LightModeOutlined';
import MenuOutlined from '@mui/icons-material/MenuOutlined';
import StationSwitcher from './StationSwitcher';

function ColorSchemeToggle() {
  const { mode, systemMode, setMode } = useColorScheme();
  const current = (mode === 'system' ? systemMode : mode) || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  return (
    <Tooltip title={`Switch to ${next} theme`}>
      <IconButton onClick={() => setMode(next)} aria-label={`Switch to ${next} theme`} data-testid="color-scheme-toggle">
        {current === 'dark' ? <LightModeOutlined fontSize="small" /> : <DarkModeOutlined fontSize="small" />}
      </IconButton>
    </Tooltip>
  );
}

export default function TopBar({ activeStation, onStationChange, isDesktop, onOpenNav }) {
  return (
    <AppBar position="static" className="topbar">
      <Toolbar disableGutters sx={{ px: { xs: 2, md: 4 }, gap: { xs: 2, md: 4 } }}>
        {!isDesktop && (
          <IconButton edge="start" onClick={onOpenNav} aria-label="Open navigation">
            <MenuOutlined />
          </IconButton>
        )}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
          <Box component="img" src="/logo.jpeg" alt="" sx={{ width: 24, height: 24, borderRadius: '4px', flex: 'none' }} />
          <Typography component="span" sx={{ fontWeight: 600, fontSize: 15, letterSpacing: '0.01em' }}>Aurora</Typography>
          <Typography component="span" variant="body2" sx={{ color: 'text.secondary', display: { xs: 'none', lg: 'inline' }, whiteSpace: 'nowrap' }}>
            Antarctic station digital twin
          </Typography>
        </Box>
        <StationSwitcher value={activeStation} onChange={onStationChange} />
        <Box sx={{ flex: 1 }} />
        <ColorSchemeToggle />
      </Toolbar>
    </AppBar>
  );
}
