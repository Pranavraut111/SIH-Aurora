/* ═══════════════════════════════════════════════════════════════
   Aurora — KPI card: one number, its unit, one line of context.
   Neutral by default; a status chip appears only when the backend's alert
   engine says this quantity is out of range (status colours stay meaningful).
   ═══════════════════════════════════════════════════════════════ */
import { Box, Card, LinearProgress, Skeleton, Stack, Typography } from '@mui/material';
import { DASH, formatNumber } from '../lib/format';
import { StatusChip } from './Status';

export default function KpiCard({
  label,
  value,
  unit,
  decimals = 0,
  context,
  status,              // 'warning' | 'critical' | undefined (normal = no chip)
  progress,            // 0–100, optional bar under the value
  loading = false,
  testId,
}) {
  const text = formatNumber(value, decimals);
  return (
    <Card component="section" aria-label={label} data-testid={testId} sx={{ height: '100%' }}>
      <Box sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', minHeight: 22 }}>
          <Typography variant="body2" component="h3" sx={{ color: 'text.secondary', fontWeight: 600 }}>
            {label}
          </Typography>
          {status && status !== 'normal' && <StatusChip status={status} />}
        </Stack>

        {loading ? (
          <Skeleton variant="text" width="60%" sx={{ fontSize: 28 }} />
        ) : (
          <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1 }}>
            <Typography variant="kpi" component="p" sx={{ color: text === DASH ? 'text.disabled' : 'text.primary' }}>
              {text}
            </Typography>
            {unit && text !== DASH && (
              <Typography variant="body2" component="span" sx={{ color: 'text.secondary' }}>{unit}</Typography>
            )}
          </Stack>
        )}

        {progress != null && (
          <LinearProgress
            variant="determinate"
            value={Math.max(0, Math.min(100, progress))}
            aria-label={`${label} ${Math.round(progress)}%`}
            color={status === 'critical' ? 'error' : status === 'warning' ? 'warning' : 'primary'}
          />
        )}

        {context && (
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 'auto' }}>{context}</Typography>
        )}
      </Box>
    </Card>
  );
}
