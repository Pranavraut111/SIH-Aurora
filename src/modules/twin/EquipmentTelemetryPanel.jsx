/* ═══════════════════════════════════════════════════════════════
   Aurora — Model internals panel (floats over the 3D twin in the
   X-ray / Systems / Heat map views).

   Shows what the AI layer actually sees, per subsystem and per sensor:
     · live reading vs the physics model's prediction (expected),
     · the residual in σ against the 6σ alarm gate,
     · threshold proximity from station_config.json,
     · the station-wide Isolation Forest score vs its threshold.
   "Heat" = the hotter of threshold proximity and model residual
   (src/scene/heat.js). It is not a probability of failure.
   ═══════════════════════════════════════════════════════════════ */
import { useMemo, useState } from 'react';
import { Box, ButtonBase, Chip, Collapse, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import ExpandMoreOutlined from '@mui/icons-material/ExpandMoreOutlined';
import RemoveOutlined from '@mui/icons-material/RemoveOutlined';
import OpenInFullOutlined from '@mui/icons-material/OpenInFullOutlined';
import CenterFocusStrongOutlined from '@mui/icons-material/CenterFocusStrongOutlined';
import OpenInNewOutlined from '@mui/icons-material/OpenInNewOutlined';
import MemoryOutlined from '@mui/icons-material/MemoryOutlined';
import { buildingList, sensorCatalog } from '../../data/stationConfig';
import { formatNumber, isNum } from '../../lib/format';
import { heatHex } from '../../scene/heat';
import StatusDot from '../../ui/StatusDot';
import { STATUS_LABEL } from '../../ui/statusLabels';

const DECIMALS = { rpm: 0, ppm: 0, items: 0, pH: 2, '%': 0, days: 0, kW: 1 };
const GLASS = {
  bgcolor: 'rgba(14, 17, 23, 0.82)',
  backdropFilter: 'blur(14px) saturate(140%)',
  border: '1px solid rgba(127, 178, 229, 0.18)',
  borderRadius: '12px',
  color: '#E6EBF2',
};
// Cards sit inside the panel: no backdrop blur (it is re-composited over the live canvas every frame).
const CARD = { ...GLASS, bgcolor: 'rgba(14, 17, 23, 0.9)', backdropFilter: 'none' };
const MUTED = 'rgba(214, 222, 233, 0.62)';
const fmt = (v, unit) => (isNum(v) ? formatNumber(v, DECIMALS[unit] ?? 1) : '—');
const pct = (t) => `${Math.round((t ?? 0) * 100)}%`;

function Bar({ value = 0, color, height = 5, marker }) {
  return (
    <Box sx={{ position: 'relative', width: '100%', height, borderRadius: height, bgcolor: 'rgba(255,255,255,0.08)', overflow: 'visible' }}>
      <Box sx={{ width: `${Math.min(100, Math.max(0, value * 100))}%`, height: '100%', borderRadius: 'inherit', bgcolor: color, transition: 'width 0.6s cubic-bezier(0.2,0,0,1), background-color 0.4s' }} />
      {marker != null && <Box sx={{ position: 'absolute', top: -3, bottom: -3, left: `${marker * 100}%`, width: 2, borderRadius: 1, bgcolor: 'rgba(255,255,255,0.7)' }} />}
    </Box>
  );
}

function Stat({ label, value, sub, color }) {
  return (
    <Box sx={{ p: 2, borderRadius: '8px', bgcolor: 'rgba(255,255,255,0.04)', minWidth: 0 }}>
      <Typography sx={{ fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{label}</Typography>
      <Typography sx={{ fontSize: 20, fontWeight: 700, lineHeight: '28px', fontFeatureSettings: '"tnum" 1', color }}>{value}</Typography>
      {sub && <Typography sx={{ fontSize: 10.5, color: MUTED }}>{sub}</Typography>}
    </Box>
  );
}

function SensorTable({ ids, catalog, heat }) {
  return (
    <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, '& td, & th': { py: 0.9, px: 0.5 }, '& th': { fontWeight: 500, color: MUTED, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' } }}>
      <thead>
        <tr>
          <Box component="th" sx={{ textAlign: 'left !important' }}>Sensor</Box>
          <th>Live</th>
          <th>Model</th>
          <th>Resid.</th>
          <Box component="th" sx={{ width: 56 }}>Heat</Box>
        </tr>
      </thead>
      <tbody>
        {ids.map((id) => {
          const c = catalog[id]; const h = heat?.sensors?.[id] || {};
          return (
            <Box component="tr" key={id} sx={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              <Box component="td" sx={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</Box>
              <Box component="td" sx={{ textAlign: 'right', fontWeight: 600, fontFeatureSettings: '"tnum" 1', whiteSpace: 'nowrap' }}>
                {fmt(h.value, c.unit)}<Box component="span" sx={{ color: MUTED, fontWeight: 400, ml: 0.5, fontSize: 10.5 }}>{c.unit}</Box>
              </Box>
              <Box component="td" sx={{ textAlign: 'right', color: MUTED, fontFeatureSettings: '"tnum" 1' }}>{fmt(h.expected, c.unit)}</Box>
              <Box component="td" sx={{ textAlign: 'right', fontFeatureSettings: '"tnum" 1', fontWeight: 600, color: h.z == null ? MUTED : heatHex(h.residual) }}>
                {h.z == null ? '—' : `${h.z >= 0 ? '+' : ''}${h.z.toFixed(1)}σ`}
              </Box>
              <Box component="td"><Bar value={h.heat} color={heatHex(h.heat)} /></Box>
            </Box>
          );
        })}
      </tbody>
    </Box>
  );
}

function SubsystemCard({ building, level, catalog, heat, expanded, onToggle, onFocus, onOpen, rank }) {
  const ids = Object.keys(catalog).filter((id) => catalog[id].building === building.id);
  const b = heat?.buildings?.[building.id] || { heat: 0 };
  const colour = heatHex(b.heat);
  const hottest = b.hottest ? catalog[b.hottest] : null;
  const statusColour = level === 'critical' ? '#FF6B6B' : level === 'warning' ? '#F5B83D' : '#5FD08A';
  return (
    <Box data-testid={`internals-card-${building.id}`} sx={{ ...CARD, flexShrink: 0, overflow: 'hidden', transition: 'border-color 0.25s', '&:hover': { borderColor: 'rgba(127,178,229,0.45)' }, borderLeft: `3px solid ${colour}` }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5, px: 2.5, pt: 2, pb: 1.5 }}>
        <Box sx={{ width: 24, height: 24, borderRadius: '6px', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, bgcolor: `${colour}22`, color: colour }}>{rank}</Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 14, fontWeight: 600, lineHeight: '18px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{building.name}</Typography>
          <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75, mt: 0.25 }}>
            <StatusDot status={level} size={6} />
            <Typography sx={{ fontSize: 11, fontWeight: 600, color: statusColour }}>{STATUS_LABEL[level]}</Typography>
            <Typography sx={{ fontSize: 11, color: MUTED }}>· {ids.length} sensors</Typography>
          </Stack>
        </Box>
        <Tooltip title="Fly the camera to this subsystem">
          <IconButton size="small" aria-label={`Focus ${building.name} in 3D`} onClick={() => onFocus(building.id)} sx={{ color: '#9CC7F0' }}>
            <CenterFocusStrongOutlined sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Open building details">
          <IconButton size="small" aria-label={`Open ${building.name} details`} onClick={() => onOpen(building.id)} sx={{ color: '#9CC7F0' }}>
            <OpenInNewOutlined sx={{ fontSize: 17 }} />
          </IconButton>
        </Tooltip>
      </Stack>

      {/* Heat + driver */}
      <Box sx={{ px: 2.5, pb: 1.5 }}>
        <Stack direction="row" sx={{ alignItems: 'baseline', justifyContent: 'space-between', mb: 0.75 }}>
          <Typography sx={{ fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Heat</Typography>
          <Typography sx={{ fontSize: 15, fontWeight: 700, color: colour, fontFeatureSettings: '"tnum" 1' }}>{pct(b.heat)}</Typography>
        </Stack>
        <Bar value={b.heat} color={colour} height={6} marker={0.6} />
        {hottest && b.heat > 0.05 && (
          <Typography sx={{ fontSize: 11, color: MUTED, mt: 0.75 }}>
            Driven by <Box component="span" sx={{ color: '#E6EBF2', fontWeight: 600 }}>{hottest.name}</Box>
            {' '}({b.source === 'residual' ? 'model residual' : 'threshold proximity'})
          </Typography>
        )}
      </Box>

      {/* KPI strip */}
      <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(3, ids.length) || 1}, minmax(0, 1fr))`, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        {ids.slice(0, 3).map((id) => {
          const c = catalog[id]; const h = heat?.sensors?.[id] || {};
          return (
            <Box key={id} sx={{ px: 2, py: 1.25, minWidth: 0, borderRight: '1px solid rgba(255,255,255,0.05)', '&:last-child': { borderRight: 0 } }}>
              <Typography sx={{ fontSize: 9.5, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.04em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</Typography>
              <Typography sx={{ fontSize: 15, fontWeight: 700, fontFeatureSettings: '"tnum" 1', color: h.heat >= 0.6 ? heatHex(h.heat) : 'inherit' }}>
                {fmt(h.value, c.unit)}<Box component="span" sx={{ fontSize: 10.5, fontWeight: 400, color: MUTED, ml: 0.5 }}>{c.unit}</Box>
              </Typography>
            </Box>
          );
        })}
      </Box>

      <ButtonBase onClick={onToggle} aria-expanded={expanded} data-testid={`internals-expand-${building.id}`}
        sx={{ width: '100%', justifyContent: 'center', gap: 0.5, py: 0.75, fontSize: 11, fontWeight: 600, color: '#9CC7F0', borderTop: '1px solid rgba(255,255,255,0.06)', '&:hover': { bgcolor: 'rgba(127,178,229,0.08)' } }}>
        {expanded ? 'Hide model internals' : 'Show model internals'}
        <ExpandMoreOutlined sx={{ fontSize: 16, transition: 'transform 0.2s', transform: expanded ? 'rotate(180deg)' : 'none' }} />
      </ButtonBase>
      <Collapse in={expanded} unmountOnExit>
        <Box sx={{ px: 2, pb: 1.5 }}>
          <SensorTable ids={ids} catalog={catalog} heat={heat} />
        </Box>
      </Collapse>
    </Box>
  );
}

const MODE_TITLE = { xray: 'X-ray view', systems: 'Systems view', heatmap: 'Heat map' };

export default function EquipmentTelemetryPanel({
  activeStation = 'maitri', alerts = {}, heat, anomaly, mode = 'heatmap', onFocusBuilding, onOpenBuilding, onClose,
  minimized = false, onToggleMinimized,
}) {
  const [expandedId, setExpandedId] = useState(null);
  const buildings = useMemo(() => buildingList(activeStation), [activeStation]);
  const catalog = useMemo(() => sensorCatalog(activeStation), [activeStation]);
  const levelOf = (id) => (alerts[id] === 'critical' || alerts[id] === 'warning' ? alerts[id] : 'normal');

  const sorted = [...buildings].sort((a, b) => (heat?.buildings?.[b.id]?.heat ?? 0) - (heat?.buildings?.[a.id]?.heat ?? 0));
  const sensorHeats = Object.values(heat?.sensors || {});
  const hot = sensorHeats.filter((s) => s.heat >= 0.6).length;
  const ifScore = anomaly?.anomalyScore; const ifThr = anomaly?.threshold;
  const maxSigma = anomaly?.maxResidualSigma; const gate = anomaly?.residualAlarmSigma || 6;

  return (
    <Box data-testid="equipment-telemetry-panel" role="region" aria-label="Model internals"
      sx={{
        position: 'absolute', top: 52, right: 12, bottom: minimized ? 'auto' : 12, width: minimized ? 'min(340px, calc(100% - 24px))' : 'min(400px, calc(100% - 24px))', zIndex: 3,
        display: 'flex', flexDirection: 'column', gap: 1.25, pointerEvents: 'auto',
        animation: 'aurora-panel-in 0.35s cubic-bezier(0.2,0,0,1)',
      }}>
      {/* Header: station-level model state */}
      <Box sx={{ ...GLASS, p: minimized ? 1.75 : 2.5, flex: 'none' }}>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5, mb: minimized ? 0 : 2 }}>
          <Box sx={{ width: 32, height: 32, borderRadius: '8px', display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, rgba(127,219,255,0.25), rgba(127,178,229,0.08))' }}>
            <MemoryOutlined sx={{ fontSize: 18, color: '#7FDBFF' }} />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{MODE_TITLE[mode] || 'Inspection'}</Typography>
            <Typography sx={{ fontSize: 16, fontWeight: 700, lineHeight: '20px' }}>Model internals</Typography>
            {minimized && (
              <Typography sx={{ fontSize: 11, color: MUTED, mt: 0.25, fontFeatureSettings: '"tnum" 1', whiteSpace: 'nowrap' }}>
                IF {isNum(ifScore) ? ifScore.toFixed(2) : '—'} · {isNum(maxSigma) ? `${maxSigma.toFixed(1)}σ` : '—'} ·{' '}
                <Box component="span" sx={{ color: hot ? '#F97316' : '#5FD08A', fontWeight: 600 }}>{hot} hot</Box>
              </Typography>
            )}
          </Box>
          {!minimized && (
            <Chip size="small" label={anomaly ? 'LIVE' : 'NO MODEL DATA'}
              sx={{ height: 20, fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', border: 0,
                bgcolor: anomaly ? 'rgba(95,208,138,0.15)' : 'rgba(255,255,255,0.08)', color: anomaly ? '#5FD08A' : MUTED }} />
          )}
          {onToggleMinimized && (
            <Tooltip title={minimized ? 'Expand panel' : 'Minimize panel'}>
              <IconButton size="small" data-testid="internals-minimize" aria-expanded={!minimized}
                aria-label={minimized ? 'Expand the model internals panel' : 'Minimize the model internals panel'}
                onClick={onToggleMinimized} sx={{ color: MUTED, '&:hover': { color: '#E6EBF2' } }}>
                {minimized ? <OpenInFullOutlined sx={{ fontSize: 16 }} /> : <RemoveOutlined sx={{ fontSize: 18 }} />}
              </IconButton>
            </Tooltip>
          )}
          {onClose && (
            <IconButton size="small" aria-label="Back to the normal view" onClick={onClose} sx={{ color: MUTED }}>
              <CloseOutlined sx={{ fontSize: 18 }} />
            </IconButton>
          )}
        </Stack>

        {!minimized && (<>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1 }}>
          <Stat label="Isolation F." value={isNum(ifScore) ? ifScore.toFixed(2) : '—'} sub={isNum(ifThr) ? `alarm ≥ ${ifThr.toFixed(2)}` : 'detector offline'}
            color={isNum(ifScore) && isNum(ifThr) ? (ifScore >= ifThr ? '#FF6B6B' : ifScore >= ifThr * 0.85 ? '#F5B83D' : '#5FD08A') : undefined} />
          <Stat label="Max residual" value={isNum(maxSigma) ? `${maxSigma.toFixed(1)}σ` : '—'} sub={`gate ${gate}σ`}
            color={isNum(maxSigma) ? heatHex(maxSigma / gate) : undefined} />
          <Stat label="Hot sensors" value={`${hot}/${sensorHeats.length}`} sub="heat ≥ 60%" color={hot ? '#F97316' : '#5FD08A'} />
        </Box>
        {isNum(ifScore) && isNum(ifThr) && (
          <Box sx={{ mt: 1.75 }}>
            <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 0.5 }}>
              <Typography sx={{ fontSize: 10, color: MUTED }}>Isolation Forest path score</Typography>
              <Typography sx={{ fontSize: 10, color: MUTED }}>{anomaly?.isAnomaly ? 'ANOMALY' : 'within normal'}</Typography>
            </Stack>
            <Bar value={ifScore} color={ifScore >= ifThr ? '#FF6B6B' : '#7FDBFF'} height={5} marker={ifThr} />
          </Box>
        )}
        {anomaly?.candidateCauses?.length > 0 && (
          <Typography sx={{ fontSize: 11, color: '#F5B83D', mt: 1.5 }}>
            Likely cause: {anomaly.candidateCauses.slice(0, 2).map((c) => c.label || c.cause || c.id || String(c)).join(', ')}
          </Typography>
        )}
        </>)}
      </Box>

      {/* Subsystems, hottest first */}
      {!minimized && (
      <Box sx={{
        flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1.25, pr: 0.5,
        '&::-webkit-scrollbar': { width: 5 }, '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(255,255,255,0.15)', borderRadius: 3 },
      }}>
        {sorted.map((b, i) => (
          <SubsystemCard key={b.id} building={b} level={levelOf(b.id)} catalog={catalog} heat={heat} rank={i + 1}
            expanded={expandedId === b.id} onToggle={() => setExpandedId(expandedId === b.id ? null : b.id)}
            onFocus={(id) => onFocusBuilding?.(id)} onOpen={(id) => onOpenBuilding?.(id)} />
        ))}
        <Typography sx={{ fontSize: 10.5, color: MUTED, px: 1, pb: 1, lineHeight: 1.5 }}>
          Heat is the hotter of threshold proximity (station_config.json limits: 60% = warning, 100% = critical)
          and the physics-model residual (100% = the 6σ alarm gate). It is a diagnostic signal, not a probability of failure.
        </Typography>
      </Box>
      )}
    </Box>
  );
}
