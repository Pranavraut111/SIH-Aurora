/* ═══════════════════════════════════════════════════════════════
   Aurora — building panel (rollout 1B). Replaces the legacy BuildingPanel.

   Fixes audit F2: the legacy panel took its sensor list from the browser-demo
   generator (never initialised while live telemetry flows, so it was empty)
   and fell back to a "nominal" constant for missing values. Here:
   - the sensor list is the building's sensors in station_config.json;
   - values are the live telemetry snapshot; a missing value renders "—";
   - status comes only from the backend alert engine (activeAlerts);
   - trends are the backend's rolling history on the model clock.
   ═══════════════════════════════════════════════════════════════ */
import { Box, Chip, Divider, Drawer, IconButton, Stack, Typography } from '@mui/material';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import { buildingList, dependencyGraph, sensorCatalog } from '../../data/stationConfig';
import { useSeries } from '../../hooks/useSeries';
import { formatNumber, formatTimeIST, isNum } from '../../lib/format';
import { onModelClock, formatSpan } from '../../lib/modelClock';
import { sensorStatus, thresholdText } from '../../lib/thresholds';
import FadeValue from '../../ui/FadeValue';
import ProvenanceChip from '../../ui/Provenance';
import Sparkline from '../../ui/Sparkline';
import { StatusChip } from '../../ui/Status';

const DECIMALS = { rpm: 0, ppm: 0, items: 0, pH: 2, '%': 0, days: 0 };

/** Which provenance block of the snapshot a building's readings belong to. */
function provenanceKind(buildingId, provenance) {
  if (!provenance) return null;
  if (buildingId === 'lab') return provenance.environment;
  if (buildingId === 'storage') return provenance.storage;
  return provenance.equipment;
}

function ReadingRow({ sensorId, def, value, points, status, clock }) {
  const decimals = DECIMALS[def.unit] ?? 1;
  const text = formatNumber(value, decimals);
  return (
    <Box component="li" data-testid={`reading-${sensorId}`} sx={{
      display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 96px', gap: 3, alignItems: 'center', py: 3,
      borderBottom: 1, borderColor: 'aurora.borderSubtle', '&:last-child': { borderBottom: 0 },
    }}>
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          <Typography variant="label" component="span" sx={{ color: 'text.secondary' }}>{def.name}</Typography>
          {status && <StatusChip status={status} />}
        </Stack>
        <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1, mt: 0.5 }}>
          <Typography component="span" sx={{ fontSize: 22, lineHeight: '28px', fontWeight: 500, fontFeatureSettings: '"tnum" 1', color: isNum(value) ? 'text.primary' : 'text.disabled' }}>
            <FadeValue>{text}</FadeValue>
          </Typography>
          {isNum(value) && def.unit && <Typography component="span" variant="body2" sx={{ color: 'text.secondary' }}>{def.unit}</Typography>}
        </Stack>
        {def.threshold && <Typography variant="caption" component="p" sx={{ color: 'text.secondary', m: 0 }}>{def.threshold}</Typography>}
      </Box>
      <Box aria-hidden="true"><Sparkline points={points} height={32} bucketMs={clock.sparkBucketMs} /></Box>
    </Box>
  );
}

export default function BuildingDrawer({
  buildingId, activeStation, sensors = {}, alerts = {}, activeAlerts = [], provenance, timestamp, replay,
  telemetrySource, onClose, onOpenBuilding,
}) {
  const open = Boolean(buildingId);
  const buildings = buildingList(activeStation);
  const building = buildings.find((b) => b.id === buildingId);
  const catalog = sensorCatalog(activeStation);
  const defs = Object.entries(catalog)
    .filter(([, c]) => c.building === buildingId)
    .map(([id, c]) => [id, { ...c, threshold: thresholdText(catalog, id) }]);
  const keys = defs.map(([id]) => `${buildingId}.${id}`);
  const replayMs = isNum(replay?.timeMs) ? replay.timeMs : null;
  const raw = useSeries({
    station: activeStation, keys: keys.length ? keys : ['none.none'], minutes: 30,
    sensors, timestamp, source: telemetrySource, replayMs,
  });
  const { clock, series } = onModelClock(raw.series, keys, replayMs);
  const live = sensors[buildingId] || {};
  const level = alerts[buildingId] === 'critical' || alerts[buildingId] === 'warning' ? alerts[buildingId] : 'normal';
  const graph = dependencyGraph(activeStation)[buildingId] || { depends: [], feeds: [] };
  const name = (id) => buildings.find((b) => b.id === id)?.name || id;
  const kind = provenanceKind(buildingId, provenance);
  const span = Math.max(0, ...keys.map((k) => (series[k]?.length > 1 ? series[k].at(-1)[0] - series[k][0][0] : 0)));

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{ paper: { sx: { width: { xs: '100%', sm: 420 }, borderRadius: { sm: '12px 0 0 12px' } }, 'data-testid': 'building-drawer', role: 'dialog', 'aria-labelledby': 'building-drawer-title' } }}
    >
      {building && (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <Box sx={{ px: 6, pt: 5, pb: 4 }}>
            <Stack direction="row" sx={{ alignItems: 'flex-start', gap: 2 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="overline" component="p" sx={{ color: 'text.secondary' }}>{building.module} · {building.abbr}</Typography>
                <Typography id="building-drawer-title" component="h2" sx={{ fontSize: 22, lineHeight: '28px', fontWeight: 600, letterSpacing: '-0.01em' }}>{building.name}</Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>{building.description}</Typography>
              </Box>
              <IconButton onClick={onClose} aria-label="Close building panel" data-testid="building-drawer-close"><CloseOutlined /></IconButton>
            </Stack>
            <Stack direction="row" sx={{ gap: 1, mt: 3, flexWrap: 'wrap', alignItems: 'center' }}>
              <StatusChip status={level} />
              {kind && <ProvenanceChip kind={kind} />}
              {isNum(timestamp) && (
                <Typography variant="caption" sx={{ color: 'text.secondary', ml: 1 }}>
                  Snapshot <Box component="span" sx={{ typography: 'mono', fontSize: 12, color: 'text.primary' }}>{formatTimeIST(timestamp)}</Box>
                </Typography>
              )}
            </Stack>
          </Box>
          <Divider />
          <Box sx={{ flex: 1, overflowY: 'auto', px: 6, py: 4 }}>
            <Stack direction="row" sx={{ alignItems: 'baseline', justifyContent: 'space-between', gap: 2 }}>
              <Typography variant="h3" component="h3">Live readings</Typography>
              {span > 0 && <Typography variant="caption" sx={{ color: 'text.secondary' }}>trend: last {formatSpan(span)} ({clock.suffix})</Typography>}
            </Stack>
            {defs.length ? (
              <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }} data-testid="building-readings">
                {defs.map(([id, def]) => (
                  <ReadingRow key={id} sensorId={id} def={def} value={isNum(live[id]) ? live[id] : null}
                    points={series[`${buildingId}.${id}`]} status={sensorStatus(activeAlerts, id)} clock={clock} />
                ))}
              </Box>
            ) : (
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 2 }}>No sensors are configured for this building in station_config.json.</Typography>
            )}

            {(graph.depends.length > 0 || graph.feeds.length > 0) && (
              <Box sx={{ mt: 6 }}>
                <Typography variant="h3" component="h3" sx={{ mb: 2 }}>Dependencies</Typography>
                {[['Depends on', graph.depends], ['Feeds into', graph.feeds]].filter(([, l]) => l.length).map(([label, list]) => (
                  <Box key={label} sx={{ mb: 3 }}>
                    <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mb: 1 }}>{label}</Typography>
                    <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
                      {list.map((id) => (
                        <Chip key={id} label={name(id)} size="small" variant="outlined" clickable={Boolean(onOpenBuilding)}
                          onClick={onOpenBuilding ? () => onOpenBuilding(id) : undefined}
                          icon={alerts[id] === 'critical' || alerts[id] === 'warning'
                            ? <Box component="span" sx={(t) => ({ width: 6, height: 6, borderRadius: '50%', ml: '8px !important', backgroundColor: t.vars.palette.status[alerts[id]] })} />
                            : undefined} />
                      ))}
                    </Stack>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        </Box>
      )}
    </Drawer>
  );
}
