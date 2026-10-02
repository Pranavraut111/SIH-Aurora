/* Aurora — the sidebar as a temporary drawer below the md breakpoint.
   While the product tour drives it, the drawer lets focus go to the tour popover
   (no focus trap, no focus restore), so ← → and the tour buttons keep working. */
import { Drawer } from '@mui/material';
import { NavContent } from './SideNav';

export default function MobileNavDrawer({ open, onClose, tourActive, ...rest }) {
  return (
    <Drawer
      variant="temporary"
      open={open}
      onClose={onClose}
      ModalProps={{ keepMounted: true, disableEnforceFocus: Boolean(tourActive), disableRestoreFocus: Boolean(tourActive), disableAutoFocus: Boolean(tourActive) }}
      slotProps={{ paper: { sx: { width: 280, pt: 2 }, 'data-testid': 'mobile-nav', 'aria-label': 'Navigation' } }}
    >
      <NavContent {...rest} collapsed={false}
        onSelect={(id) => { rest.onSelect(id); onClose(); }}
        onStationChange={(id) => { rest.onStationChange(id); onClose(); }}
        onAction={(id) => { rest.onAction(id); onClose(); }} />
    </Drawer>
  );
}
