/* ═══════════════════════════════════════════════════════════════
   Aurora — wrapper for panels not yet rebuilt on the design system.
   Their stylesheets assume a dark background, so the wrapper pins the dark
   colour scheme (MUI variables re-scope on `data-color-scheme`) and the old
   page background. Removed module by module during Phase 2.
   ═══════════════════════════════════════════════════════════════ */
import { Box } from '@mui/material';

export default function LegacySurface({ children, sx, ...rest }) {
  return (
    <Box
      data-color-scheme="dark"
      data-legacy-surface=""
      sx={[{ backgroundColor: 'var(--bg-base, #0a0813)', color: 'var(--text-primary, #f8fafc)', colorScheme: 'dark' }, ...(Array.isArray(sx) ? sx : [sx])]}
      {...rest}
    >
      {children}
    </Box>
  );
}
