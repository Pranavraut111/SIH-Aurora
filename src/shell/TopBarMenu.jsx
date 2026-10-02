/* Aurora — the phone overflow menu of the top bar (loaded on first open):
   telemetry link, event log, demo control, colour scheme, and the telemetry time. */
import { Divider, ListItemIcon, ListItemText, Menu, MenuItem, Typography } from '@mui/material';
import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined';
import HistoryOutlined from '@mui/icons-material/HistoryOutlined';
import KeyboardOutlined from '@mui/icons-material/KeyboardOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import LightModeOutlined from '@mui/icons-material/LightModeOutlined';
import ScienceOutlined from '@mui/icons-material/ScienceOutlined';
import SensorsOutlined from '@mui/icons-material/SensorsOutlined';
import SensorsOffOutlined from '@mui/icons-material/SensorsOffOutlined';

export default function TopBarMenu({
  anchorEl, onClose, isConnected, demoActive, scheme, telemetryTime, sourceLabel,
  onOpenLink, onToggleTimeline, onOpenDemo, onOpenPalette, onOpenHelp,
}) {
  const pick = (fn) => () => { onClose(); fn(); };
  return (
    <Menu
      anchorEl={anchorEl}
      open={Boolean(anchorEl)}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      slotProps={{ paper: { sx: { minWidth: 248, mt: 1 } } }}
    >
      <MenuItem onClick={pick(onOpenPalette)} data-testid="menu-palette">
        <ListItemIcon><SearchOutlined fontSize="small" /></ListItemIcon>
        <ListItemText primary="Search and commands" />
      </MenuItem>
      <MenuItem onClick={pick(onOpenLink)}>
        <ListItemIcon>{isConnected ? <SensorsOutlined fontSize="small" /> : <SensorsOffOutlined fontSize="small" />}</ListItemIcon>
        <ListItemText primary={isConnected ? 'Telemetry link: up' : 'Telemetry link: cut (simulated)'} />
      </MenuItem>
      <MenuItem onClick={pick(onToggleTimeline)}>
        <ListItemIcon><HistoryOutlined fontSize="small" /></ListItemIcon>
        <ListItemText primary="Event log" />
      </MenuItem>
      <MenuItem onClick={pick(onOpenDemo)} data-testid="menu-demo-control" data-tour="demo-control-menu">
        <ListItemIcon><ScienceOutlined fontSize="small" /></ListItemIcon>
        <ListItemText primary="Demo control" secondary={demoActive ? 'A scenario is active' : 'Inject a synthetic fault'} />
      </MenuItem>
      <MenuItem onClick={pick(onOpenHelp)}>
        <ListItemIcon><KeyboardOutlined fontSize="small" /></ListItemIcon>
        <ListItemText primary="Keyboard shortcuts" />
      </MenuItem>
      <MenuItem onClick={pick(scheme.toggle)}>
        <ListItemIcon>{scheme.current === 'dark' ? <LightModeOutlined fontSize="small" /> : <DarkModeOutlined fontSize="small" />}</ListItemIcon>
        <ListItemText primary={`Switch to ${scheme.next} theme`} />
      </MenuItem>
      <Divider />
      <Typography component="div" variant="body2" sx={{ px: 4, py: 1.5, color: 'text.secondary' }}>
        {sourceLabel}{telemetryTime ? ` · ${telemetryTime}` : ''}
      </Typography>
    </Menu>
  );
}
