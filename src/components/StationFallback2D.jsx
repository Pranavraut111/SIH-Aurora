/* ═══════════════════════════════════════════════════════════════
   Aurora — 2D station overview (no-WebGL fallback), rollout 1B.
   Rendered instead of the three.js scene when WebGL is unavailable or the 3D
   renderer throws. The active station's buildings from station_config.json
   (the legacy version always listed the first station's), laid out by the
   same dependency depth as the Infrastructure map; status from the backend
   alert engine; a click opens the building panel, as in 3D. Dark like the
   3D overview, so the HUD over it reads the same.
   ═══════════════════════════════════════════════════════════════ */
import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import { buildingList, dependencyEdges, stationMeta } from '../data/stationConfig';
import { layoutDepths } from '../lib/graphLayout';
import StatusDot from '../ui/StatusDot';
import { STATUS_LABEL } from '../ui/statusLabels';

export default function StationFallback2D({ alertStates = {}, selectedBuilding, onBuildingClick, onBuildingHover, reason, activeStation = 'maitri', avoidBottom = 0 }) {
  const buildings = buildingList(activeStation);
  const depth = layoutDepths(buildings.map((b) => b.id), dependencyEdges(activeStation));
  const cols = Math.max(...Object.values(depth)) + 1;
  const byCol = Array.from({ length: cols }, (_, c) => buildings.filter((b) => depth[b.id] === c));
  const level = (id) => (alertStates[id] === 'critical' || alertStates[id] === 'warning' ? alertStates[id] : 'normal');

  return (
    <Box data-testid="station-2d-fallback" data-color-scheme="dark" sx={{
      position: 'absolute', inset: 0, overflow: 'auto', bgcolor: 'background.default', color: 'text.primary', colorScheme: 'dark',
      // Clear of the HUD cards that float over the stage from lg up (their measured band).
      p: { xs: 4, md: 6 }, pb: avoidBottom ? `${avoidBottom + 24}px` : undefined,
    }}>
      <Box role="status" sx={{ display: 'inline-block', px: 3, py: 1.5, mb: 5, borderRadius: '8px', bgcolor: 'aurora.surfaceRaised', fontSize: 13, color: 'text.secondary' }}>
        2D overview of {stationMeta(activeStation).name}: {reason || '3D view unavailable'}. All data and panels work normally.
      </Box>
      <Box sx={{ display: 'grid', gap: 4, gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: `repeat(${cols}, minmax(0, 1fr))` }, alignItems: 'center' }}>
        {byCol.map((col, c) => (
          <Stack key={c} sx={{ gap: 3 }} aria-label={c === 0 ? 'Supplies' : undefined}>
            {col.map((b) => {
              const l = level(b.id);
              return (
                <ButtonBase key={b.id} data-building={b.id} data-status={l} aria-pressed={selectedBuilding === b.id} title={b.description}
                  onClick={() => onBuildingClick?.(b.id)} onMouseEnter={() => onBuildingHover?.(b.id)} onMouseLeave={() => onBuildingHover?.(null)}
                  sx={(t) => ({
                    display: 'block', textAlign: 'left', px: 4, py: 3, borderRadius: '12px', bgcolor: t.vars.palette.background.paper,
                    border: `1px solid ${l === 'normal' ? t.vars.palette.aurora.borderSubtle : t.vars.palette.status[l]}`,
                    outline: selectedBuilding === b.id ? `2px solid ${t.vars.palette.primary.main}` : 'none',
                    '&:hover': { bgcolor: t.vars.palette.aurora.surfaceRaised },
                  })}>
                  <Stack direction="row" sx={{ gap: 2, alignItems: 'center' }}>
                    <StatusDot status={l} />
                    <Typography sx={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{b.name}</Typography>
                    <Typography variant="caption" sx={(t) => ({ color: l === 'normal' ? t.vars.palette.text.secondary : t.vars.palette.status[l], fontWeight: 600 })}>{STATUS_LABEL[l]}</Typography>
                  </Stack>
                </ButtonBase>
              );
            })}
          </Stack>
        ))}
      </Box>
    </Box>
  );
}
