/* ═══════════════════════════════════════════════════════════════
   Aurora — KPI card: one number, its unit, a trend and one line of context.

   Two sizes (bento layout, docs/ui-redesign.md §10): `hero` — one per page — has a
   52 px figure, the delta vs 15 min ago and a full-width sparkline of the last
   30 min; the compact card has a 30 px figure and a mini sparkline. Figures are
   Plex Sans with tabular figures; labels are small and secondary.

   Neutral by default; a status chip appears only when the backend's alert engine
   says this quantity is out of range (status colours stay meaningful). A delta is
   neutral too: up is not "good" and down is not "bad" for most of these figures.
   ═══════════════════════════════════════════════════════════════ */
import { Box, Card, LinearProgress, Skeleton, Stack, Typography } from '@mui/material';
import { DASH, formatNumber, isNum } from '../lib/format';
import FadeValue from './FadeValue';
import Sparkline from './Sparkline';
import StatusDot from './StatusDot';
import { STATUS_LABEL } from './statusLabels';

function Delta({ delta, unit, decimals, label }) {
  if (!isNum(delta)) {
    return <Typography variant="body2" sx={{ color: 'text.secondary' }}>{label}: not enough history yet</Typography>;
  }
  const flat = Math.abs(delta) < 0.5 * 10 ** -decimals;
  const arrow = flat ? '→' : delta > 0 ? '↑' : '↓';
  const sign = flat ? '±' : delta > 0 ? '+' : '−';
  return (
    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
      <Box component="span" aria-hidden="true" sx={{ mr: 0.5 }}>{arrow}</Box>
      <Box component="span" sx={{ color: 'text.primary', fontWeight: 600, fontFeatureSettings: '"tnum" 1' }}>
        {sign}{formatNumber(Math.abs(delta), decimals)}{unit ? ` ${unit}` : ''}
      </Box>
      {' '}{label}
    </Typography>
  );
}

export default function KpiCard({
  label,
  value,
  unit,
  decimals = 0,
  context,
  status,              // 'warning' | 'critical' | undefined (normal = no chip)
  progress,            // 0–100, optional bar under the value
  series,              // [[ts, value], …] for the sparkline
  delta,               // number: change vs `deltaLabel`
  deltaLabel,
  hero = false,
  sparkBucketMs,       // sparkline bucket (model clock)
  loading = false,
  testId,
  sx,
}) {
  const text = formatNumber(value, decimals);
  const missing = text === DASH;
  return (
    <Card
      component="section"
      aria-label={label}
      data-testid={testId}
      data-kpi-size={hero ? 'hero' : 'compact'}
      sx={[{ height: '100%', minWidth: 0 }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
      <Box sx={{ p: hero ? 6 : 5, display: 'flex', flexDirection: 'column', gap: hero ? 3 : 2, height: '100%' }}>
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 2, minHeight: 22 }}>
          <Typography variant="label" component="h3" sx={{ color: 'text.secondary' }}>{label}</Typography>
          {status && status !== 'normal' && (
            <Stack direction="row" data-status={status} sx={(theme) => ({
              alignItems: 'center', gap: 1, px: 2, height: 22, borderRadius: '6px', fontSize: 12, fontWeight: 600,
              color: theme.vars.palette.status[status], backgroundColor: theme.vars.palette.status[`${status}Tint`],
            })}>
              <StatusDot status={status} size={6} />{STATUS_LABEL[status]}
            </Stack>
          )}
        </Stack>

        {loading ? (
          <Skeleton variant="text" width="60%" sx={{ fontSize: hero ? 52 : 30 }} />
        ) : (
          <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1.5, minWidth: 0 }}>
            <Typography variant={hero ? 'kpiHero' : 'kpi'} component="p" sx={{ color: missing ? 'text.disabled' : 'text.primary', m: 0 }}>
              <FadeValue>{text}</FadeValue>
            </Typography>
            {unit && !missing && (
              <Typography component="span" sx={{ color: 'text.secondary', fontSize: hero ? 20 : 14, fontWeight: 500 }}>{unit}</Typography>
            )}
          </Stack>
        )}

        {hero && delta !== undefined && <Delta delta={delta} unit={unit} decimals={decimals} label={deltaLabel} />}

        {progress != null && (
          <LinearProgress
            variant="determinate"
            value={Math.max(0, Math.min(100, progress))}
            aria-label={`${label} ${Math.round(progress)}%`}
            color={status === 'critical' ? 'error' : status === 'warning' ? 'warning' : 'primary'}
          />
        )}

        {series !== undefined && (
          <Box sx={{ mt: hero ? 0 : 1, pt: hero ? 2 : 0, flex: hero ? '1 1 72px' : 'none', minHeight: hero ? 72 : 0, display: 'flex' }}>
            <Sparkline points={series} height={hero ? 72 : 28} fill={hero} bucketMs={sparkBucketMs} />
          </Box>
        )}

        {context && (
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: series !== undefined && !hero ? 0 : 'auto' }}>{context}</Typography>
        )}
      </Box>
    </Card>
  );
}
