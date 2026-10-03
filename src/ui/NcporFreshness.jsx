/* ═══════════════════════════════════════════════════════════════
   Aurora — how fresh the NCPOR live data is (Weather page, Administration →
   Data sources). From GET /ncpor/status (ncpor_sync.py): the backend fetches each
   station's NCPOR AWS page every NCPOR_SYNC_INTERVAL_MIN minutes.

   OK:     "Last synced 12 min ago · 100 values · next sync in 18 min" (25 hourly readings × 4)
   Error:  "NCPOR page unreachable since 09:10 IST, showing the last good data
            (synced 3 h ago). Next try in 40 min."
   Also: when NCPOR's own newest reading was taken (they publish with a delay),
   readings flagged suspect, and the wind unit as labelled on their page.
   Only in page chunks, never at startup.
   ═══════════════════════════════════════════════════════════════ */
import { useState } from 'react';
import { Box, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import { apiGet } from '../services/api';
import { usePolling } from '../hooks/usePolling';
import { useNow } from '../hooks/useNow';
import { stationMeta } from '../data/stationConfig';
import { formatDateTimeIST, formatNumber } from '../lib/format';
import { freshnessLine } from '../lib/ncporFreshness';
import { describeFailure } from '../lib/failure';
import StatusDot from './StatusDot';

export default function NcporFreshness({ stations, title = 'NCPOR live data', sx }) {
  const now = useNow(15000);
  const [state, setState] = useState({ data: null, error: null });
  usePolling(async (isActive) => {
    try {
      const d = await apiGet('/ncpor/status');
      if (isActive()) setState({ data: d, error: null });
    } catch (err) {
      console.error('[NcporFreshness] status failed', err);
      if (isActive()) setState((s) => ({ data: s.data, error: err }));
      throw err;
    }
  }, 30000);

  const { data, error } = state;
  if (!data) {
    return error
      ? <Typography variant="body2" sx={{ color: 'text.secondary', ...sx }}>NCPOR sync status unavailable because {describeFailure(error)}.</Typography>
      : null;
  }
  return (
    <Box sx={sx} data-testid="ncpor-freshness">
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 0.5 }}>
        <Typography variant="label" component="h3" sx={{ color: 'text.secondary' }}>{title}</Typography>
        <Tooltip title={<>{data.windUnitNote} {data.suspectRule}</>}>
          <IconButton size="small" aria-label="About the NCPOR data: units and checks" data-testid="ncpor-info"><InfoOutlined fontSize="inherit" /></IconButton>
        </Tooltip>
      </Stack>
      <Stack sx={{ gap: 1 }}>
        {stations.map((sid) => {
          const st = data.stations?.[sid];
          if (!st) return null;
          const line = freshnessLine(st, { enabled: data.enabled, now });
          return (
            <Box key={sid} data-testid={`ncpor-freshness-${sid}`} data-status={line.status}>
              <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1.5 }}>
                <StatusDot status={line.status} size={7} sx={{ position: 'relative', top: -1 }} />
                <Typography variant="body2">
                  {stations.length > 1 && <strong>{stationMeta(sid).name}: </strong>}
                  <span title={line.detail || undefined}>{line.text}</span>
                </Typography>
              </Stack>
              {(st.newestObservation || st.suspectReadings > 0) && (
                <Typography variant="caption" component="p" sx={{ color: 'text.secondary', m: 0, pl: 3 }}>
                  {st.newestObservation && `Newest NCPOR reading: ${formatDateTimeIST(st.newestObservation)} (NCPOR publishes with a delay).`}
                  {st.suspectReadings > 0 && ` ${formatNumber(st.suspectReadings)} reading${st.suspectReadings === 1 ? '' : 's'} flagged suspect and left out.`}
                </Typography>
              )}
            </Box>
          );
        })}
      </Stack>
    </Box>
  );
}
