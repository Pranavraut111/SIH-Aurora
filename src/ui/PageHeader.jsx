/* ═══════════════════════════════════════════════════════════════
   Aurora — the page header every module uses: section, title, one-line
   description, last-updated time (IST + relative) and provenance chips.
   A faint topographic contour pattern sits behind this area only.
   ═══════════════════════════════════════════════════════════════ */
import { Box, Stack, Typography } from '@mui/material';
import { useNow } from '../hooks/useNow';
import { formatRelative, formatTimeIST } from '../lib/format';
import ContourPattern from './ContourPattern';

export default function PageHeader({ section, title, description, updatedAt, updatedLabel = 'Updated', provenance, actions }) {
  const now = useNow(1000);
  return (
    <Box
      component="header"
      sx={{
        position: 'relative',
        isolation: 'isolate',
        // The pattern bleeds to the edges of the content column and up under the app bar gap.
        mx: { xs: -4, md: -8 },
        mt: { xs: -4, md: -6 },
        px: { xs: 4, md: 8 },
        pt: { xs: 5, md: 8 },
        pb: 6,
        mb: 1,
      }}
    >
      <ContourPattern sx={{ zIndex: -1 }} />
      <Box>
        <Box sx={{ minWidth: 0 }}>
          {section && (
            <Typography variant="overline" component="p" sx={{ color: 'text.secondary', display: 'block', mb: 1.5 }}>
              {section}
            </Typography>
          )}
          <Typography variant="h1" data-testid="page-title">{title}</Typography>
          {description && (
            <Typography variant="body1" sx={{ color: 'text.secondary', mt: 2, maxWidth: 720 }}>{description}</Typography>
          )}
        </Box>

        {/* Meta row: provenance on the left, freshness on the right; wraps cleanly at any width. */}
        <Stack direction="row" sx={{ gap: 2, mt: 4, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          {provenance && <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>{provenance}</Stack>}
          {updatedAt != null && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }} data-testid="page-updated">
              {updatedLabel}{' '}
              <Box component="time" dateTime={new Date(updatedAt).toISOString()} sx={{ typography: 'mono', color: 'text.primary' }}>
                {formatTimeIST(updatedAt)}
              </Box>
              {' · '}{formatRelative(updatedAt, now)}
            </Typography>
          )}
          {actions}
        </Stack>
      </Box>
    </Box>
  );
}
