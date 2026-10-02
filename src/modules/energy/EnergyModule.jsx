/* ═══════════════════════════════════════════════════════════════
   Aurora — Energy grid module (design-system prototype, docs/ui-redesign.md).

   Same data as the legacy EnergyPanel, nothing invented:
   - generation, fuel rate, rpm, coolant AND the demand split and heat figures:
     ONE telemetry snapshot (WebSocket). The physics energy breakdown travels in
     the snapshot with the readings of the same tick, so generation and total
     demand always agree, and the snapshot time is shown;
   - the last 30 min of those readings: the backend's rolling history
     (GET /api/history), extended live; the 15-min average fuel burn and the
     deltas come from it;
   - rated power and heating parameters: GET /twin-inspector (model parameters);
   - fuel stock: GET /logistics (operator-entered ledger).
   Missing values render as "—", never as a default.
   ═══════════════════════════════════════════════════════════════ */
import { useState } from 'react';
import {
  Alert, Box, Button, Grid, Skeleton, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import { apiGet } from '../../services/api';
import { usePolling } from '../../hooks/usePolling';
import { rollingMean, useSeries, valueAgo } from '../../hooks/useSeries';
import { sensorCatalog, stationMeta } from '../../data/stationConfig';
import { formatDateTimeIST, formatNumber, formatShortDateTimeIST, formatTimeIST, formatValue, isNum } from '../../lib/format';
import { formatSpan, movingAverage, onModelClock } from '../../lib/modelClock';
import { useChartTheme } from '../../theme/chartTheme';
import { fitDomain, sharesTo100 } from '../../lib/chartScale';
import { sensorStatus, thresholdText } from '../../lib/thresholds';
import { ChartLegend } from '../../ui/ChartParts';
import KpiCard from '../../ui/KpiCard';
import PageHeader from '../../ui/PageHeader';
import ProvenanceChip from '../../ui/Provenance';
import SectionCard from '../../ui/SectionCard';
import { MODULES, sectionLabel } from '../../shell/navigation';

const num = (v) => (isNum(v) ? v : null);
const WINDOW_MIN = 30;   // wall-clock minutes of history kept (= 60 h of replay at 120×)
const SERIES_KEYS = ['generator.gen_power', 'generator.gen_fuel_rate', 'generator.gen_temp', 'generator.gen_rpm'];
// Present for screen readers (keeps the heading outline intact), invisible on screen.
const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0, p: 0, m: -1 / 4 };
const hhmm = (t) => formatTimeIST(t).slice(0, 5);

function ChartTip({ active, payload, clock, maLabel, chart }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const when = clock.kind === 'replay' ? `${formatDateTimeIST(row.time)} (replay)` : formatTimeIST(row.time);
  const line = (label, avg, rawV, unit) => (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'auto auto auto', columnGap: 2 }}>
      <Box sx={{ color: chart.tooltip.labelStyle.color }}>{label}</Box>
      <Box sx={{ textAlign: 'right' }}><b>{formatValue(avg, unit, 1)}</b></Box>
      <Box sx={{ textAlign: 'right', color: chart.tooltip.labelStyle.color }}>raw {formatValue(rawV, unit, 1)}</Box>
    </Box>
  );
  return (
    <Box sx={{ ...chart.tooltip.contentStyle, boxShadow: chart.mode === 'dark' ? '0 8px 24px rgba(0,0,0,.45)' : '0 8px 24px rgba(23,27,33,.12)' }}>
      <Box sx={{ color: chart.tooltip.labelStyle.color, mb: 0.5 }}>{when} · {maLabel}</Box>
      {line('Generation', row.genAvg, row.gen, 'kW')}
      {line('Fuel burn', row.fuelAvg, row.fuel, 'L/h')}
    </Box>
  );
}

/** Join two series sampled on the same ticks (one snapshot each) by time. */
function joinByTime(a, b) {
  const byT = new Map((b || []).map(([t, v]) => [t, v]));
  return (a || []).filter(([t]) => byT.has(t)).map(([t, v]) => [t, v, byT.get(t)]);
}

function OutputChart({ powerPoints, fuelPoints, loaded, ratedKW, lowWarnKW, clock }) {
  const chart = useChartTheme();
  const joined = joinByTime(powerPoints, fuelPoints);
  if (!loaded) return <Skeleton variant="rounded" height={300} />;
  if (joined.length < 2) {
    return (
      <Box sx={{ height: 300, display: 'grid', placeItems: 'center' }}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>Collecting samples. The chart fills in as telemetry arrives.</Typography>
      </Box>
    );
  }
  // Primary lines: trailing moving averages on the model clock; raw samples stay visible,
  // thin and faint, with no fill. Generation on the left axis, fuel burn on the right.
  const genAvg = movingAverage(joined.map(([t, g]) => [t, g]), clock.maMs);
  const fuelAvg = movingAverage(joined.map(([t, , f]) => [t, f]), clock.maMs);
  const data = joined.map(([time, gen, fuel], i) => ({ time, gen, fuel, genAvg: genAvg[i][1], fuelAvg: fuelAvg[i][1] }));
  const maLabel = `${formatSpan(clock.maMs)} average`;
  const gens = data.map((d) => d.gen);
  const dataMax = Math.max(...gens);
  // Rated capacity is drawn when it is near enough to keep the line readable; otherwise the
  // axis stays fitted to the data and the caption says the reference is off scale.
  const showRated = isNum(ratedKW) && ratedKW <= dataMax * 1.3;
  // Fuel burn is linear in generation (Willans line), so the two lines share a shape: give
  // each its own band, generation in the upper half and fuel burn in the lower half.
  const band = (vals, where) => {
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = Math.max(hi - lo, Math.abs(hi) * 0.02) * 1.1;
    return where === 'upper' ? [lo - pad] : [hi + pad];
  };
  const domain = fitDomain(gens, { include: [...band(gens, 'upper'), ...(showRated ? [ratedKW] : [])] });
  const fuels = data.map((d) => d.fuel);
  const fuelDomain = fitDomain(fuels, { include: band(fuels, 'lower') });
  const inRange = (y) => isNum(y) && y >= domain[0] && y <= domain[1];
  const offScale = [
    isNum(ratedKW) && !inRange(ratedKW) && `rated capacity ${formatValue(ratedKW, 'kW')}`,
    isNum(lowWarnKW) && !inRange(lowWarnKW) && `low-power warning ${formatValue(lowWarnKW, 'kW')}`,
  ].filter(Boolean);
  const span = data.at(-1).time - data[0].time;
  const tickFmt = clock.kind === 'replay' ? formatShortDateTimeIST : hhmm;
  const [cGen, cFuel] = chart.series;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <ChartLegend items={[
        { label: `Generation, ${maLabel} (kW, left)`, color: cGen, width: 2, opacity: 1 },
        { label: `Fuel burn, ${maLabel} (L/h, right)`, color: cFuel, width: 2, opacity: 1 },
        { label: 'Raw samples, one per tick', color: chart.labelFill, width: 1, opacity: 0.5 },
      ]} />
      <Box sx={{ flex: 1, minHeight: 300 }} role="img"
        aria-label={`Generation and fuel burn over the last ${formatSpan(span)} of ${clock.suffix}. Generation ${maLabel.toLowerCase()} latest ${formatValue(genAvg.at(-1)[1], 'kW', 1)}; fuel burn ${maLabel.toLowerCase()} latest ${formatValue(fuelAvg.at(-1)[1], 'L/h', 1)}.`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 12, right: 0, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={chart.grid} vertical={false} />
            <XAxis dataKey="time" type="number" domain={['dataMin', 'dataMax']} scale="time"
              tickFormatter={tickFmt} tick={chart.tick} stroke={chart.axis} tickLine={false} minTickGap={clock.kind === 'replay' ? 72 : 48} />
            <YAxis yAxisId="kw" tick={chart.tick} stroke={chart.axis} tickLine={false} axisLine={false} width={44}
              domain={domain} ticks={domain.ticks} tickFormatter={(v) => formatNumber(v)} />
            <YAxis yAxisId="lph" orientation="right" tick={chart.tick} stroke={chart.axis} tickLine={false} axisLine={false} width={40}
              domain={fuelDomain} ticks={fuelDomain.ticks} tickFormatter={(v) => formatNumber(v)} />
            {inRange(ratedKW) && (
              <ReferenceLine yAxisId="kw" y={ratedKW} stroke={chart.referenceLine.neutral} strokeDasharray="4 4"
                label={{ value: `Rated ${formatValue(ratedKW, 'kW')}`, position: 'insideTopRight', fill: chart.labelFill, fontSize: 12 }} />
            )}
            {inRange(lowWarnKW) && (
              <ReferenceLine yAxisId="kw" y={lowWarnKW} stroke={chart.referenceLine.warning} strokeDasharray="4 4"
                label={{ value: `Low-power warning ${formatValue(lowWarnKW, 'kW')}`, position: 'insideBottomRight', fill: chart.labelFill, fontSize: 12 }} />
            )}
            <ChartTooltip cursor={chart.tooltip.cursor} wrapperStyle={{ outline: 'none' }}
              content={<ChartTip clock={clock} maLabel={maLabel} chart={chart} />} />
            <Line yAxisId="kw" type="linear" dataKey="gen" stroke={cGen} strokeOpacity={0.25} strokeWidth={1} dot={false} activeDot={false} isAnimationActive={false} />
            <Line yAxisId="lph" type="linear" dataKey="fuel" stroke={cFuel} strokeOpacity={0.25} strokeWidth={1} dot={false} activeDot={false} isAnimationActive={false} />
            <Line yAxisId="kw" type="monotone" dataKey="genAvg" stroke={cGen} strokeWidth={2} dot={false}
              activeDot={{ r: 4, strokeWidth: 0, fill: cGen }} isAnimationActive={false} />
            <Line yAxisId="lph" type="monotone" dataKey="fuelAvg" stroke={cFuel} strokeWidth={2} dot={false}
              activeDot={{ r: 4, strokeWidth: 0, fill: cFuel }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </Box>
      {offScale.length > 0 && (
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 2 }} data-testid="chart-off-scale">
          Left axis fitted to the data; {offScale.join(' and ')} {offScale.length > 1 ? 'are' : 'is'} outside the visible range.
        </Typography>
      )}
    </Box>
  );
}

function Swatch({ color }) {
  return <Box aria-hidden="true" sx={{ width: 10, height: 10, borderRadius: '3px', flex: 'none', backgroundColor: color }} />;
}

function DemandBreakdown({ rows, variation, total, matchesGeneration }) {
  const chart = useChartTheme();
  const colour = (i) => chart.series[i % chart.series.length];
  const showVariation = isNum(variation) && Math.abs(variation) >= 0.05;
  // Shares are of the modelled consumers only, rounded so they add up to exactly 100 %.
  // Load variation is model noise, not a consumer: shown signed in kW, outside the shares and the bar.
  const consumersKW = rows.reduce((sum, r) => sum + (r.kw ?? 0), 0);
  const shares = sharesTo100(rows.map((r) => r.kw ?? 0));
  return (
    <Stack sx={{ gap: 5 }}>
      <Box
        role="img"
        aria-label={`Electrical demand split across ${rows.length} consumers, ${formatValue(consumersKW, 'kW', 1)} in total`}
        sx={{ display: 'flex', height: 14, borderRadius: '4px', overflow: 'hidden', gap: '2px' }}
      >
        {rows.map((r, i) => (
          <Box key={r.label} sx={{ flex: `${Math.max(r.kw ?? 0, 0)} 0 0`, backgroundColor: colour(i) }} />
        ))}
      </Box>
      <Table size="small" aria-label="Electrical demand by consumer">
        <TableHead>
          <TableRow>
            <TableCell sx={{ pl: 0 }}>Consumer</TableCell>
            <TableCell align="right">kW</TableCell>
            <TableCell align="right" sx={{ pr: 0 }}>Share</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={r.label}>
              <TableCell sx={{ pl: 0 }}>
                <Stack direction="row" sx={{ alignItems: 'center', gap: 2 }}><Swatch color={colour(i)} />{r.label}</Stack>
              </TableCell>
              <TableCell align="right" sx={{ fontFeatureSettings: '"tnum" 1' }}>{formatNumber(r.kw, 1)}</TableCell>
              <TableCell align="right" sx={{ pr: 0, fontFeatureSettings: '"tnum" 1', color: 'text.secondary' }}>
                {consumersKW > 0 ? `${shares[i]}%` : '—'}
              </TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell sx={{ pl: 0, fontWeight: 600 }}>Consumers</TableCell>
            <TableCell align="right" sx={{ fontFeatureSettings: '"tnum" 1', fontWeight: 600 }}>{formatNumber(consumersKW, 1)}</TableCell>
            <TableCell align="right" sx={{ pr: 0, fontFeatureSettings: '"tnum" 1', fontWeight: 600 }}>100%</TableCell>
          </TableRow>
          {showVariation && (
            <TableRow data-testid="load-variation-row">
              <TableCell sx={{ pl: 0, color: 'text.secondary' }}>Load variation (model noise)</TableCell>
              <TableCell align="right" sx={{ fontFeatureSettings: '"tnum" 1', color: 'text.secondary' }}>
                {variation > 0 ? '+' : '−'}{formatNumber(Math.abs(variation), 1)}
              </TableCell>
              <TableCell align="right" sx={{ pr: 0, color: 'text.secondary' }}>n/a</TableCell>
            </TableRow>
          )}
          <TableRow>
            <TableCell sx={{ pl: 0, fontWeight: 600, borderBottom: 0 }}>{matchesGeneration ? 'Total demand = generation' : 'Total modelled demand'}</TableCell>
            <TableCell align="right" sx={{ fontFeatureSettings: '"tnum" 1', fontWeight: 600, borderBottom: 0 }}>{formatNumber(total, 1)}</TableCell>
            <TableCell sx={{ borderBottom: 0, pr: 0 }} />
          </TableRow>
        </TableBody>
      </Table>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        Shares are of the modelled consumers. The model has no storage, so the generator supplies
        the total demand: the consumers plus the model&rsquo;s ±2 % load variation, which no
        consumer carries and which is therefore not given a share.
      </Typography>
    </Stack>
  );
}

function FactRow({ label, value, note }) {
  return (
    <TableRow>
      <TableCell sx={{ pl: 0 }}>
        {label}
        {note && <Typography variant="caption" component="span" sx={{ color: 'text.secondary', ml: 1 }}>({note})</Typography>}
      </TableCell>
      <TableCell align="right" sx={{ fontFeatureSettings: '"tnum" 1', pr: 0, color: value === 'Not modelled' ? 'text.secondary' : 'text.primary' }}>{value}</TableCell>
    </TableRow>
  );
}

function autonomyContext({ fuelError, stockL, avg, clock }) {
  if (fuelError) return 'Fuel ledger unavailable';
  if (stockL == null) return 'No fuel stock in the ledger';
  const filling = avg.spanMs < clock.avgMs * 0.95;
  const basis = `at ${formatSpan(filling ? avg.spanMs : clock.avgMs)} average burn (${clock.suffix}${filling ? ', history filling' : ''})`;
  return `${formatValue(stockL, 'L')} in stock (ledger) ${basis}`;
}

export default function EnergyModule({
  sensorData = {}, energy = null, replay = null, provenance = null, activeAlerts = [], activeStation = 'maitri',
  telemetrySource, timestamp, updatedAt,
}) {
  const meta = MODULES.energy;
  const catalog = sensorCatalog(activeStation);
  const gen = sensorData.generator || {};
  const powerKW = num(gen.gen_power);
  const fuelRateLph = num(gen.gen_fuel_rate);
  const rpm = num(gen.gen_rpm);
  const coolantC = num(gen.gen_temp);

  const replayMs = num(replay?.timeMs);
  const raw = useSeries({
    station: activeStation, keys: SERIES_KEYS, minutes: WINDOW_MIN, sensors: sensorData, timestamp, source: telemetrySource, replayMs,
  });
  const loaded = raw.loaded;
  // Every window below is on the model's clock: the ERA5 replay clock when there is one.
  const { clock, series } = onModelClock(raw.series, SERIES_KEYS, replayMs);
  const powerPts = series['generator.gen_power'];
  const fuelPts = series['generator.gen_fuel_rate'];

  const [twin, setTwin] = useState({ station: null, data: null, error: null });
  const [fuel, setFuel] = useState({ station: null, item: null, error: null });
  const [attempt, setAttempt] = useState(0);
  // Model parameters and the fuel ledger change rarely; the live figures come from the snapshot.
  usePolling(async (isActive) => {
    let failed = null;
    try {
      const data = await apiGet(`/twin-inspector?stationId=${activeStation}`);
      if (isActive()) setTwin({ station: activeStation, data, error: null });
    } catch (err) {
      console.error('[EnergyModule] twin-inspector failed', err);
      if (isActive()) setTwin({ station: activeStation, data: null, error: err });
      failed = err;
    }
    try {
      const inv = await apiGet(`/logistics?stationId=${activeStation}`);
      const item = (inv.items || []).find((i) => i.id === `${activeStation}-fuel`) || null;
      if (isActive()) setFuel({ station: activeStation, item, error: null });
    } catch (err) {
      console.error('[EnergyModule] logistics failed', err);
      if (isActive()) setFuel({ station: activeStation, item: null, error: err });
      failed = failed || err;
    }
    if (failed) throw failed;           // let usePolling back off
  }, 30000, { key: `${activeStation}:${attempt}` });

  const twinData = twin.station === activeStation ? twin.data : null;
  const twinError = twin.station === activeStation ? twin.error : null;
  const twinLoading = !twinData && !twinError;
  const fuelItem = fuel.station === activeStation ? fuel.item : null;
  const fuelError = fuel.station === activeStation ? fuel.error : null;

  const ratedKW = num(twinData?.generatorModel?.maxPower_kW);
  const loadPct = num(energy?.loadPct) ?? (powerKW != null && ratedKW ? (powerKW / ratedKW) * 100 : null);
  const totalDemand = num(energy?.totalDemand_kW);
  const demandRows = [
    { label: 'Buildings (base load)', kw: num(energy?.baseElectrical_kW) },
    { label: 'Electrical heating', kw: num(energy?.heatingElectrical_kW) },
    { label: 'Ventilation', kw: num(energy?.ventilation_kW) },
    { label: 'Water treatment', kw: num(energy?.waterTreatment_kW) },
    { label: 'Communications', kw: num(energy?.comms_kW) },
  ];
  const parts = demandRows.every((r) => r.kw != null) ? demandRows.reduce((s, r) => s + r.kw, 0) : null;
  const variation = totalDemand != null && parts != null ? totalDemand - parts : null;
  const genGap = powerKW != null && totalDemand != null ? powerKW - totalDemand : null;
  const genOverridden = (provenance?.injectedSensors || []).includes('generator.gen_power');

  // Fuel autonomy at the rolling average burn (24 h of replay time: a full diurnal heating
  // cycle), so it does not jump with every reading.
  const avg = rollingMean(fuelPts, clock.avgMs);
  const avgBurn = avg.mean ?? fuelRateLph;
  const stockL = fuelItem && fuelItem.unit === 'L' ? num(fuelItem.current) : null;
  const autonomyDays = stockL != null && avgBurn ? stockL / (avgBurn * 24) : null;
  // Stock gauge: ledger stock vs the tank capacity in station_config.json. Never invented:
  // with no configured capacity the card says so instead of drawing a gauge.
  const tankL = num(stationMeta(activeStation).fuelTankCapacity_L);
  const stockPct = stockL != null && tankL ? (stockL / tankL) * 100 : null;

  const heatingDemand = num(energy?.heatingDemand_kW);
  const wasteShare = num(twinData?.wasteHeatRecovery);
  const spanMs = powerPts?.length > 1 ? powerPts.at(-1)[0] - powerPts[0][0] : null;
  const replayLabel = replayMs != null ? `replay ${formatShortDateTimeIST(replayMs)} IST` : null;
  const telemetryKind = telemetrySource === 'browser-demo' ? 'SIMULATED' : 'MODEL-DERIVED';
  const station = stationMeta(activeStation).name;
  const snapshotLabel = [isNum(timestamp) ? formatTimeIST(timestamp) : '—', replayLabel].filter(Boolean).join(' · ');
  const noBreakdown = !energy;

  return (
    <Box data-testid="energy-module">
      <PageHeader
        section={sectionLabel(meta.section)}
        title={meta.title}
        description={`${meta.description} ${station} station.`}
        updatedAt={updatedAt}
        updatedLabel="Snapshot"
        provenance={<>
          <ProvenanceChip kind={telemetryKind} subject="Generator"
            detail={telemetrySource === 'simulator' ? 'Source: live simulator.' : telemetrySource === 'physics-fallback' ? 'Source: backend physics fallback.' : undefined} />
          <ProvenanceChip kind="MODEL-DERIVED" subject="Load split" detail="Willans-line fuel model with estimated parameters." />
          <ProvenanceChip kind="OPERATOR-ENTERED" subject="Fuel stock" />
        </>}
      />

      {(twinError || fuelError) && (
        <Alert
          severity="warning"
          sx={{ mb: 5 }}
          action={<Button size="small" onClick={() => setAttempt((n) => n + 1)}>Retry now</Button>}
        >
          {twinError ? 'Model parameters (rated power, heating) are unavailable' : 'The fuel ledger is unavailable'} because the backend did not respond.
          Live generator telemetry is unaffected. Retrying automatically.
        </Alert>
      )}

      <Box
        component="section"
        aria-label="Key figures"
        data-testid="energy-kpis"
        sx={{
          display: 'grid',
          gap: 4,
          mb: 4,
          gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', lg: 'minmax(0, 1.6fr) repeat(2, minmax(0, 1fr))' },
          gridTemplateAreas: {
            xs: '"hero hero" "a b" "c d"',
            lg: '"hero a b" "hero c d"',
          },
        }}
      >
        <Typography variant="h2" sx={visuallyHidden}>Key figures</Typography>
        <KpiCard hero label="Generation" value={powerKW} unit="kW" decimals={1} testId="kpi-generation" sx={{ gridArea: 'hero' }}
          status={sensorStatus(activeAlerts, 'gen_power')}
          series={powerPts}
          delta={powerKW != null && valueAgo(powerPts, clock.deltaMs) != null ? powerKW - valueAgo(powerPts, clock.deltaMs) : null}
          deltaLabel={clock.deltaLabel} sparkBucketMs={clock.sparkBucketMs}
          context={twinLoading ? 'Loading rated power…' : `${formatNumber(loadPct)}% of ${formatValue(ratedKW, 'kW')} rated · last ${formatSpan(spanMs)} (${clock.suffix})`} />
        <KpiCard label="Fuel burn" value={fuelRateLph} unit="L/h" decimals={1} testId="kpi-fuel-burn" sx={{ gridArea: 'a' }}
          status={sensorStatus(activeAlerts, 'gen_fuel_rate')}
          series={fuelPts}
          sparkBucketMs={clock.sparkBucketMs}
          context={avg.mean != null ? `${formatSpan(Math.min(avg.spanMs || clock.avgMs, clock.avgMs))} average ${formatValue(avg.mean, 'L/h', 1)} (${clock.suffix})` : '—'} />
        <KpiCard label="Fuel autonomy" value={autonomyDays} unit="days" testId="kpi-autonomy" sx={{ gridArea: 'b' }}
          progress={stockPct ?? undefined}
          progressLabel={stockPct != null ? `Fuel stock ${formatNumber(stockPct)}% of ${formatValue(tankL, 'L')} tank capacity` : undefined}
          footnote={stockL == null ? null : stockPct != null
            ? `${formatNumber(stockPct)}% of ${formatValue(tankL, 'L')} tank`
            : 'Tank capacity not configured'}
          context={autonomyContext({ fuelError, stockL, avg, clock })} />
        <KpiCard label="Coolant temperature" value={coolantC} unit="°C" decimals={1} testId="kpi-coolant" sx={{ gridArea: 'c' }}
          status={sensorStatus(activeAlerts, 'gen_temp')}
          series={series['generator.gen_temp']} sparkBucketMs={clock.sparkBucketMs}
          context={thresholdText(catalog, 'gen_temp')} />
        <KpiCard label="Engine speed" value={rpm} unit="rpm" testId="kpi-rpm" sx={{ gridArea: 'd' }}
          status={sensorStatus(activeAlerts, 'gen_rpm')}
          series={series['generator.gen_rpm']} sparkBucketMs={clock.sparkBucketMs}
          context={thresholdText(catalog, 'gen_rpm')} />
      </Box>

      <Grid container spacing={4}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <SectionCard
            title="Generation and fuel burn"
            subtitle={clock.kind === 'replay'
              ? `Last ${WINDOW_MIN} min of telemetry = ${formatSpan(spanMs)} of ERA5 replay time (${replay?.speedFactor ?? '—'}× real time) · times in IST`
              : `Last ${formatSpan(spanMs)} of telemetry, wall clock, one sample per 2 s tick · times in IST`}
            provenance={<ProvenanceChip kind={telemetryKind} />}
            testId="energy-output-chart"
            contentSx={{ display: 'flex', flexDirection: 'column' }}
          >
            <OutputChart powerPoints={powerPts} fuelPoints={fuelPts} loaded={loaded} clock={clock} ratedKW={ratedKW} lowWarnKW={catalog.gen_power?.low?.warning} />
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <SectionCard title="Electrical demand" subtitle={`Snapshot ${snapshotLabel} · same tick as generation`} provenance={<ProvenanceChip kind="MODEL-DERIVED" />}
            testId="energy-demand">
            {noBreakdown ? (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                No demand split for this source: {telemetrySource === 'browser-demo' ? 'the browser demo' : 'random-walk simulation'} does not run the physics model.
              </Typography>
            ) : (
              <>
                {isNum(genGap) && Math.abs(genGap) >= 0.1 && (
                  <Alert severity="info" sx={{ mb: 4 }}>
                    Generation ({formatValue(powerKW, 'kW', 1)}) differs from modelled demand by {formatValue(Math.abs(genGap), 'kW', 1)}
                    {genOverridden ? ': an injected scenario is overriding generator telemetry.' : '.'}
                  </Alert>
                )}
                <DemandBreakdown rows={demandRows} variation={variation} total={totalDemand} matchesGeneration={!isNum(genGap) || Math.abs(genGap) < 0.1} />
              </>
            )}
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 7 }}>
          <SectionCard title="Heating and waste-heat recovery" subtitle={`Snapshot ${snapshotLabel} · thermal load the generator supports`} provenance={<ProvenanceChip kind="MODEL-DERIVED" />}>
            {noBreakdown ? (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>Not available without the physics model.</Typography>
            ) : (
              <Table size="small" aria-label="Heating figures">
                <TableBody>
                  <FactRow label="Building heat loss" value={formatValue(num(energy.heatLoss_kW), 'kW', 1)} />
                  <FactRow label="Heating demand" value={formatValue(heatingDemand, 'kW', 1)} />
                  <FactRow label="Met by waste heat" note={wasteShare != null ? `${formatNumber(wasteShare * 100)}% assumed` : 'assumed'}
                    value={heatingDemand != null && wasteShare != null ? formatValue(heatingDemand * wasteShare, 'kW', 1) : '—'} />
                  <FactRow label="Met by electric heaters" note="in the demand split" value={formatValue(num(energy.heatingElectrical_kW), 'kW', 1)} />
                  <FactRow label="Distribution efficiency" note="estimated" value={twinData?.heatingEfficiency != null ? formatValue(twinData.heatingEfficiency * 100, '%') : '—'} />
                  <FactRow label="Glycol loop flow" value="Not modelled" />
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <SectionCard title="Model coverage" subtitle="What these figures do and do not include">
            <Stack component="ul" sx={{ gap: 2, m: 0, pl: 4, color: 'text.secondary', typography: 'body2' }}>
              <li>One generator is modelled. The second gen-set is not.</li>
              <li>Oil pressure, vibration and bus frequency are not modelled.</li>
              <li>Fuel burn follows a Willans-line model with estimated parameters.</li>
              <li>Fuel stock is the operator-entered ledger, not a tank sensor. Autonomy uses the {formatSpan(clock.avgMs)} average burn ({clock.suffix}).</li>
              {replayMs != null ? (
                <li>
                  Replay time of this snapshot: <Box component="span" sx={{ typography: 'mono', color: 'text.primary' }}>{formatDateTimeIST(replayMs)}</Box>{' '}
                  (ERA5 replayed at {replay?.speedFactor ?? '—'}× real time; 1 tick = {formatSpan(2000 * (replay?.speedFactor ?? 0))}).
                  {replay?.utcOffsetSource === 'inferred-from-solar-radiation' && ' The weather cache had no UTC offset; it was inferred from the solar-radiation peak.'}
                </li>
              ) : (
                <li>No replay clock for this source: averages and deltas use the wall clock.</li>
              )}
            </Stack>
          </SectionCard>
        </Grid>
      </Grid>
    </Box>
  );
}
