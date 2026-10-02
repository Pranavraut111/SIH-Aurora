/* ═══════════════════════════════════════════════════════════════
   Aurora — Suspense placeholder for lazily loaded panels: a quiet skeleton
   of the page header and a card, so the layout does not jump when the chunk
   arrives (a few ms once cached).
   ═══════════════════════════════════════════════════════════════ */
import { Box, Skeleton } from '@mui/material';

export default function PanelFallback({ name = 'Panel' }) {
  return (
    <Box role="status" aria-live="polite" data-testid="panel-fallback" sx={{ py: 2 }}>
      <Box component="span" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Loading {name.toLowerCase()}…</Box>
      <Skeleton variant="text" width={180} sx={{ fontSize: 14 }} />
      <Skeleton variant="text" width="40%" sx={{ fontSize: 30 }} />
      <Skeleton variant="rounded" height={160} sx={{ mt: 4, borderRadius: '12px' }} />
    </Box>
  );
}
