/* ═══════════════════════════════════════════════════════════════
   Aurora — Administration → Visits (team only). Loaded on demand.

   When judges came, and which link they used, from the backend's aggregate
   visit counts (simulator/visits.py: no cookie, nothing personal stored).
   ═══════════════════════════════════════════════════════════════ */
import { useState } from 'react';
import { Box, Card, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { apiGet } from '../../services/api';
import { usePolling } from '../../hooks/usePolling';
import { describeFailure } from '../../lib/failure';
import ProvenanceChip from '../../ui/Provenance';
import ScrollX from '../../ui/ScrollX';
import { EmptyState, ErrorState, LoadingBlock } from '../../ui/States';

const STORY_NAMES = { blizzard: 'Blizzard hits Maitri', generator: 'Generator failure at Bharati', fuel: 'Running low on fuel', linkloss: 'Satellite link drops at Bharati' };

function entryName(entry) {
  if (entry === 'main') return 'Main link';
  if (entry === 'tour') return 'Tour link';
  if (entry.startsWith('story:')) return `Story: ${STORY_NAMES[entry.slice(6)] || entry.slice(6)}`;
  if (entry.startsWith('module:')) return `Page: ${entry.slice(7)}`;
  return entry;
}

const hourLabel = (h) => `${String(h).padStart(2, '0')}:00–${String(h).padStart(2, '0')}:59`;
const dayLabel = (d) => new Date(`${d}T12:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

function Stat({ label, value }) {
  return (
    <Card sx={{ p: 4, flex: 1, minWidth: 140, bgcolor: 'aurora.surfaceRaised', borderColor: 'transparent' }}>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>{label}</Typography>
      <Typography sx={{ fontSize: 22, fontWeight: 600, fontFeatureSettings: '"tnum" 1' }}>{value}</Typography>
    </Card>
  );
}

function SmallTable({ label, head, rows }) {
  return (
    <ScrollX label={`${label}, scrollable`}>
      <Table size="small" aria-label={label}>
        <TableHead><TableRow>{head.map((h, i) => <TableCell key={h} align={i ? 'right' : 'left'}>{h}</TableCell>)}</TableRow></TableHead>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r[0]}>{r.map((c, i) => <TableCell key={i} align={i ? 'right' : 'left'} sx={i ? { fontFeatureSettings: '"tnum" 1' } : undefined}>{c}</TableCell>)}</TableRow>
          ))}
        </TableBody>
      </Table>
    </ScrollX>
  );
}

export default function VisitsPanel() {
  const [state, setState] = useState({ data: null, error: null });
  usePolling(async (isActive) => {
    try {
      const d = await apiGet('/admin/visits?days=14');
      if (isActive()) setState({ data: d, error: null });
    } catch (err) {
      console.error('[Admin] visits failed', err);
      if (isActive()) setState({ data: null, error: err });
      throw err;
    }
  }, 60000);

  const { data, error } = state;
  if (error) return <ErrorState>Visit counts unavailable because {describeFailure(error)}.</ErrorState>;
  if (!data) return <LoadingBlock lines={6} />;
  const last = data.lastVisitHour;
  const hours = data.today.hours.filter((h) => h.visits > 0);
  return (
    <Stack sx={{ gap: 4 }} data-testid="visits-panel">
      <Stack direction="row" sx={{ gap: 2, alignItems: 'center' }}>
        <Typography variant="body2" sx={{ color: 'text.secondary', flex: 1 }}>
          Who opened the public site in the last {data.days} days, by day and by the link they used. Times in {data.timezone}.
        </Typography>
        <ProvenanceChip kind="REAL" />
      </Stack>
      <Stack direction="row" sx={{ gap: 3, flexWrap: 'wrap' }}>
        <Stat label="Visitors" value={data.totals.visitors} />
        <Stat label="Visits" value={data.totals.visits} />
        <Stat label="Last visit" value={last ? `${dayLabel(last.day)}, ${hourLabel(last.hour)}` : '—'} />
      </Stack>
      {data.totals.visits === 0 ? (
        <EmptyState title="No visits yet" height={140}>Counts appear here as soon as someone opens the site.</EmptyState>
      ) : (
        <Box sx={{ display: 'grid', gap: 4, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
          <Box>
            <Typography variant="h3" component="h3" sx={{ mb: 2 }}>By day</Typography>
            <SmallTable label="Visits by day" head={['Day', 'Visitors', 'Visits']}
              rows={data.byDay.map((d) => [dayLabel(d.day), d.visitors, d.visits])} />
          </Box>
          <Box>
            <Typography variant="h3" component="h3" sx={{ mb: 2 }}>Links used</Typography>
            <SmallTable label="Visits by link" head={['Link', 'Visits']}
              rows={data.entries.map((e) => [entryName(e.entry), e.visits])} />
            <Typography variant="h3" component="h3" sx={{ mt: 4, mb: 2 }}>Today by hour</Typography>
            {hours.length
              ? <SmallTable label="Today's visits by hour" head={['Hour', 'Visitors', 'Visits']} rows={hours.map((h) => [hourLabel(h.hour), h.visitors, h.visits])} />
              : <Typography variant="body2" sx={{ color: 'text.secondary' }}>No visits yet today.</Typography>}
          </Box>
        </Box>
      )}
      <Typography variant="caption" component="p" sx={{ color: 'text.secondary', m: 0 }}>{data.method}</Typography>
    </Stack>
  );
}
