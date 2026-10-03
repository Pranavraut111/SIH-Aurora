/* ═══════════════════════════════════════════════════════════════
   Aurora — satellite link banner (simulated store-and-forward, link_buffer.py).
   Shown on every page while the active station's link is down: when contact was
   last made, and how much the station has recorded since (count and size of the
   buffered readings, from the backend). Every figure on screen is the last data
   received and is marked stale meanwhile (App.css, [data-link-down]).
   Loaded only while a link is down, so it costs nothing at startup.
   ═══════════════════════════════════════════════════════════════ */
import { Box, Button, Typography } from '@mui/material';
import { useNow } from '../hooks/useNow';
import { stationMeta } from '../data/stationConfig';
import { formatNumber, formatRelative, formatTimeIST } from '../lib/format';
import { StatusChip } from '../ui/Status';

function formatKB(bytes) {
  return `${formatNumber((bytes || 0) / 1000, 1)} KB`;
}

export default function LinkBanner({ link, activeStation, onOpenLink }) {
  const now = useNow(1000);
  if (!link || link.up) return null;
  const name = stationMeta(activeStation).name;
  const n = link.bufferedReadings || 0;
  return (
    <Box role="status" aria-live="polite" data-testid="link-banner"
      sx={(t) => ({ px: { xs: 3, md: 4 }, py: 1.5, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap',
        bgcolor: t.vars.palette.status.offlineTint, borderBottom: `1px solid ${t.vars.palette.divider}` })}>
      <StatusChip status="offline" label="Link down" />
      <Typography variant="body2" sx={{ flex: 1, minWidth: 220 }}>
        {link.syncing ? (
          <><strong>Link back at {name}:</strong> syncing {formatNumber(n)} readings ({formatKB(link.bufferedBytes)}) now…</>
        ) : (
          <>
            <strong>Satellite link down at {name} (simulated).</strong>{' '}
            Last contact <span data-testid="link-last-contact">{formatTimeIST(link.lastContact)}</span> ({formatRelative(link.lastContact, now)}).
            {' '}The station keeps recording on site:{' '}
            <Box component="span" sx={{ fontWeight: 600, fontFeatureSettings: '"tnum" 1' }} data-testid="link-buffered">
              {formatNumber(n)} reading{n === 1 ? '' : 's'} ({formatKB(link.bufferedBytes)})
            </Box>{' '}
            waiting to be sent. Figures on screen are stale until the link returns.
          </>
        )}
      </Typography>
      <Button size="small" onClick={onOpenLink} data-testid="link-banner-details">Link details</Button>
    </Box>
  );
}
