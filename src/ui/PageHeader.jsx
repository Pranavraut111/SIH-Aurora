/* ═══════════════════════════════════════════════════════════════
   Aurora — the page header every module uses: section, title, one-line
   description, last-updated time (IST + relative) and provenance chips.
   ═══════════════════════════════════════════════════════════════ */
import { Box, Stack, Typography } from '@mui/material';
import { useNow } from '../hooks/useNow';
import { formatRelative, formatTimeIST } from '../lib/format';

export default function PageHeader({ section, title, description, updatedAt, provenance, actions }) {
  const now = useNow(1000);
  return (
    <Box component="header" sx={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'flex-end', justifyContent: 'space-between', pb: 5 }}>
      <Box sx={{ minWidth: 0, flex: '1 1 420px' }}>
        {section && (
          <Typography variant="overline" component="p" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
            {section}
          </Typography>
        )}
        <Typography variant="h1" data-testid="page-title">{title}</Typography>
        {description && (
          <Typography variant="body1" sx={{ color: 'text.secondary', mt: 1, maxWidth: 720 }}>{description}</Typography>
        )}
      </Box>

      <Stack sx={{ gap: 2, alignItems: { xs: 'flex-start', md: 'flex-end' }, flex: '0 1 auto' }}>
        {updatedAt != null && (
          <Typography variant="body2" sx={{ color: 'text.secondary' }} data-testid="page-updated">
            Updated{' '}
            <Box component="time" dateTime={new Date(updatedAt).toISOString()} sx={{ typography: 'mono', color: 'text.primary' }}>
              {formatTimeIST(updatedAt)}
            </Box>
            {' · '}{formatRelative(updatedAt, now)}
          </Typography>
        )}
        {provenance && <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', justifyContent: { md: 'flex-end' } }}>{provenance}</Stack>}
        {actions}
      </Stack>
    </Box>
  );
}
