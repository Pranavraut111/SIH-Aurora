/* Aurora — the sidebar as a temporary drawer below the md breakpoint. */
import { Drawer } from '@mui/material';
import { NavContent } from './SideNav';

export default function MobileNavDrawer({ open, onClose, ...rest }) {
  return (
    <Drawer
      variant="temporary"
      open={open}
      onClose={onClose}
      ModalProps={{ keepMounted: true }}
      slotProps={{ paper: { sx: { width: 280, pt: 2 } } }}
    >
      <NavContent {...rest} collapsed={false}
        onSelect={(id) => { rest.onSelect(id); onClose(); }}
        onStationChange={(id) => { rest.onStationChange(id); onClose(); }}
        onAction={(id) => { rest.onAction(id); onClose(); }} />
    </Drawer>
  );
}
