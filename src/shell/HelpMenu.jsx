/* Aurora — the Help menu of the top bar (loaded on first open): the product
   tour, this page's tour where there is one, and the keyboard shortcuts. */
import { ListItemIcon, ListItemText, Menu, MenuItem } from '@mui/material';
import KeyboardOutlined from '@mui/icons-material/KeyboardOutlined';
import PlaceOutlined from '@mui/icons-material/PlaceOutlined';
import TourOutlined from '@mui/icons-material/TourOutlined';
import Keys from '../ui/Keys';

export default function HelpMenu({ anchorEl, onClose, onStartTour, pageTourLabel, onStartPageTour, onOpenShortcuts }) {
  const pick = (fn) => () => { onClose(); fn(); };
  return (
    <Menu
      anchorEl={anchorEl}
      open={Boolean(anchorEl)}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      slotProps={{ paper: { sx: { minWidth: 264, mt: 1 }, 'data-testid': 'help-menu' } }}
    >
      <MenuItem onClick={pick(onStartTour)} data-testid="help-tour">
        <ListItemIcon><TourOutlined fontSize="small" /></ListItemIcon>
        <ListItemText primary="Take the tour" secondary="12 steps, about a minute" />
      </MenuItem>
      {pageTourLabel && (
        <MenuItem onClick={pick(onStartPageTour)} data-testid="help-page-tour">
          <ListItemIcon><PlaceOutlined fontSize="small" /></ListItemIcon>
          <ListItemText primary="Tour this page" secondary={pageTourLabel} />
        </MenuItem>
      )}
      <MenuItem onClick={pick(onOpenShortcuts)} data-testid="help-shortcuts">
        <ListItemIcon><KeyboardOutlined fontSize="small" /></ListItemIcon>
        <ListItemText primary="Keyboard shortcuts" />
        <Keys keys={['?']} />
      </MenuItem>
    </Menu>
  );
}
