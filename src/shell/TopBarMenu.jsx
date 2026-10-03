/* Aurora — the top bar's ⋮ menu (loaded on first open). On phones: search,
   telemetry link, event log, demo control, the tour, shortcuts, colour scheme and the
   telemetry time. In judge mode it is shown at every width and also holds Team
   sign-in, Share this view and About Aurora; the phone-only items stay phone-only. */
import { Divider, ListItemIcon, ListItemText, Menu, MenuItem, Typography } from '@mui/material';
import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined';
import HistoryOutlined from '@mui/icons-material/HistoryOutlined';
import KeyboardOutlined from '@mui/icons-material/KeyboardOutlined';
import TourOutlined from '@mui/icons-material/TourOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import LightModeOutlined from '@mui/icons-material/LightModeOutlined';
import ScienceOutlined from '@mui/icons-material/ScienceOutlined';
import LockOutlined from '@mui/icons-material/LockOutlined';
import LinkOutlined from '@mui/icons-material/LinkOutlined';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import PlayCircleOutlineOutlined from '@mui/icons-material/PlayCircleOutlineOutlined';
import SensorsOutlined from '@mui/icons-material/SensorsOutlined';
import SensorsOffOutlined from '@mui/icons-material/SensorsOffOutlined';

export default function TopBarMenu({
  anchorEl, onClose, isConnected, demoActive, scheme, telemetryTime, sourceLabel,
  onOpenLink, onToggleTimeline, onOpenDemo, onOpenPalette, onOpenHelp, onStartTour,
  phoneOnly = false, onTeamSignIn, onShare, onAbout, onStories,
}) {
  const pick = (fn) => () => { onClose(); fn(); };
  // Items already in the bar on wider screens are only listed on phones.
  const phone = phoneOnly ? { display: { xs: 'flex', sm: 'none' } } : undefined;
  return (
    <Menu
      anchorEl={anchorEl}
      open={Boolean(anchorEl)}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      slotProps={{ paper: { sx: { minWidth: 248, mt: 1 } } }}
    >
      {onStories && (
        <MenuItem onClick={pick(onStories)} data-testid="menu-stories">
          <ListItemIcon><PlayCircleOutlineOutlined fontSize="small" /></ListItemIcon>
          <ListItemText primary="Play a scenario" secondary="Guided two-minute stories" />
        </MenuItem>
      )}
      {onShare && (
        <MenuItem onClick={pick(onShare)} data-testid="menu-share">
          <ListItemIcon><LinkOutlined fontSize="small" /></ListItemIcon>
          <ListItemText primary="Share this view" secondary="Copy a link to this page and station" />
        </MenuItem>
      )}
      {onAbout && (
        <MenuItem onClick={pick(onAbout)} data-testid="menu-about">
          <ListItemIcon><InfoOutlined fontSize="small" /></ListItemIcon>
          <ListItemText primary="About Aurora" />
        </MenuItem>
      )}
      {onTeamSignIn && (
        <MenuItem onClick={pick(onTeamSignIn)} data-testid="menu-team-signin" data-tour="team-signin">
          <ListItemIcon><LockOutlined fontSize="small" /></ListItemIcon>
          <ListItemText primary="Team sign-in" secondary="Changes the shared station (Aurora team only)" />
        </MenuItem>
      )}
      {(onShare || onAbout || onTeamSignIn || onStories) && <Divider sx={phone} />}
      <MenuItem onClick={pick(onOpenPalette)} data-testid="menu-palette" sx={phone}>
        <ListItemIcon><SearchOutlined fontSize="small" /></ListItemIcon>
        <ListItemText primary="Search and commands" />
      </MenuItem>
      <MenuItem onClick={pick(onOpenLink)} sx={phone}>
        <ListItemIcon>{isConnected ? <SensorsOutlined fontSize="small" /> : <SensorsOffOutlined fontSize="small" />}</ListItemIcon>
        <ListItemText primary={isConnected ? 'Satellite link: up' : 'Satellite link: down (simulated)'} />
      </MenuItem>
      <MenuItem onClick={pick(onToggleTimeline)} sx={phone}>
        <ListItemIcon><HistoryOutlined fontSize="small" /></ListItemIcon>
        <ListItemText primary="Event log" />
      </MenuItem>
      <MenuItem onClick={pick(onOpenDemo)} data-testid="menu-demo-control" data-tour="demo-control-menu" sx={phone}>
        <ListItemIcon><ScienceOutlined fontSize="small" /></ListItemIcon>
        <ListItemText primary="Demo control" secondary={demoActive ? 'A scenario is active' : 'Inject a synthetic fault'} />
      </MenuItem>
      <MenuItem onClick={pick(onStartTour)} data-testid="menu-tour">
        <ListItemIcon><TourOutlined fontSize="small" /></ListItemIcon>
        <ListItemText primary="Take the tour" />
      </MenuItem>
      <MenuItem onClick={pick(onOpenHelp)} sx={phone}>
        <ListItemIcon><KeyboardOutlined fontSize="small" /></ListItemIcon>
        <ListItemText primary="Keyboard shortcuts" />
      </MenuItem>
      <MenuItem onClick={pick(scheme.toggle)} sx={phone}>
        <ListItemIcon>{scheme.current === 'dark' ? <LightModeOutlined fontSize="small" /> : <DarkModeOutlined fontSize="small" />}</ListItemIcon>
        <ListItemText primary={`Switch to ${scheme.next} theme`} />
      </MenuItem>
      <Divider sx={phone} />
      <Typography component="div" variant="body2" sx={{ px: 4, py: 1.5, color: 'text.secondary', ...(phone || {}) }}>
        {sourceLabel}{telemetryTime ? ` · ${telemetryTime}` : ''}
      </Typography>
    </Menu>
  );
}
