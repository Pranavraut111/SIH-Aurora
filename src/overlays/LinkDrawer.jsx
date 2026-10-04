/* ═══════════════════════════════════════════════════════════════
   Aurora — satellite link drawer (simulated store-and-forward, link_buffer.py).

   There is no real satellite link in this prototype. The backend simulates the
   pattern a station's edge computer would use: when the link drops it keeps
   recording and holds the readings on site; when the link returns it sends them
   in order, so the history has no gap and alerts keep their real times. This
   drawer shows that state for the active station, from the backend (`link` in
   every snapshot): last contact, readings and bytes waiting, the last sync.

   The team cuts/restores the link here (Team sign-in). Visitors try it from Demo
   Control ("Satellite link loss": shared, 2 minutes, restores by itself).
   ═══════════════════════════════════════════════════════════════ */
import { Box, Button, Stack, Typography } from '@mui/material';
import LinkOffOutlined from '@mui/icons-material/LinkOffOutlined';
import LinkOutlined from '@mui/icons-material/LinkOutlined';
import { describeApiError } from '../services/api';
import { useNow } from '../hooks/useNow';
import { stationMeta } from '../data/stationConfig';
import { formatNumber, formatRelative, formatTimeIST } from '../lib/format';
import { dataSourceInfo } from '../shell/dataSource';
import { PROVENANCE } from '../ui/Provenance';
import { StatusChip } from '../ui/Status';
import WriteButton from '../ui/WriteButton';
import { useConfirm, useToast } from '../ui/feedbackContext';
import SideSheet from './SideSheet';

const kb = (bytes) => `${formatNumber((bytes || 0) / 1000, 1)} KB`;

function Row({ k, v, testId }) {
  return (
    <Box sx={{ display: 'contents' }}>
      <Box component="dt" sx={{ color: 'text.secondary' }}>{k}</Box>
      <Box component="dd" sx={{ m: 0, textAlign: 'right' }} data-testid={testId}>{v}</Box>
    </Box>
  );
}

const muted = (text) => <Box component="span" sx={{ color: 'text.secondary' }}>{text}</Box>;

export default function LinkDrawer({ open, onClose, link, onToggleConnection, telemetryBadge, provenance, activeStation, onOpenDemo }) {
  const confirm = useConfirm();
  const toast = useToast();
  const now = useNow(1000);
  const src = dataSourceInfo(telemetryBadge);
  const label = (k) => (k ? PROVENANCE[k]?.label ?? k : '—');
  const up = link ? link.up : true;
  const name = stationMeta(activeStation).name;
  const sync = link?.lastSync;

  async function toggle() {
    const ok = await confirm(up ? {
      title: `Cut ${name}'s satellite link?`,
      body: 'Simulated for everyone viewing this station: the dashboard freezes on the last data received while the station keeps recording. Nothing real is disconnected.',
      confirmLabel: 'Cut the link (simulated)', danger: true,
    } : {
      title: 'Restore the link?',
      body: 'The readings recorded during the outage are sent in order: the charts fill the gap and any alert keeps its real time.',
      confirmLabel: 'Restore link',
    });
    if (!ok) return;
    try {
      await onToggleConnection();
      toast({ text: up ? 'Link cut (simulated). The station is now recording on site.' : 'Link restoring: syncing the buffered readings.' });
    } catch (err) {
      console.error('[Link] toggle failed', err);
      toast({ severity: 'error', text: `Not changed: ${describeApiError(err)}` });
    }
  }

  return (
    <SideSheet open={open} onClose={onClose} title="Satellite link" testId="link-drawer"
      subtitle="How the station's data reaches India. Simulated: there is no real satellite link in this prototype.">
      <Box sx={{ p: 4, borderRadius: '10px', bgcolor: 'aurora.surfaceRaised' }}>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 2, mb: 2 }}>
          <StatusChip status={up ? 'normal' : 'offline'} label={up ? 'Link up' : link?.syncing ? 'Syncing' : 'Link down (simulated)'} />
        </Stack>
        <Typography variant="body2">
          {up
            ? 'Readings arrive every 2 seconds. If the link drops, the station keeps recording and sends everything when it returns.'
            : `Last contact ${formatTimeIST(link.lastContact)} (${formatRelative(link.lastContact, now)}). The station is recording on site and will send it all when the link returns.`}
        </Typography>
      </Box>

      <Box component="dl" sx={{ m: 0, mt: 5, display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', columnGap: 4, rowGap: 2, fontSize: 14 }}>
        {!up && <Row k="Waiting on site" testId="link-drawer-buffered" v={`${formatNumber(link.bufferedReadings)} readings (${kb(link.bufferedBytes)})`} />}
        {!up && link.droppedReadings > 0 && <Row k="Dropped (buffer full)" v={formatNumber(link.droppedReadings)} />}
        <Row k="Last sync" testId="link-drawer-last-sync" v={sync
          ? `${formatNumber(sync.readings)} readings (${kb(sync.bytes)}), ${formatNumber(sync.alertsRaised)} alert${sync.alertsRaised === 1 ? '' : 's'}, ${formatRelative(sync.at, now)}`
          : muted('none yet')} />
        <Row k="Station buffer" v={link ? `up to ${formatNumber(link.bufferCap)} readings` : muted('—')} />
        <Row k="Data source" v={src.label} />
        <Row k="Signal, latency, bandwidth" v={muted('not measured')} />
        <Row k="Equipment values" v={label(provenance?.equipment)} />
        <Row k="Environment values" v={label(provenance?.environment)} />
      </Box>
      <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 2 }}>
        The link and the buffer are simulated, to show the store-and-forward pattern a station&apos;s edge computer would use.
        The readings themselves are the usual model values.
      </Typography>

      <Stack sx={{ mt: 5, gap: 2, alignItems: 'flex-start' }}>
        <Button variant="contained" onClick={() => { onClose(); onOpenDemo?.(); }} data-testid="link-try-demo">
          Try it: Satellite link loss (60 s)
        </Button>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          In Demo Control. Everyone sees it, and the link comes back by itself after 60 seconds.
        </Typography>
        <WriteButton team variant="outlined" color={up ? 'error' : 'primary'}
          startIcon={up ? <LinkOffOutlined /> : <LinkOutlined />} onClick={toggle} data-testid="link-toggle">
          {up ? 'Cut the link (team)' : 'Restore the link'}
        </WriteButton>
      </Stack>
    </SideSheet>
  );
}
