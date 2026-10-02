/* ═══════════════════════════════════════════════════════════════
   Aurora — Twin inspector (rollout 1B, checkpoint 2). Replaces the legacy
   TwinInspector overlay with an accessible dialog (full screen on phones).

   Same data and actions: GET /twin-inspector every 3 s while open (one schema
   for simulator and physics fallback), POST /sim/mode for ERA5 replay or
   random-walk test mode (write-protected). Provenance is read from the
   response (environment source type, mode, telemetry source), never assumed;
   the replay instant is the telemetry snapshot's clock, shown in IST.
   ═══════════════════════════════════════════════════════════════ */
import { useState } from 'react';
import {
  Alert, Box, Chip, Dialog, DialogContent, DialogTitle, IconButton, LinearProgress, Stack, Tab, Table, TableBody,
  TableCell, TableHead, TableRow, Tabs, TextField, ToggleButton, ToggleButtonGroup, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import { apiGet, apiPost } from '../../services/api';
import { usePolling } from '../../hooks/usePolling';
import { stationMeta } from '../../data/stationConfig';
import { formatDateTimeIST, formatNumber, formatValue, isNum } from '../../lib/format';
import { describeFailure } from '../../lib/failure';
import ProvenanceChip from '../../ui/Provenance';
import { ErrorState, LoadingBlock } from '../../ui/States';
import WriteButton from '../../ui/WriteButton';

const SOURCE_KIND = { reanalysis: 'REANALYSIS', real: 'REAL', synthetic: 'SIMULATED', 'hardcoded-demo': 'HARDCODED-DEMO' };
const BASIS = {
  documented: { label: 'Documented', help: 'Published specification' },
  estimated: { label: 'Estimated', help: 'Engineering estimate' },
  assumed: { label: 'Assumed', help: 'Prototype assumption' },
};
const n = (v) => (isNum(v) ? v : null);
const pretty = (id) => id.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()).trim();

function Step({ title, kind, children }) {
  return (
    <Box component="section" sx={{ p: 4, borderRadius: '10px', bgcolor: 'aurora.surfaceRaised' }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 2, mb: 3 }}>
        <Typography component="h3" sx={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{title}</Typography>
        {kind && <ProvenanceChip kind={kind} />}
      </Stack>
      {children}
    </Box>
  );
}

function Rows({ rows }) {
  return (
    <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', columnGap: 4, rowGap: 1.5, fontSize: 14 }}>
      {rows.filter(Boolean).map(([k, v, strong]) => (
        <Box key={k} sx={{ display: 'contents' }}>
          <Box component="dt" sx={{ color: strong ? 'text.primary' : 'text.secondary', fontWeight: strong ? 600 : 400 }}>{k}</Box>
          <Box component="dd" sx={{ m: 0, textAlign: 'right', fontFeatureSettings: '"tnum" 1', fontWeight: strong ? 600 : 400 }}>{v}</Box>
        </Box>
      ))}
    </Box>
  );
}

function Formula({ children }) {
  return <Typography sx={{ typography: 'mono', fontSize: 12, color: 'text.secondary', mt: 2 }}>{children}</Typography>;
}

function AssumptionTable({ title, params }) {
  return (
    <Box sx={{ mb: 5 }}>
      <Typography component="h3" sx={{ fontWeight: 600, fontSize: 14, mb: 1 }}>{title}</Typography>
      <Table size="small" aria-label={`${title} parameters`}>
        <TableHead><TableRow><TableCell sx={{ pl: 0 }}>Parameter</TableCell><TableCell align="right">Value</TableCell><TableCell sx={{ pr: 0 }}>Basis</TableCell></TableRow></TableHead>
        <TableBody>
          {Object.entries(params).map(([k, info]) => (
            <TableRow key={k}>
              <TableCell sx={{ pl: 0 }}>{pretty(k)}{info.note && <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>{info.note}</Typography>}</TableCell>
              <TableCell align="right" sx={{ fontFeatureSettings: '"tnum" 1', whiteSpace: 'nowrap' }}>{info.value} {info.unit}</TableCell>
              <TableCell sx={{ pr: 0 }}><Chip size="small" variant="outlined" label={BASIS[info.basis]?.label ?? info.basis} title={BASIS[info.basis]?.help} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

const lastWeek = () => new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);

export default function TwinInspectorDialog({ activeStation, isOpen, onClose, replay }) {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const [tab, setTab] = useState('chain');
  const [state, setState] = useState({ station: null, data: null, error: null });
  const [replayDate, setReplayDate] = useState(lastWeek);
  const [speed, setSpeed] = useState(120);
  const [mode, setMode] = useState({ busy: false, msg: null, ok: null });

  usePolling(async (isActive) => {
    try {
      const d = await apiGet(`/twin-inspector?stationId=${activeStation}`);
      if (isActive()) setState({ station: activeStation, data: d, error: null });
    } catch (err) {
      console.error('[TwinInspector] request failed', err);
      if (isActive()) setState({ station: activeStation, data: null, error: err });
      throw err;
    }
  }, 3000, { key: activeStation, enabled: Boolean(isOpen) });

  const ready = state.station === activeStation;
  const d = ready ? state.data : null;
  const envKind = SOURCE_KIND[d?.environment?.sourceType] ?? null;
  const equipKind = d?.mode === 'simulation' ? 'SIMULATED' : 'MODEL-DERIVED';
  const pb = d?.powerBreakdown || {};
  const g = d?.generatorModel || {};
  const r = d?.dataSource?.replay;

  async function switchMode(body, label) {
    setMode({ busy: true, msg: `${label}…`, ok: null });
    try {
      await apiPost('/sim/mode', body, { timeoutMs: 35000 });
      setMode({ busy: false, msg: `${label}: done. Both stations restarted.`, ok: true });
      if (body.mode === 'reanalysis') setTab('chain');
    } catch (err) {
      console.error('[TwinInspector] mode switch failed', err);
      const detail = typeof err?.body?.detail === 'string' ? ` (${err.body.detail})` : '';
      setMode({ busy: false, msg: err?.status === 503 ? `Simulator offline: mode not changed${detail}` : `Mode not changed: ${describeFailure(err)}`, ok: false });
    }
  }

  return (
    <Dialog open={Boolean(isOpen)} onClose={onClose} fullScreen={phone} maxWidth="md" fullWidth aria-labelledby="twin-inspector-title"
      slotProps={{ paper: { 'data-testid': 'twin-inspector' } }}>
      <DialogTitle id="twin-inspector-title" sx={{ display: 'flex', alignItems: 'center', gap: 2, pr: 2 }}>
        <Box sx={{ flex: 1 }}>
          Twin inspector
          <Typography variant="body2" component="span" sx={{ color: 'text.secondary', ml: 2 }}>{stationMeta(activeStation).name}</Typography>
        </Box>
        <IconButton onClick={onClose} aria-label="Close twin inspector"><CloseOutlined /></IconButton>
      </DialogTitle>
      <Box sx={{ px: 5 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} aria-label="Twin inspector sections" variant="scrollable" allowScrollButtonsMobile>
          <Tab value="chain" label="Causal chain" />
          <Tab value="assumptions" label="Model assumptions" />
          <Tab value="replay" label="Replay and mode" />
        </Tabs>
      </Box>
      <DialogContent sx={{ pt: 4 }} tabIndex={0}>
        {mode.msg && <Alert severity={mode.ok === false ? 'error' : mode.ok ? 'success' : 'info'} sx={{ mb: 3 }} role="status">{mode.msg}</Alert>}
        {!ready && <LoadingBlock lines={8} />}
        {ready && state.error && tab !== 'replay' && <ErrorState>The twin inspector is unavailable because {describeFailure(state.error)}. Retrying.</ErrorState>}

        {d && tab === 'chain' && (
          <Stack sx={{ gap: 3 }} role="tabpanel" aria-label="Causal chain">
            <Box sx={{ p: 4, borderRadius: '10px', border: 1, borderColor: 'divider' }}>
              <Typography variant="body2"><b>{d.dataSource?.label || 'Unknown source'}</b></Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Telemetry: {d.telemetrySource === 'simulator' ? 'live simulator' : d.telemetrySource === 'physics-fallback' ? 'backend physics fallback (simulator offline)' : d.telemetrySource}
                {isNum(replay?.timeMs) && <> · replay time {formatDateTimeIST(replay.timeMs)} ({replay.speedFactor}× real time)</>}
              </Typography>
              {r && <LinearProgress variant="determinate" value={Math.min(100, (r.progress || 0) * 100)} aria-label={`Replay ${formatNumber((r.progress || 0) * 100)}% through its window`} sx={{ mt: 2 }} />}
            </Box>
            <Step title="1 · Environment" kind={envKind}>
              <Rows rows={[
                ['Temperature', formatValue(n(d.environment?.temperature_C), '°C', 1)],
                ['Wind', formatValue(n(d.environment?.wind_kmh), 'km/h', 1)],
                ['Pressure', formatValue(n(d.environment?.pressure_hPa), 'hPa', 1)],
                ['Humidity', formatValue(n(d.environment?.humidity_pct), '%')],
              ]} />
              <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 2 }}>Source: {d.environment?.source || 'unknown'}</Typography>
            </Step>
            <Step title="2 · Thermal model: building heat loss" kind={equipKind}>
              <Table size="small" aria-label="Heat loss by building">
                <TableHead><TableRow><TableCell sx={{ pl: 0 }}>Building</TableCell><TableCell align="right">ΔT inside–outside</TableCell><TableCell align="right" sx={{ pr: 0 }}>Heat loss</TableCell></TableRow></TableHead>
                <TableBody>
                  {Object.entries(d.thermalModel || {}).map(([b, info]) => (
                    <TableRow key={b}><TableCell sx={{ pl: 0 }}>{pretty(b)}</TableCell><TableCell align="right">{formatValue(n(info.delta_T), '°C', 1)}</TableCell><TableCell align="right" sx={{ pr: 0 }}>{formatValue(n(info.heat_loss_kW), 'kW', 1)}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
              <Box sx={{ mt: 3 }}>
                <Rows rows={[
                  ['Total heat loss', formatValue(n(d.totalHeatLoss_kW), 'kW', 1), true],
                  isNum(d.heatingEfficiency) && ['Distribution efficiency (estimated)', formatValue(d.heatingEfficiency * 100, '%')],
                  ['Heating demand', formatValue(n(d.heatingDemand_kW), 'kW', 1), true],
                ]} />
                {isNum(d.heatingEfficiency) && isNum(d.totalHeatLoss_kW) && <Formula>{formatNumber(d.totalHeatLoss_kW, 1)} kW ÷ {d.heatingEfficiency} = {formatNumber(d.heatingDemand_kW, 1)} kW</Formula>}
              </Box>
            </Step>
            <Step title="3 · Power model: electrical demand" kind={equipKind}>
              <Rows rows={[
                ['Buildings (base load)', formatValue(n(pb.base_electrical_kW), 'kW', 1)],
                ['Electrical heating', formatValue(n(pb.heating_electrical_kW), 'kW', 1)],
                ['Water treatment', formatValue(n(pb.water_treatment_kW), 'kW', 1)],
                ['Ventilation', formatValue(n(pb.ventilation_kW), 'kW', 1)],
                ['Communications', formatValue(n(pb.comms_kW), 'kW', 1)],
                ['Total demand (incl. ±2 % model load variation)', formatValue(n(pb.total_demand_kW), 'kW', 1), true],
              ]} />
              {isNum(d.wasteHeatRecovery) && isNum(d.heatingDemand_kW) && (
                <Formula>Electrical heating = {formatNumber(d.heatingDemand_kW, 1)} kW × (1 − {d.wasteHeatRecovery} waste-heat share) = {formatNumber(d.heatingDemand_kW * (1 - d.wasteHeatRecovery), 1)} kW</Formula>
              )}
            </Step>
            <Step title="4 · Generator model" kind={equipKind}>
              <Rows rows={[
                ['Output', formatValue(n(g.power_kW), 'kW', 1)],
                ['Load', `${formatValue(n(g.loadFactor_pct), '%', 1)} of ${formatValue(n(g.maxPower_kW), 'kW')} rated (estimated)`],
                ['Fuel burn', formatValue(n(g.fuelRate_Lhr), 'L/h', 1)],
                ['Coolant temperature', formatValue(n(g.temperature_C), '°C', 1)],
                ['Engine speed', formatValue(n(g.rpm), 'rpm')],
              ]} />
            </Step>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Environment: {d.provenance?.environment}. Equipment: {d.provenance?.equipment}. Equipment values are computed by the model, not measured at the station.
            </Typography>
          </Stack>
        )}

        {d && tab === 'assumptions' && (
          <Box role="tabpanel" aria-label="Model assumptions">
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 4 }}>
              Every physics parameter, classified as documented (published), estimated (engineering estimate) or assumed (prototype assumption).
            </Typography>
            {Object.entries(d.modelAssumptions?.buildings || {}).map(([b, p]) => <AssumptionTable key={b} title={pretty(b)} params={p} />)}
            {d.modelAssumptions?.heating && <AssumptionTable title="Heating system" params={d.modelAssumptions.heating} />}
            {d.modelAssumptions?.generator && <AssumptionTable title="Generator" params={d.modelAssumptions.generator} />}
          </Box>
        )}

        {tab === 'replay' && (
          <Stack sx={{ gap: 4 }} role="tabpanel" aria-label="Replay and mode">
            {r && (
              <Step title="Current replay">
                <Rows rows={[
                  ['Mode', d?.mode],
                  ['Window', r.date_range],
                  ['Speed', `${r.speed_factor}× (${formatNumber(r.speed_factor / 60, 1)} simulated hours per real minute)`],
                  ['Progress', `${formatNumber(r.simulated_hours, 1)} of ${r.total_hours} h (${formatNumber(r.progress * 100, 1)}%)`],
                ]} />
              </Step>
            )}
            <Step title="Replay another window">
              <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
                Downloads (or reuses a cached copy of) 7 days of ERA5 reanalysis from the start date and replays it through the physics model.
                Both stations restart. ERA5 is published with a few days&rsquo; delay.
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 3, alignItems: { sm: 'center' } }}>
                <TextField type="date" size="small" label="Start date" value={replayDate} onChange={(e) => setReplayDate(e.target.value)}
                  slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: '2020-01-01', max: lastWeek() } }} />
                <ToggleButtonGroup exclusive size="small" value={speed} onChange={(_, v) => v && setSpeed(v)} aria-label="Replay speed">
                  {[60, 120, 360, 720].map((s) => <ToggleButton key={s} value={s}>{s}×</ToggleButton>)}
                </ToggleButtonGroup>
              </Stack>
              <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 1 }}>{speed}× = {formatNumber(speed / 60, 1)} simulated hours per real minute</Typography>
              <Box sx={{ mt: 3 }}>
                <WriteButton variant="contained" disabled={mode.busy} onClick={() => switchMode({ mode: 'reanalysis', date: replayDate, speed }, 'Switching to ERA5 replay')}>
                  Start replay
                </WriteButton>
              </Box>
            </Step>
            <Step title="Developer test mode">
              <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>Random-walk weather and equipment instead of the ERA5 replay. Every value is then labelled Simulated.</Typography>
              <WriteButton variant="outlined" disabled={mode.busy} onClick={() => switchMode({ mode: 'simulation' }, 'Switching to test mode')}>Switch to test mode</WriteButton>
            </Step>
          </Stack>
        )}
      </DialogContent>
    </Dialog>
  );
}
