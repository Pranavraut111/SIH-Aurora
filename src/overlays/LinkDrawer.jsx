/* ═══════════════════════════════════════════════════════════════
   Aurora — telemetry link drawer (rollout 1B). Replaces ConnectionPanel.
   Only real values: there is no satellite link in this prototype, so signal,
   latency and bandwidth are "not measured". "Simulate link loss" marks the
   station's link as cut in the backend (POST /connection/toggle) and this
   browser stops applying new snapshots; missed snapshots are counted, not
   stored or replayed. Write-protected and confirmed first.
   ═══════════════════════════════════════════════════════════════ */
import { Box, Stack, Typography } from '@mui/material';
import LinkOffOutlined from '@mui/icons-material/LinkOffOutlined';
import LinkOutlined from '@mui/icons-material/LinkOutlined';
import { formatNumber } from '../lib/format';
import { dataSourceInfo } from '../shell/dataSource';
import { PROVENANCE } from '../ui/Provenance';
import { StatusChip } from '../ui/Status';
import WriteButton from '../ui/WriteButton';
import { useConfirm, useToast } from '../ui/feedbackContext';
import SideSheet from './SideSheet';

function Row({ k, v }) {
  return (
    <Box sx={{ display: 'contents' }}>
      <Box component="dt" sx={{ color: 'text.secondary' }}>{k}</Box>
      <Box component="dd" sx={{ m: 0, textAlign: 'right' }}>{v}</Box>
    </Box>
  );
}

export default function LinkDrawer({ open, onClose, isConnected, onToggleConnection, offlineQueueSize = 0, telemetryBadge, provenance }) {
  const confirm = useConfirm();
  const toast = useToast();
  const src = dataSourceInfo(telemetryBadge);
  const label = (k) => (k ? PROVENANCE[k]?.label ?? k : '—');

  async function toggle() {
    const ok = await confirm(isConnected ? {
      title: 'Simulate link loss?',
      body: 'The backend marks this station’s link as cut and this browser stops applying new snapshots until you restore it. Nothing real is disconnected.',
      confirmLabel: 'Cut the link (simulated)', danger: true,
    } : {
      title: 'Restore the link?',
      body: 'Snapshots received while the link was cut were not stored and will not be replayed; the dashboard resumes from the next one.',
      confirmLabel: 'Restore link',
    });
    if (!ok) return;
    await onToggleConnection();
    toast({ text: isConnected ? 'Link cut (simulated). Showing the last received values.' : 'Link restored.' });
  }

  return (
    <SideSheet open={open} onClose={onClose} title="Telemetry link" testId="link-drawer"
      subtitle="How this dashboard receives data. There is no real satellite link in this prototype.">
      <Box sx={{ p: 4, borderRadius: '10px', bgcolor: 'aurora.surfaceRaised' }}>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 2, mb: 2 }}>
          <StatusChip status={isConnected ? 'normal' : 'offline'} label={isConnected ? 'Link up' : 'Link cut (simulated)'} />
        </Stack>
        <Typography variant="body2">
          {isConnected
            ? 'One snapshot per station every 2 s from the unified backend over a WebSocket.'
            : `${formatNumber(offlineQueueSize)} snapshot(s) arrived while cut. They were counted, not stored, and will not be replayed.`}
        </Typography>
      </Box>
      <Box component="dl" sx={{ m: 0, mt: 5, display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', columnGap: 4, rowGap: 2, fontSize: 14 }}>
        <Row k="Data source" v={src.label} />
        <Row k="Signal quality" v={<Box component="span" sx={{ color: 'text.secondary' }}>not measured</Box>} />
        <Row k="Latency, bandwidth" v={<Box component="span" sx={{ color: 'text.secondary' }}>not measured</Box>} />
        <Row k="Equipment values" v={label(provenance?.equipment)} />
        <Row k="Environment values" v={label(provenance?.environment)} />
        <Row k="Storage values" v={label(provenance?.storage)} />
      </Box>
      <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 2 }}>{src.help}</Typography>
      <Box sx={{ mt: 5 }}>
        <WriteButton variant={isConnected ? 'outlined' : 'contained'} color={isConnected ? 'error' : 'primary'}
          startIcon={isConnected ? <LinkOffOutlined /> : <LinkOutlined />} onClick={toggle} data-testid="link-toggle">
          {isConnected ? 'Simulate link loss' : 'Restore link'}
        </WriteButton>
      </Box>
    </SideSheet>
  );
}
