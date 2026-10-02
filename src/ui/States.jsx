/* ═══════════════════════════════════════════════════════════════
   Aurora — loading / empty / error states, the same on every page.
   Errors say what failed and offer a retry; empty states say why there is
   nothing and what would fill it. Never a fake value in their place.
   ═══════════════════════════════════════════════════════════════ */
import { Alert, Box, Button, Skeleton, Stack, Typography } from '@mui/material';

export function LoadingBlock({ height = 280, lines }) {
  if (lines) {
    return <Stack sx={{ gap: 2 }} aria-busy="true">{Array.from({ length: lines }, (_, i) => <Skeleton key={i} variant="text" />)}</Stack>;
  }
  return <Skeleton variant="rounded" height={height} aria-busy="true" />;
}

export function EmptyState({ title, children, height = 220, action }) {
  return (
    <Box sx={{ minHeight: height, display: 'grid', placeItems: 'center', textAlign: 'center', px: 4 }} data-testid="empty-state">
      <Box sx={{ maxWidth: 440 }}>
        {title && <Typography variant="subtitle2" component="p" sx={{ fontWeight: 600, mb: 1 }}>{title}</Typography>}
        {children && <Typography variant="body2" sx={{ color: 'text.secondary' }}>{children}</Typography>}
        {action && <Box sx={{ mt: 3 }}>{action}</Box>}
      </Box>
    </Box>
  );
}

export function ErrorState({ children, onRetry, sx }) {
  return (
    <Alert severity="warning" role="status" sx={sx}
      action={onRetry ? <Button size="small" onClick={onRetry}>Retry</Button> : undefined}>
      {children}
    </Alert>
  );
}
