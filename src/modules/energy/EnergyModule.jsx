/* ═══════════════════════════════════════════════════════════════
   Aurora — Energy grid module (design-system prototype, docs/ui-redesign.md).

   Same data as the legacy EnergyPanel, nothing invented:
   - generator power / fuel rate / rpm / coolant: live telemetry (WebSocket);
   - rated power, load factor, demand split, heat figures: GET /twin-inspector
     (physics model for the active station);
   - fuel stock: GET /logistics (operator-entered ledger).
   Missing values render as "—", never as a default.
   ═══════════════════════════════════════════════════════════════ */
import { useState } from 'react';
import {
  Alert, Box, Button, Grid, Skeleton, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import { apiGet } from '../../services/api';
import { usePolling } from '../../hooks/usePolling';
import { sensorCatalog, stationMeta } from '../../data/stationConfig';
import { formatNumber, formatTimeIST, formatValue, isNum } from '../../lib/format';
import { useChartTheme } from '../../theme/chartTheme';
import KpiCard from '../../ui/KpiCard';
import PageHeader from '../../ui/PageHeader';
import ProvenanceChip from '../../ui/Provenance';
import SectionCard from '../../ui/SectionCard';
import { MODULES, sectionLabel } from '../../shell/navigation';

const num = (v) => (isNum(v) ? v : null);
// Present for screen readers (keeps the heading outline intact), invisible on screen.
const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0, p: 0, m: -1 / 4 };

/** Highest active alert level for one sensor, from the backend alert engine. */
function sensorStatus(activeAlerts, sensor) {
  const levels = activeAlerts.filter((a) => a.sensor === sensor).map((a) => a.level);
  return levels.includes('critical') ? 'critical' : levels.includes('warning') ? 'warning' : undefined;
}

function thresholdText(catalog, sensor) {
  const c = catalog[sensor];
  if (!c) return null;
  const lo = c.low?.warning;
  const hi = c.high?.warning;
  if (lo != null && hi != null) return `Default normal band ${formatNumber(lo)}–${formatValue(hi, c.unit)}`;
  if (hi != null) return `Default warning above ${formatValue(hi, c.unit)}`;
  if (lo != null) return `Default warning below ${formatValue(lo, c.unit)}`;
  return null;
}

function OutputChart({ history, catalog }) {
  const chart = useChartTheme();
  const data = (history || []).map((p) => ({ time: p.time, kw: num(p.value) }));
  const lowWarn = catalog.gen_power?.low?.warning;
  if (data.length < 2) {
    return (
      <Box sx={{ height: 280, display: 'grid', placeItems: 'center' }}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>Collecting samples. The chart fills in as telemetry arrives.</Typography>
      </Box>
    );
  }
  return (
    <Box sx={{ height: 280 }} role="img" aria-label={`Generator output over the last ${data.length} samples, latest ${formatValue(data.at(-1).kw, 'kW')}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={chart.grid} vertical={false} />
          <XAxis dataKey="time" type="number" domain={['dataMin', 'dataMax']} scale="time"
            tickFormatter={(t) => formatTimeIST(t).slice(0, 8)} tick={chart.tick} stroke={chart.axis} tickLine={false} minTickGap={56} />
          <YAxis tick={chart.tick} stroke={chart.axis} tickLine={false} axisLine={false} width={40}
            domain={[0, (max) => Math.ceil((max * 1.15) / 10) * 10]} tickFormatter={(v) => formatNumber(v)} />
          {lowWarn != null && (
            <ReferenceLine y={lowWarn} stroke={chart.referenceLine.warning} strokeDasharray="4 4"
              label={{ value: `Low-power warning ${lowWarn} kW`, position: 'insideBottomRight', fill: chart.tick.fill, fontSize: 12 }} />
          )}
          <ChartTooltip {...chart.tooltip} labelFormatter={(t) => formatTimeIST(t)} formatter={(v) => [formatValue(v, 'kW', 1), 'Output']} />
          <Line type="monotone" dataKey="kw" stroke={chart.series[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </Box>
  );
}

function DemandBreakdown({ rows, total }) {
  const chart = useChartTheme();
  return (
    <Stack sx={{ gap: 4 }}>
      <Box
        role="img"
        aria-label={`Electrical demand split, total ${formatValue(total, 'kW', 1)}`}
        sx={{ display: 'flex', height: 12, borderRadius: '3px', overflow: 'hidden', gap: '2px' }}
      >
        {rows.map((r, i) => (
          <Box key={r.label} sx={{ flex: `${Math.max(r.kw ?? 0, 0)} 0 0`, backgroundColor: chart.series[i % chart.series.length] }} />
        ))}
      </Box>
      <Table size="small" aria-label="Electrical demand by consumer">
        <TableHead>
          <TableRow>
            <TableCell>Consumer</TableCell>
            <TableCell align="right">kW</TableCell>
            <TableCell align="right">Share</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={r.label}>
              <TableCell>
                <Stack direction="row" sx={{ alignItems: 'center', gap: 2 }}>
                  <Box aria-hidden="true" sx={{ width: 8, height: 8, borderRadius: '2px', flex: 'none', backgroundColor: chart.series[i % chart.series.length] }} />
                  {r.label}
                </Stack>
              </TableCell>
              <TableCell align="right" sx={{ typography: 'mono' }}>{formatNumber(r.kw, 1)}</TableCell>
              <TableCell align="right" sx={{ typography: 'mono', color: 'text.secondary' }}>
                {r.kw != null && total ? `${formatNumber((r.kw / total) * 100)}%` : '—'}
              </TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell sx={{ fontWeight: 600, borderBottom: 0 }}>Total demand</TableCell>
            <TableCell align="right" sx={{ typography: 'mono', fontWeight: 600, borderBottom: 0 }}>{formatNumber(total, 1)}</TableCell>
            <TableCell sx={{ borderBottom: 0 }} />
          </TableRow>
        </TableBody>
      </Table>
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
      <TableCell align="right" sx={{ typography: 'mono', pr: 0, color: value === 'Not modelled' ? 'text.secondary' : 'text.primary' }}>{value}</TableCell>
    </TableRow>
  );
}

export default function EnergyModule({ sensorData = {}, history = {}, activeAlerts = [], activeStation = 'maitri', telemetrySource, updatedAt }) {
  const meta = MODULES.energy;
  const catalog = sensorCatalog(activeStation);
  const gen = sensorData.generator || {};
  const powerKW = num(gen.gen_power);
  const fuelRateLph = num(gen.gen_fuel_rate);
  const rpm = num(gen.gen_rpm);
  const coolantC = num(gen.gen_temp);

  const [twin, setTwin] = useState({ station: null, data: null, error: null });
  const [fuel, setFuel] = useState({ station: null, item: null, error: null });
  const [attempt, setAttempt] = useState(0);
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
  }, 5000, { key: `${activeStation}:${attempt}` });

  const twinData = twin.station === activeStation ? twin.data : null;
  const twinError = twin.station === activeStation ? twin.error : null;
  const twinLoading = !twinData && !twinError;
  const fuelItem = fuel.station === activeStation ? fuel.item : null;
  const fuelError = fuel.station === activeStation ? fuel.error : null;

  const gm = twinData?.generatorModel || {};
  const ratedKW = num(gm.maxPower_kW);
  const loadPct = num(gm.loadFactor_pct) ?? (powerKW != null && ratedKW ? (powerKW / ratedKW) * 100 : null);
  const pb = twinData?.powerBreakdown || {};
  const totalDemand = num(pb.total_demand_kW);
  const demandRows = [
    { label: 'Buildings (base load)', kw: num(pb.base_electrical_kW) },
    { label: 'Electrical heating', kw: num(pb.heating_electrical_kW) },
    { label: 'Ventilation', kw: num(pb.ventilation_kW) },
    { label: 'Water treatment', kw: num(pb.water_treatment_kW) },
    { label: 'Communications', kw: num(pb.comms_kW) },
  ];

  const burnPerDay = fuelRateLph != null ? fuelRateLph * 24 : null;
  const stockL = fuelItem && fuelItem.unit === 'L' ? num(fuelItem.current) : null;
  const autonomyDays = stockL != null && burnPerDay ? stockL / burnPerDay : null;
  const simulatedTime = twinData?.dataSource?.simulatedTime;
  const telemetryKind = telemetrySource === 'browser-demo' ? 'SIMULATED' : 'MODEL-DERIVED';
  const station = stationMeta(activeStation).name;

  return (
    <Box data-testid="energy-module">
      <PageHeader
        section={sectionLabel(meta.section)}
        title={meta.title}
        description={`${meta.description} ${station} station.`}
        updatedAt={updatedAt}
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
          {twinError ? 'Physics-model figures are unavailable' : 'The fuel ledger is unavailable'} because the backend did not respond.
          Live generator telemetry is unaffected. Retrying automatically.
        </Alert>
      )}

      <Box
        component="section"
        aria-label="Key figures"
        sx={{ display: 'grid', gap: 4, mb: 4, gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))', lg: 'repeat(5, minmax(0, 1fr))' } }}
      >
        <Typography variant="h2" sx={visuallyHidden}>Key figures</Typography>
        <KpiCard label="Generation" value={powerKW} unit="kW" testId="kpi-generation"
          status={sensorStatus(activeAlerts, 'gen_power')}
          progress={loadPct}
          loading={false}
          context={twinLoading ? 'Loading rated power…' : `${formatNumber(loadPct)}% of ${formatValue(ratedKW, 'kW')} rated`} />
        <KpiCard label="Fuel burn" value={fuelRateLph} unit="L/h" decimals={1} testId="kpi-fuel-burn"
          status={sensorStatus(activeAlerts, 'gen_fuel_rate')}
          context={`≈ ${formatValue(burnPerDay, 'L')} per day`} />
        <KpiCard label="Fuel autonomy" value={autonomyDays} unit="days" testId="kpi-autonomy"
          context={fuelError ? 'Fuel ledger unavailable' : `${formatValue(stockL, 'L')} in stock (ledger)`} />
        <KpiCard label="Coolant temperature" value={coolantC} unit="°C" decimals={1} testId="kpi-coolant"
          status={sensorStatus(activeAlerts, 'gen_temp')}
          context={thresholdText(catalog, 'gen_temp')} />
        <KpiCard label="Engine speed" value={rpm} unit="rpm" testId="kpi-rpm"
          status={sensorStatus(activeAlerts, 'gen_rpm')}
          context={thresholdText(catalog, 'gen_rpm')} />
      </Box>

      <Grid container spacing={4}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <SectionCard
            title="Generator output"
            subtitle={`kW · last ${history.generator?.gen_power?.length ?? 0} samples, one every 2 s · times in IST`}
            provenance={<ProvenanceChip kind={telemetryKind} />}
            testId="energy-output-chart"
          >
            <OutputChart history={history.generator?.gen_power} catalog={catalog} />
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <SectionCard title="Electrical demand" subtitle="Where the generated power goes" provenance={<ProvenanceChip kind="MODEL-DERIVED" />}>
            {twinError ? (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>Unavailable while the backend is unreachable.</Typography>
            ) : twinLoading ? (
              <Stack sx={{ gap: 2 }}>{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} variant="text" />)}</Stack>
            ) : (
              <DemandBreakdown rows={demandRows} total={totalDemand} />
            )}
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 7 }}>
          <SectionCard title="Heating and waste-heat recovery" subtitle="Thermal load the generator supports" provenance={<ProvenanceChip kind="MODEL-DERIVED" />}>
            {twinLoading ? (
              <Stack sx={{ gap: 2 }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} variant="text" />)}</Stack>
            ) : (
              <Table size="small" aria-label="Heating figures">
                <TableBody>
                  <FactRow label="Building heat loss" value={formatValue(num(twinData?.totalHeatLoss_kW), 'kW', 1)} />
                  <FactRow label="Heating demand" value={formatValue(num(twinData?.heatingDemand_kW), 'kW', 1)} />
                  <FactRow label="Waste-heat recovery share" note="assumed" value={twinData?.wasteHeatRecovery != null ? formatValue(twinData.wasteHeatRecovery * 100, '%') : '—'} />
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
              <li>Fuel stock is the operator-entered ledger, not a tank sensor.</li>
              {simulatedTime && <li>Replay time in the physics model: <Box component="span" sx={{ typography: 'mono', color: 'text.primary' }}>{simulatedTime.replace('T', ' ')}</Box> (ERA5 replay clock).</li>}
            </Stack>
          </SectionCard>
        </Grid>
      </Grid>
    </Box>
  );
}
