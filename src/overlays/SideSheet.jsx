/* Aurora — the right-hand sheet every overlay uses (alert centre aside):
   title, optional subtitle, close button, scrollable body. Follows the theme. */
import { Box, Drawer, IconButton, Stack, Typography } from '@mui/material';
import CloseOutlined from '@mui/icons-material/CloseOutlined';

export default function SideSheet({ open, onClose, title, subtitle, testId, children, width = 420 }) {
  const id = `${testId}-title`;
  return (
    <Drawer anchor="right" open={open} onClose={onClose}
      slotProps={{ paper: { sx: { width: { xs: '100%', sm: width }, borderRadius: { sm: '12px 0 0 12px' } }, 'data-testid': testId, role: 'dialog', 'aria-labelledby': id } }}>
      <Box sx={{ px: 6, pt: 5, pb: 3 }}>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 2 }}>
          <Typography id={id} component="h2" sx={{ fontSize: 20, fontWeight: 600, flex: 1 }}>{title}</Typography>
          <IconButton onClick={onClose} aria-label={`Close ${title.toLowerCase()}`} data-testid={`${testId}-close`}><CloseOutlined /></IconButton>
        </Stack>
        {subtitle && <Typography variant="body2" sx={{ color: 'text.secondary' }}>{subtitle}</Typography>}
      </Box>
      <Box sx={{ flex: 1, overflowY: 'auto', px: 6, pb: 6 }} tabIndex={0} role="region" aria-label={`${title} content`}>{children}</Box>
    </Drawer>
  );
}
