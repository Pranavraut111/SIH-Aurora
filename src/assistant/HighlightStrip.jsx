/* Aurora assistant — "Highlighted by Aurora": the components and dependency chain the
   assistant highlighted, shown at the top of any page, with Clear. The Infrastructure
   tiles and the dependency map outline the same components.
   Upgraded: shows an animated cascade indicator and incident context. */
import { Box, Button, Chip, Stack, Typography } from '@mui/material';
import { buildingName } from './actions';
import { stationMeta } from '../data/stationConfig';

export default function HighlightStrip({ highlight, activeStation, activeModule, onOpenMap, onClear }) {
  if (!highlight?.ids?.length) return null;
  const st = highlight.station;
  const other = st !== activeStation;
  const from = highlight.chainFrom;
  const rest = highlight.ids.filter((b) => b !== from);
  const isIncident = Boolean(highlight.incident);
  return (
    <Box role="status" data-testid="highlight-strip" data-ids={highlight.ids.join(' ')}
      sx={(t) => ({ mx: { xs: 4, sm: 6 }, mt: 3, mb: 0, px: 4, py: 2.5, borderRadius: '10px',
        border: `1px solid ${isIncident ? t.vars.palette.status.warning : t.vars.palette.primary.main}`,
        bgcolor: t.vars.palette.aurora.surfaceRaised, display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap',
        ...(isIncident ? { animation: 'aurora-pulse 3s ease-in-out infinite' } : {}),
      })}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
        {isIncident && <Box component="span" sx={{ fontSize: 16 }}>⚠️</Box>}
        <Typography variant="label" component="p" sx={{ m: 0, color: isIncident ? 'warning.main' : 'primary.main', fontWeight: 600 }}>
          {isIncident ? 'Incident chain' : 'Highlighted by Aurora'}
        </Typography>
      </Stack>
      <Stack direction="row" sx={{ flex: 1, minWidth: 200, gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
        {from ? (
          <>
            <Chip size="small" color={isIncident ? 'error' : 'primary'} variant="filled" label={buildingName(st, from)}
              sx={{ fontWeight: 700 }} />
            {rest.length > 0 && (
              <Box component="span" aria-hidden="true" sx={{
                color: isIncident ? 'warning.main' : 'text.secondary', fontWeight: 700, mx: 0.5,
                ...(isIncident ? { animation: 'aurora-flow-pulse 1.6s ease-in-out infinite' } : {}),
              }}>→</Box>
            )}
          </>
        ) : null}
        {rest.map((b, i) => (
          <Stack key={b} direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
            {i > 0 && <Box component="span" aria-hidden="true" sx={{ color: 'text.secondary', fontSize: 12 }}>·</Box>}
            <Chip size="small" variant="outlined" label={buildingName(st, b)} />
          </Stack>
        ))}
        {other && <Typography variant="caption" sx={{ color: 'text.secondary', ml: 1 }}>at {stationMeta(st).name}</Typography>}
      </Stack>
      <Stack direction="row" sx={{ gap: 1 }}>
        {activeModule !== 'infrastructure' && !other && <Button size="small" onClick={onOpenMap}>Dependency map</Button>}
        <Button size="small" onClick={onClear} data-testid="highlight-clear">Clear</Button>
      </Stack>
    </Box>
  );
}
