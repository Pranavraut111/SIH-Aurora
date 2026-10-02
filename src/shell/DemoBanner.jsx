/* ═══════════════════════════════════════════════════════════════
   Aurora — the running-scenario banner (judge mode). Shown to EVERY visitor
   while a demo scenario runs on any station, because a scenario changes what
   everyone sees: "Demo scenario running: Generator failure (started by a
   visitor), resets in 1:42". Labelled Simulated; opens Demo Control.
   Loaded only when a scenario is running, so it costs nothing at startup.
   ═══════════════════════════════════════════════════════════════ */
import { Box, Button, Typography } from '@mui/material';
import { useNow } from '../hooks/useNow';
import { stationMeta } from '../data/stationConfig';
import { demoRemainingS, mmss, runningDemos, scenarioLabel } from '../lib/publicDemo';
import { StatusChip } from '../ui/Status';

export default function DemoBanner({ publicDemo, receivedAt, activeStation, onOpenDemo, onStationChange }) {
  const now = useNow(1000);
  const list = runningDemos(publicDemo, activeStation).filter((r) => demoRemainingS(r, receivedAt, now) > 0);
  if (!list.length) return null;
  return (
    <Box role="status" aria-live="polite" data-testid="demo-banner"
      sx={(t) => ({ px: { xs: 3, md: 4 }, py: 1.5, display: 'flex', flexDirection: 'column', gap: 1,
        bgcolor: t.vars.palette.status.simulatedTint, borderBottom: `1px solid ${t.vars.palette.divider}` })}>
      {list.map((r) => {
        const here = r.stationId === activeStation;
        const left = demoRemainingS(r, receivedAt, now);
        return (
          <Box key={r.stationId} sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }} data-station={r.stationId}>
            <StatusChip status="simulated" label="Simulated" />
            <Typography variant="body2" sx={{ flex: 1, minWidth: 200 }}>
              <strong>Demo scenario running{here ? '' : ` at ${stationMeta(r.stationId).name}`}:</strong>{' '}
              {scenarioLabel(r)} (started by {r.startedBy === 'visitor' ? 'a visitor' : 'the Aurora team'}),
              {' '}resets in <Box component="span" sx={{ fontFeatureSettings: '"tnum" 1', fontWeight: 600 }} data-testid="demo-banner-countdown">{mmss(left)}</Box>
            </Typography>
            {here
              ? <Button size="small" onClick={onOpenDemo} data-testid="demo-banner-open">Demo control</Button>
              : <Button size="small" onClick={() => onStationChange(r.stationId)}>View {stationMeta(r.stationId).name}</Button>}
          </Box>
        );
      })}
    </Box>
  );
}
