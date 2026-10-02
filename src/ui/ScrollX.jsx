/* Aurora — a horizontally scrollable region for wide tables on phones. Focusable and
   named, so it can be scrolled from the keyboard (axe: scrollable-region-focusable). */
import { Box } from '@mui/material';

export default function ScrollX({ label, children, sx }) {
  return (
    <Box tabIndex={0} role="region" aria-label={label}
      sx={[{ overflowX: 'auto', borderRadius: '6px', '&:focus-visible': { outlineOffset: 2 } }, ...(Array.isArray(sx) ? sx : [sx])]}>
      {children}
    </Box>
  );
}
