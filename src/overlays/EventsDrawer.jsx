/* ═══════════════════════════════════════════════════════════════
   Aurora — station event log (rollout 1B). Replaces EventTimeline.
   The simulator's event log as received in the telemetry snapshot (newest
   first, up to 50). Times are wall-clock IST, when the simulator logged the
   event. Event types are the simulator's own; nothing is inferred here.
   ═══════════════════════════════════════════════════════════════ */
import { Box, Stack, Typography } from '@mui/material';
import { formatDateTimeIST } from '../lib/format';
import { EmptyState } from '../ui/States';
import StatusDot from '../ui/StatusDot';
import SideSheet from './SideSheet';

// The types simulator.py logs (log_event); anything else shows its raw type.
const TYPE = {
  injection: ['Injected scenario', 'simulated'], reset: ['Scenario reset', 'offline'], mode: ['Simulator mode', 'offline'],
  pattern_start: ['Weather pattern (test mode)', 'simulated'], pattern_end: ['Weather pattern ended', 'offline'],
};

export default function EventsDrawer({ open, onClose, events = [] }) {
  const items = [...events].reverse().slice(0, 50);
  return (
    <SideSheet open={open} onClose={onClose} title="Event log" testId="events-drawer"
      subtitle={`The simulator's event log for this station (${events.length} events; newest first). Times in IST.`}>
      {!items.length ? <EmptyState title="No events yet" height={160}>Events appear when the simulator logs alerts, weather patterns or injected scenarios.</EmptyState> : (
        <Box component="ol" sx={{ m: 0, p: 0, listStyle: 'none' }}>
          {items.map((e, i) => {
            const [label, status] = TYPE[e.type] || [e.type, 'offline'];
            return (
              <Stack component="li" key={e.id ?? `${e.timestamp}-${i}`} direction="row" sx={{ gap: 3, py: 3, borderBottom: 1, borderColor: 'aurora.borderSubtle' }}>
                <StatusDot status={status} size={8} sx={{ mt: '6px' }} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {label} · <Box component="span" sx={{ typography: 'mono', fontSize: 12 }}>{formatDateTimeIST(e.timestamp)}</Box>
                  </Typography>
                  <Typography variant="body2">{e.message}</Typography>
                </Box>
              </Stack>
            );
          })}
        </Box>
      )}
    </SideSheet>
  );
}
