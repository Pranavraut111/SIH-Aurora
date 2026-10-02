/* Aurora — a titled card section: title, optional one-line subtitle,
   provenance chip(s) on the right, then content. Tonal surface, no outline
   in dark mode (theme MuiCard). */
import { Box, Card, Stack, Typography } from '@mui/material';

export default function SectionCard({ title, subtitle, provenance, children, testId, sx, contentSx }) {
  return (
    <Card component="section" aria-label={title} data-testid={testId} sx={[{ height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0 }, ...(Array.isArray(sx) ? sx : [sx])]}>
      <Stack direction="row" sx={{ gap: 3, alignItems: 'flex-start', justifyContent: 'space-between', px: { xs: 4, sm: 6 }, pt: { xs: 4, sm: 5 }, pb: 3 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h2">{title}</Typography>
          {subtitle && <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>{subtitle}</Typography>}
        </Box>
        {provenance && <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end', flex: 'none' }}>{provenance}</Stack>}
      </Stack>
      <Box sx={[{ px: { xs: 4, sm: 6 }, pb: { xs: 4, sm: 5 }, flex: 1, minWidth: 0 }, ...(Array.isArray(contentSx) ? contentSx : [contentSx])]}>{children}</Box>
    </Card>
  );
}
