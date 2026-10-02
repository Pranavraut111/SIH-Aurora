/* ═══════════════════════════════════════════════════════════════
   Aurora — Weather module (rollout 1B, checkpoint 1).

   Same data and actions as the legacy EnvironmentalPanel, nothing invented:
   - headline figures: live telemetry (lab.env_*), trends on the model clock
     (ERA5 replay time while replaying), provenance from the snapshot;
   - analysis tabs on the STORED observations (GET /ncpor/observations,
     /anomaly, /forecast, /correlation, /risk), each with its own window and
     provenance string from the backend;
   - "Ingest NCPOR data" (POST /ncpor/ingest), write-protected.

   Labels say what the models are: Isolation Forest / One-Class SVM on value,
   rate of change and the residual from a 5-point rolling mean; ARIMA(1,1,1)
   with its 95 % prediction interval; a polynomial trend with a ±1.96σ band.
   ═══════════════════════════════════════════════════════════════ */
import { useEffect, useState } from 'react';
import {
  Box, Card, Grid, MenuItem, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow,
  Tabs, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import CloudDownloadOutlined from '@mui/icons-material/CloudDownloadOutlined';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import { apiGet, apiPost } from '../../services/api';
import { useSeries, valueAgo } from '../../hooks/useSeries';
import { stationMeta } from '../../data/stationConfig';
import { formatDateTimeIST, formatNumber, formatShortDateTimeIST, formatValue, isNum } from '../../lib/format';
import { fitDomain } from '../../lib/chartScale';
import { centredAverage, formatSpan, onModelClock } from '../../lib/modelClock';
import { FROSTBITE_SOURCE, frostbiteRisk, windChill } from '../../lib/windChill';
import { useChartTheme } from '../../theme/chartTheme';
import { ChartLegend, ChartTipBox } from '../../ui/ChartParts';
import KpiCard from '../../ui/KpiCard';
import PageHeader from '../../ui/PageHeader';
import ProvenanceChip from '../../ui/Provenance';
import ScrollX from '../../ui/ScrollX';
import SectionCard from '../../ui/SectionCard';
import { EmptyState, ErrorState, LoadingBlock } from '../../ui/States';
import { describeFailure } from '../../lib/failure';
import { StatusChip } from '../../ui/Status';
import { MODULES, sectionLabel } from '../../shell/navigation';
import { useConfirm, useToast } from '../../ui/feedbackContext';
import WriteButton from '../../ui/WriteButton';

const KEYS = ['lab.env_temp', 'lab.env_wind', 'lab.env_pressure', 'lab.env_humidity'];
const HOUR = 3_600_000;
const OBS_AVG_MS = 6 * HOUR;
const PARAMS = {
  temperature: { label: 'Temperature', unit: '°C', decimals: 1 },
  wind_speed: { label: 'Wind speed', unit: 'm/s', decimals: 1 },
  air_pressure: { label: 'Air pressure', unit: 'hPa', decimals: 1 },
  relative_humidity: { label: 'Relative humidity', unit: '%', decimals: 0 },
  wind_direction: { label: 'Wind direction', unit: '°', decimals: 0 },
};
const TABS = [
  { id: 'timeseries', label: 'Observations' },
  { id: 'anomaly', label: 'Anomalies' },
  { id: 'forecast', label: 'Forecast' },
  { id: 'correlation', label: 'Correlation' },
  { id: 'risk', label: 'Risk' },
];
const num = (v) => (isNum(v) ? v : null);

/** REAL for the NCPOR AWS feed, REANALYSIS for ERA5, otherwise as given. */
function datasetKind(dataset) {
  if (!dataset) return null;
  if (/NCPOR-AWS-Live/i.test(dataset)) return 'REAL';
  if (/ERA5|reanalysis/i.test(dataset)) return 'REANALYSIS';
  return null;
}

function WindowNote({ window: w, provenance }) {
  if (!w && !provenance) return null;
  return (
    <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 3, display: 'block' }} data-testid="analysis-provenance">
      {provenance || `${w.points} points of ${w.dataset} (${w.source}), ${w.start} → ${w.end}`}
    </Typography>
  );
}

function axisTime(span) {
  return span > 36 * HOUR ? (t) => formatShortDateTimeIST(t).replace(/ \d\d:\d\d$/, '') : (t) => formatShortDateTimeIST(t);
}

// ── Observations: raw + 6 h moving average ─────────────────────
function ObservationsChart({ records, param }) {
  const chart = useChartTheme();
  const pts = records.map((r) => [r.timestamp, r.value]).filter(([t, v]) => isNum(t) && isNum(v)).sort((a, b) => a[0] - b[0]);
  if (pts.length < 2) {
    return <EmptyState title="No observations stored for this parameter">Ingest NCPOR data, or switch to another parameter.</EmptyState>;
  }
  const avg = centredAverage(pts, OBS_AVG_MS);
  const data = pts.map(([t, v], i) => ({ t, v, a: avg[i][1] }));
  const vals = pts.map((p) => p[1]);
  const domain = fitDomain(vals);
  const span = pts.at(-1)[0] - pts[0][0];
  const meta = PARAMS[param];
  const unit = records[0]?.unit || meta.unit;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return (
    <>
      <Stack direction="row" sx={{ gap: 6, flexWrap: 'wrap', mb: 4 }}>
        {[['Points', formatNumber(vals.length)], ['Minimum', formatValue(Math.min(...vals), unit, meta.decimals)],
          ['Mean', formatValue(mean, unit, meta.decimals)], ['Maximum', formatValue(Math.max(...vals), unit, meta.decimals)]].map(([k, v]) => (
          <Box key={k}>
            <Typography variant="caption" component="p" sx={{ color: 'text.secondary', m: 0 }}>{k}</Typography>
            <Typography sx={{ fontWeight: 600, fontFeatureSettings: '"tnum" 1' }}>{v}</Typography>
          </Box>
        ))}
      </Stack>
      <ChartLegend items={[
        { label: `${formatSpan(OBS_AVG_MS)} centred average`, color: chart.accent },
        { label: 'Observations (raw)', color: chart.accent, width: 1, opacity: 0.4 },
      ]} />
      <Box sx={{ height: 300 }} role="img"
        aria-label={`${meta.label}, ${vals.length} observations over ${formatSpan(span)}: from ${formatValue(Math.min(...vals), unit, meta.decimals)} to ${formatValue(Math.max(...vals), unit, meta.decimals)}, latest ${formatValue(vals.at(-1), unit, meta.decimals)}`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={chart.grid} vertical={false} />
            <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={axisTime(span)}
              tick={chart.tick} stroke={chart.axis} tickLine={false} minTickGap={72} />
            <YAxis domain={domain} ticks={domain.ticks} tick={chart.tick} stroke={chart.axis} tickLine={false} axisLine={false} width={48}
              tickFormatter={(v) => formatNumber(v, meta.decimals && Math.abs(domain[1] - domain[0]) < 5 ? 1 : 0)} />
            <ChartTooltip cursor={chart.tooltip.cursor} wrapperStyle={{ outline: 'none' }} content={({ active, payload }) => (active && payload?.length ? (
              <ChartTipBox chart={chart} title={formatDateTimeIST(payload[0].payload.t)}>
                <Box>{formatSpan(OBS_AVG_MS)} centred average: <b>{formatValue(payload[0].payload.a, unit, meta.decimals)}</b></Box>
                <Box sx={{ color: chart.tooltip.labelStyle.color }}>Observed: {formatValue(payload[0].payload.v, unit, meta.decimals)}</Box>
              </ChartTipBox>
            ) : null)} />
            <Line type="linear" dataKey="v" stroke={chart.accent} strokeOpacity={0.4} strokeWidth={1} dot={false} activeDot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="a" stroke={chart.accent} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: chart.accent }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </Box>
      <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', mt: 3 }}>
        {['source', 'dataset', 'sensor', 'quality'].filter((k) => records[0]?.[k]).map((k) => (
          <Typography key={k} variant="caption" sx={{ color: 'text.secondary', mr: 3 }}>
            {k[0].toUpperCase() + k.slice(1)}: <Box component="span" sx={{ color: 'text.primary' }}>{records[0][k]}</Box>
          </Typography>
        ))}
      </Stack>
    </>
  );
}

// ── Anomalies: series with the flagged points ──────────────────
function AnomalyChart({ data: res, param }) {
  const chart = useChartTheme();
  const items = (res?.results || []).filter((r) => isNum(r.timestamp) && isNum(r.value));
  if (res?.status === 'error' || items.length < 2) {
    return <EmptyState title="Not enough observations to score">{res?.message || 'At least a few dozen stored observations are needed.'}</EmptyState>;
  }
  const meta = PARAMS[param];
  const unit = items[0]?.unit || meta.unit;
  const data = items.map((r) => ({ t: r.timestamp, v: r.value, flag: r.is_anomaly ? r.value : null, score: r.anomaly_score }));
  const domain = fitDomain(items.map((r) => r.value));
  const span = data.at(-1).t - data[0].t;
  const flagged = items.filter((r) => r.is_anomaly).length;
  return (
    <>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
        <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>{flagged} of {items.length}</Box> observations flagged
        by {res.algorithm} (contamination {formatNumber((res.contamination_rate ?? 0) * 100)}%). Features: value, rate of change and the
        residual from a 5-point rolling mean. A flag is a statistical outlier in this window, not a confirmed fault.
      </Typography>
      <ChartLegend items={[
        { label: 'Observation', color: chart.accent },
        { label: 'Flagged as outlier', color: chart.status.warning, dot: true },
      ]} />
      <Box sx={{ height: 300 }} role="img" aria-label={`${meta.label}: ${flagged} of ${items.length} observations flagged as outliers by ${res.algorithm}`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={chart.grid} vertical={false} />
            <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={axisTime(span)}
              tick={chart.tick} stroke={chart.axis} tickLine={false} minTickGap={72} />
            <YAxis domain={domain} ticks={domain.ticks} tick={chart.tick} stroke={chart.axis} tickLine={false} axisLine={false} width={48} />
            <ChartTooltip cursor={chart.tooltip.cursor} wrapperStyle={{ outline: 'none' }} content={({ active, payload }) => (active && payload?.length ? (
              <ChartTipBox chart={chart} title={formatDateTimeIST(payload[0].payload.t)}>
                <Box>{formatValue(payload[0].payload.v, unit, meta.decimals)}{payload[0].payload.flag != null && ' · flagged'}</Box>
                <Box sx={{ color: chart.tooltip.labelStyle.color }}>Outlier score {formatNumber(payload[0].payload.score, 3)}</Box>
              </ChartTipBox>
            ) : null)} />
            <Line type="linear" dataKey="v" stroke={chart.accent} strokeWidth={1.5} dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
            <Scatter dataKey="flag" fill={chart.status.warning} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </Box>
      <WindowNote window={res.window} provenance={res.provenance} />
    </>
  );
}

// ── Forecast: history, projection and its band ────────────────
function ForecastChart({ data: res, param }) {
  const chart = useChartTheme();
  if (res?.status === 'error' || !res?.forecast?.length) {
    return <EmptyState title="No forecast">{res?.message || 'At least 12 stored observations are needed.'}</EmptyState>;
  }
  const meta = PARAMS[param];
  const unit = res.forecast[0]?.unit || res.historical?.[0]?.unit || meta.unit;
  const arima = /^ARIMA/.test(res.model || '');
  const bandLabel = arima ? '95 % prediction interval' : /fallback/i.test(res.model) ? '±1.96σ band (fallback)' : '±1.96σ residual band';
  const hist = (res.historical || []).map((h) => ({ t: h.timestamp, h: h.actual }));
  const last = hist.at(-1);
  const fc = res.forecast.map((f) => ({ t: f.timestamp, f: f.predicted, band: [f.lower_bound, f.upper_bound] }));
  const data = [...hist.slice(0, -1), last ? { ...last, f: last.h, band: [last.h, last.h] } : null, ...fc].filter(Boolean);
  const all = [...hist.map((d) => d.h), ...fc.flatMap((d) => d.band)].filter(isNum);
  const domain = fitDomain(all);
  const span = data.at(-1).t - data[0].t;
  return (
    <>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
        <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>{res.model}</Box>, {res.horizon_steps} steps ahead of the
        latest stored observation. Next 6 steps: <b>{formatValue(res.forecast[5]?.predicted, unit, meta.decimals)}</b>
        {res.forecast[23] && <>; 24 steps: <b>{formatValue(res.forecast[23].predicted, unit, meta.decimals)}</b></>}.
      </Typography>
      <ChartLegend items={[
        { label: 'Observed', color: chart.labelFill, width: 1.5 },
        { label: 'Forecast', color: chart.accent, dash: true },
        { label: bandLabel, color: chart.accent, band: true, opacity: 0.2 },
      ]} />
      <Box sx={{ height: 300 }} role="img" aria-label={`${res.model} forecast of ${meta.label.toLowerCase()} for ${res.horizon_steps} steps, with a ${bandLabel}`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={chart.grid} vertical={false} />
            <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={axisTime(span)}
              tick={chart.tick} stroke={chart.axis} tickLine={false} minTickGap={72} />
            <YAxis domain={domain} ticks={domain.ticks} tick={chart.tick} stroke={chart.axis} tickLine={false} axisLine={false} width={48} />
            <ChartTooltip cursor={chart.tooltip.cursor} wrapperStyle={{ outline: 'none' }} content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload;
              return (
                <ChartTipBox chart={chart} title={formatDateTimeIST(d.t)}>
                  {isNum(d.h) && <Box>Observed: <b>{formatValue(d.h, unit, meta.decimals)}</b></Box>}
                  {isNum(d.f) && !isNum(d.h) && <Box>Forecast: <b>{formatValue(d.f, unit, meta.decimals)}</b></Box>}
                  {d.band && !isNum(d.h) && <Box sx={{ color: chart.tooltip.labelStyle.color }}>{bandLabel}: {formatNumber(d.band[0], meta.decimals)}–{formatValue(d.band[1], unit, meta.decimals)}</Box>}
                </ChartTipBox>
              );
            }} />
            <Area type="monotone" dataKey="band" stroke="none" fill={chart.accent} fillOpacity={0.12} isAnimationActive={false} activeDot={false} />
            <Line type="monotone" dataKey="h" stroke={chart.labelFill} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="f" stroke={chart.accent} strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </Box>
      <WindowNote window={res.window} provenance={res.provenance} />
    </>
  );
}

// ── Correlation matrix ─────────────────────────────────────────
function CorrelationTable({ data: res }) {
  const chart = useChartTheme();
  const params = res?.parameters || [];
  if (res?.status === 'error' || params.length < 2) {
    return <EmptyState title="No correlation">{res?.message || 'Two or more parameters with overlapping observations are needed.'}</EmptyState>;
  }
  const m = res.correlation_matrix;
  const label = (p) => PARAMS[p]?.label ?? p.replace(/_/g, ' ');
  return (
    <>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
        Pearson correlation between parameters within the latest contiguous window. Blue is positive, teal is negative;
        the stronger the tint, the stronger the correlation.
      </Typography>
      <ScrollX label="Correlation matrix, scrollable">
        <Table size="small" aria-label="Correlation matrix" sx={{ minWidth: 520 }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ pl: 0 }}>Parameter</TableCell>
              {params.map((p) => <TableCell key={p} align="right">{label(p)}</TableCell>)}
            </TableRow>
          </TableHead>
          <TableBody>
            {params.map((p1) => (
              <TableRow key={p1}>
                <TableCell component="th" scope="row" sx={{ pl: 0, fontWeight: 600 }}>{label(p1)}</TableCell>
                {params.map((p2) => {
                  const r = m[p1]?.[p2];
                  const tint = isNum(r) ? (r >= 0 ? chart.series[0] : chart.series[1]) : 'transparent';
                  return (
                    <TableCell key={p2} align="right" sx={{ fontFeatureSettings: '"tnum" 1', position: 'relative' }}>
                      <Box aria-hidden="true" sx={{ position: 'absolute', inset: 2, borderRadius: '4px', backgroundColor: tint, opacity: isNum(r) ? Math.abs(r) * 0.35 : 0 }} />
                      <Box component="span" sx={{ position: 'relative' }}>{isNum(r) ? `${r >= 0 ? '+' : '−'}${formatNumber(Math.abs(r), 2)}` : '—'}</Box>
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollX>
      <WindowNote window={res.window} provenance={res.provenance} />
    </>
  );
}

// ── Rule-based risk ────────────────────────────────────────────
const HEALTH_STATUS = { healthy: 'normal', warning: 'warning', critical: 'critical' };
function RiskView({ data: res }) {
  if (!res || res.status === 'error') return <EmptyState title="No risk assessment">{res?.message}</EmptyState>;
  const fb = frostbiteRisk(res.wind_chill_c);
  const status = HEALTH_STATUS[res.overall_health] || 'normal';
  return (
    <Stack sx={{ gap: 5 }}>
      <Grid container spacing={4}>
        <Grid size={{ xs: 12, sm: 5 }}>
          <Typography variant="label" component="p" sx={{ color: 'text.secondary' }}>Risk index (rule-based, 0–100)</Typography>
          <Stack direction="row" sx={{ alignItems: 'baseline', gap: 2, mt: 1 }}>
            <Typography variant="kpi" component="p" sx={{ m: 0 }}>{formatNumber(res.risk_score)}</Typography>
            <StatusChip status={status} label={res.overall_health === 'healthy' ? 'Normal' : undefined} />
          </Stack>
        </Grid>
        <Grid size={{ xs: 12, sm: 7 }}>
          <Typography variant="label" component="p" sx={{ color: 'text.secondary' }}>Wind chill</Typography>
          <Stack direction="row" sx={{ alignItems: 'baseline', gap: 2, mt: 1, flexWrap: 'wrap' }}>
            <Typography variant="kpi" component="p" sx={{ m: 0 }}>{formatValue(res.wind_chill_c, '°C', 1)}</Typography>
            {fb && <StatusChip status={fb.status} label={`${fb.level} risk`} />}
          </Stack>
          {fb && (
            <>
              <Typography variant="body2" sx={{ mt: 1 }}>{fb.text}</Typography>
              <Tooltip title={FROSTBITE_SOURCE.table}>
                <Typography variant="caption" component="p" tabIndex={0} data-testid="frostbite-source"
                  sx={{ color: 'text.secondary', mt: 0.5, textDecoration: 'underline dotted', textUnderlineOffset: 3, width: 'fit-content' }}>
                  Source: {FROSTBITE_SOURCE.short}
                </Typography>
              </Tooltip>
            </>
          )}
        </Grid>
      </Grid>
      <Box>
        <Typography variant="h3" component="h3" sx={{ mb: 2 }}>Rules triggered</Typography>
        {res.identified_risks?.length ? (
          <Stack sx={{ gap: 3 }}>
            {res.identified_risks.map((r) => (
              <Card key={r.risk_id} variant="outlined" sx={{ p: 4, backgroundColor: 'aurora.surfaceRaised', borderColor: 'transparent' }}>
                <Stack direction="row" sx={{ gap: 2, alignItems: 'center', flexWrap: 'wrap', mb: 2 }}>
                  <StatusChip status={r.risk_level === 'critical' ? 'critical' : 'warning'} />
                  <Typography sx={{ fontWeight: 600 }}>{r.affected_system}</Typography>
                  <Typography variant="caption" sx={{ typography: 'mono', color: 'text.secondary' }}>{r.risk_id}</Typography>
                </Stack>
                <Typography variant="body2">{r.reason}</Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>Suggested action: {r.recommended_action}</Typography>
              </Card>
            ))}
          </Stack>
        ) : (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>No rule triggered: the latest stored observations are within the engine&rsquo;s limits.</Typography>
        )}
      </Box>
      <Typography variant="caption" component="p" sx={{ color: 'text.secondary', m: 0 }}>
        {res.provenance}. Based on the latest stored observations, not the live telemetry above.
      </Typography>
    </Stack>
  );
}

export default function WeatherModule({
  sensorData = {}, activeStation = 'maitri', provenance, telemetrySource, timestamp, replay, updatedAt, activeAlerts = [],
}) {
  const meta = MODULES.environmental;
  const confirm = useConfirm();
  const toast = useToast();
  const env = sensorData.lab || {};
  const temp = num(env.env_temp);
  const wind = num(env.env_wind);
  const pres = num(env.env_pressure);
  const hum = num(env.env_humidity);
  const chill = windChill(temp, wind);

  const replayMs = num(replay?.timeMs);
  const raw = useSeries({ station: activeStation, keys: KEYS, minutes: 30, sensors: sensorData, timestamp, source: telemetrySource, replayMs });
  const { clock, series } = onModelClock(raw.series, KEYS, replayMs);
  const tempAgo = valueAgo(series['lab.env_temp'], clock.deltaMs);
  const level = (sensor) => {
    const l = activeAlerts.filter((a) => a.sensor === sensor).map((a) => a.level);
    return l.includes('critical') ? 'critical' : l.includes('warning') ? 'warning' : undefined;
  };

  // ── Analysis tabs (stored observations) ──
  const [tab, setTab] = useState('timeseries');
  const [param, setParam] = useState('temperature');
  const [algo, setAlgo] = useState('isf');
  const [model, setModel] = useState('arima');
  const [horizon, setHorizon] = useState(24);
  const [attempt, setAttempt] = useState(0);
  const reqKey = `${activeStation}|${tab}|${param}|${algo}|${model}|${horizon}|${attempt}`;
  const [result, setResult] = useState({ key: null, data: null, error: null });

  useEffect(() => {
    let active = true;
    const path = {
      timeseries: `/ncpor/observations?stationId=${activeStation}&parameter=${param}&limit=240`,
      anomaly: `/anomaly?stationId=${activeStation}&parameter=${param}&algorithm=${algo}`,
      forecast: `/forecast?stationId=${activeStation}&parameter=${param}&model=${model}&horizon=${horizon}`,
      correlation: `/correlation?stationId=${activeStation}`,
      risk: `/risk?stationId=${activeStation}`,
    }[tab];
    apiGet(path)
      .then((data) => { if (active) setResult({ key: reqKey, data, error: null }); })
      .catch((error) => {
        console.error(`[WeatherModule] ${tab} failed`, error);
        if (active) setResult({ key: reqKey, data: null, error });
      });
    return () => { active = false; };
  }, [reqKey, activeStation, tab, param, algo, model, horizon]);
  const current = result.key === reqKey ? result : null;
  const obsRecords = tab === 'timeseries' ? (current?.data?.records || []) : [];
  const chartDataset = current?.data?.window?.dataset ?? obsRecords[0]?.dataset ?? null;

  // ── Ingest (write) ──
  const [ingesting, setIngesting] = useState(false);
  async function runIngest() {
    const ok = await confirm({
      title: `Ingest NCPOR data for ${stationMeta(activeStation).name}?`,
      body: 'Fetches the NCPOR AWS live page and stores the new observations in the station database.',
      confirmLabel: 'Ingest',
    });
    if (!ok) return;
    setIngesting(true);
    try {
      const res = await apiPost(`/ncpor/ingest?stationId=${activeStation}`);
      const r = res?.results?.[activeStation];
      toast(r?.status === 'success'
        ? { text: `Ingested ${formatNumber(r.records_ingested)} records from ${r.source} (${(r.parameters || []).length} series).` }
        : { severity: 'error', text: `Ingest failed: ${r?.error || r?.message || 'no result returned'}. Nothing was stored.` });
      setAttempt((n) => n + 1);
    } catch (err) {
      console.error('[WeatherModule] ingest failed', err);
      toast({ severity: 'error', text: `Ingest failed: ${describeFailure(err)}.` });
    } finally {
      setIngesting(false);
    }
  }

  const envKind = provenance?.environment;
  const station = stationMeta(activeStation).name;
  const deltaTemp = temp != null && tempAgo != null ? temp - tempAgo : null;
  const ingestButton = (
    <WriteButton variant="outlined" size="small" startIcon={<CloudDownloadOutlined />} onClick={runIngest}
      disabled={ingesting} data-testid="ncpor-ingest">
      {ingesting ? 'Ingesting…' : 'Ingest NCPOR data'}
    </WriteButton>
  );

  return (
    <Box data-testid="weather-module">
      <PageHeader
        tourId="environmental"
        section={sectionLabel(meta.section)}
        title={meta.title}
        description={`${meta.description} ${station} station.`}
        updatedAt={updatedAt}
        updatedLabel="Snapshot"
        provenance={<>
          {envKind && <ProvenanceChip kind={envKind} subject="Live figures"
            detail={provenance?.weatherSource ? `Weather source: ${provenance.weatherSource}.` : undefined} />}
          {chartDataset && <ProvenanceChip kind={datasetKind(chartDataset) || 'REANALYSIS'} subject="Charts" detail={`Stored dataset: ${chartDataset}.`} />}
        </>}
        actions={ingestButton}
      />


      <Typography variant="h2" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>Current weather</Typography>
      <Box component="section" aria-label="Current weather" data-testid="weather-kpis" sx={{
        display: 'grid', gap: 4, mb: 4,
        gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', lg: 'minmax(0, 1.6fr) repeat(2, minmax(0, 1fr))' },
        gridTemplateAreas: { xs: '"hero hero" "a b" "c c"', sm: '"hero hero" "a b" "c c"', lg: '"hero a b" "hero c c"' },
      }}>
        <KpiCard hero label="Air temperature" value={temp} unit="°C" decimals={1} testId="kpi-air-temp" sx={{ gridArea: 'hero' }}
          status={level('env_temp')} series={series['lab.env_temp']} sparkBucketMs={clock.sparkBucketMs}
          delta={deltaTemp} deltaLabel={clock.deltaLabel}
          context={[chill != null && `Wind chill ${formatValue(chill, '°C', 1)}`, `last ${formatSpan(spanOf(series['lab.env_temp']))} (${clock.suffix})`].filter(Boolean).join(' · ')} />
        <KpiCard label="Wind" value={wind} unit="km/h" testId="kpi-wind" sx={{ gridArea: 'a' }}
          status={level('env_wind')} series={series['lab.env_wind']} sparkBucketMs={clock.sparkBucketMs}
          context={wind != null ? `${formatValue(wind / 3.6, 'm/s', 1)}` : null} />
        <KpiCard label="Pressure" value={pres} unit="hPa" decimals={1} testId="kpi-pressure" sx={{ gridArea: 'b' }}
          status={level('env_pressure')} series={series['lab.env_pressure']} sparkBucketMs={clock.sparkBucketMs} />
        <KpiCard label="Relative humidity" value={hum} unit="%" testId="kpi-humidity" sx={{ gridArea: 'c' }}
          status={level('env_humidity')} series={series['lab.env_humidity']} sparkBucketMs={clock.sparkBucketMs}
          context={envKind ? `Source: ${envKind === 'REANALYSIS' ? 'ERA5 reanalysis replay' : envKind === 'REAL' ? 'NCPOR AWS' : envKind.toLowerCase()}` : null} />
      </Box>

      <SectionCard title="Stored observations and analysis" testId="weather-analysis"
        subtitle="Stored NCPOR AWS and ERA5 rows in the station database, not the live figures above"
        provenance={chartDataset ? <ProvenanceChip kind={datasetKind(chartDataset) || 'REANALYSIS'} /> : null}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" allowScrollButtonsMobile aria-label="Analysis" sx={{ mb: 4 }}>
          {TABS.map((t) => <Tab key={t.id} value={t.id} label={t.label} data-testid={`weather-tab-${t.id}`} />)}
        </Tabs>

        {tab !== 'correlation' && tab !== 'risk' && (
          <Stack direction="row" sx={{ gap: 3, flexWrap: 'wrap', alignItems: 'center', mb: 4 }}>
            <TextField select size="small" label="Parameter" value={param} onChange={(e) => setParam(e.target.value)} sx={{ minWidth: 200 }}>
              {Object.entries(PARAMS).map(([k, v]) => <MenuItem key={k} value={k}>{v.label} ({v.unit})</MenuItem>)}
            </TextField>
            {tab === 'anomaly' && (
              <ToggleButtonGroup exclusive size="small" value={algo} onChange={(_, v) => v && setAlgo(v)} aria-label="Algorithm">
                <ToggleButton value="isf">Isolation Forest</ToggleButton>
                <ToggleButton value="svm">One-Class SVM</ToggleButton>
              </ToggleButtonGroup>
            )}
            {tab === 'forecast' && (
              <>
                <ToggleButtonGroup exclusive size="small" value={model} onChange={(_, v) => v && setModel(v)} aria-label="Model">
                  <ToggleButton value="arima">ARIMA(1,1,1)</ToggleButton>
                  <ToggleButton value="trend">Polynomial trend</ToggleButton>
                </ToggleButtonGroup>
                <TextField select size="small" label="Horizon" value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} sx={{ minWidth: 140 }}>
                  {[12, 24, 48].map((h) => <MenuItem key={h} value={h}>{h} steps</MenuItem>)}
                </TextField>
              </>
            )}
          </Stack>
        )}

        <Box role="tabpanel" aria-label={TABS.find((t) => t.id === tab).label} data-testid="weather-tabpanel">
          {!current ? (
            <LoadingBlock height={tab === 'risk' || tab === 'correlation' ? 200 : 340} />
          ) : current.error ? (
            <ErrorState onRetry={() => setAttempt((n) => n + 1)}>
              This analysis is unavailable because {describeFailure(current.error)}. The live figures above are unaffected.
            </ErrorState>
          ) : tab === 'timeseries' ? (
            <ObservationsChart records={obsRecords} param={param} />
          ) : tab === 'anomaly' ? (
            <AnomalyChart data={current.data} param={param} />
          ) : tab === 'forecast' ? (
            <ForecastChart data={current.data} param={param} />
          ) : tab === 'correlation' ? (
            <CorrelationTable data={current.data} />
          ) : (
            <RiskView data={current.data} />
          )}
        </Box>
      </SectionCard>
    </Box>
  );
}

function spanOf(points) {
  return points?.length > 1 ? points.at(-1)[0] - points[0][0] : null;
}
