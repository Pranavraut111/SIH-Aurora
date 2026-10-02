/* ═══════════════════════════════════════════════════════════════
   Aurora — station mini-card at the foot of the sidebar (polar identity,
   docs/ui-redesign.md §10): a south-polar map locator, the station's local
   mean solar time next to IST, and the polar day/night state computed from
   the sun's position. Every fact comes from station_config.json or is
   computed from it; nothing is typed in by hand.

   Times are wall-clock "now". The replayed ERA5 day the twin shows can differ
   (the replay clock is not exposed to the shell yet), so the day/night line
   describes the station today, not the replayed weather.
   ═══════════════════════════════════════════════════════════════ */
import { useMemo } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { useNow } from '../hooks/useNow';
import { formatTimeIST } from '../lib/format';
import { dayState, solarTimeOffsetMs } from '../lib/solar';
import { STATION_IDS, stationMeta } from '../data/stationConfig';
import Hint from '../ui/Hint';
import { ANTARCTICA_PATH, parallelRadius, project } from './antarctica';

const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: false });
const istHHMM = (d) => formatTimeIST(d).replace(/:\d\d IST$/, ' IST');

function coordText(lat, lon) {
  return [`${Math.abs(lat).toFixed(2)}° ${lat < 0 ? 'S' : 'N'}`, `${Math.abs(lon).toFixed(2)}° ${lon < 0 ? 'W' : 'E'}`];
}

function dayLine(sun) {
  const below = `${Math.abs(sun.max).toFixed(1)}° below the horizon at noon`;
  switch (sun.state) {
    case 'polar-night': return { label: 'Polar night', detail: `sun ${below}` };
    case 'polar-day': return { label: 'Polar day', detail: 'midnight sun' };
    case 'day': return { label: 'Day', detail: sun.next ? `sunset ${istHHMM(sun.next)}` : '' };
    default: return { label: 'Night', detail: sun.next ? `sunrise ${istHHMM(sun.next)}` : '' };
  }
}

function Locator({ activeStation, onStationChange }) {
  const active = stationMeta(activeStation);
  return (
    <Box
      component="svg"
      viewBox="-60 -60 120 120"
      role="group"
      aria-label={`Locator map: ${active.name} at ${coordText(active.latitude, active.longitude).join(', ')}`}
      sx={(theme) => ({
        width: 88, height: 88, flex: 'none', display: 'block',
        '& .ring': { fill: 'none', stroke: theme.vars.palette.divider, strokeWidth: 0.75 },
        '& .land': { fill: theme.vars.palette.aurora.surfaceRaised, stroke: theme.vars.palette.aurora.borderControl, strokeWidth: 0.75, strokeLinejoin: 'round' },
        '& .other': { fill: theme.vars.palette.background.paper, stroke: theme.vars.palette.text.secondary, strokeWidth: 1.25, cursor: 'pointer' },
        '& .hit:focus-visible + .other, & .hit:hover + .other': { stroke: theme.vars.palette.primary.main },
        '& .hit': { fill: 'transparent', cursor: 'pointer', outline: 'none' },
        '& .active': { fill: theme.vars.palette.primary.main, stroke: theme.vars.palette.background.paper, strokeWidth: 1.25 },
      })}
    >
      {[-60, -70, -80].map((lat) => <circle key={lat} className="ring" r={parallelRadius(lat)} />)}
      <path className="land" d={ANTARCTICA_PATH} />
      {STATION_IDS.map((sid) => {
        const m = stationMeta(sid);
        const [x, y] = project(m.latitude, m.longitude);
        if (sid === activeStation) return <circle key={sid} className="active" cx={x} cy={y} r={4.5} />;
        return (
          <g key={sid}>
            <circle className="hit" cx={x} cy={y} r={10} role="button" tabIndex={0}
              aria-label={`Switch to ${m.name}`}
              onClick={() => onStationChange(sid)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onStationChange(sid); } }} />
            <circle className="other" cx={x} cy={y} r={3.5} pointerEvents="none" />
          </g>
        );
      })}
    </Box>
  );
}

function SunPath({ sun, now }) {
  // 24 h of solar elevation centred on now, against the horizon line.
  const { curve } = sun;
  const t0 = curve[0][0];
  const t1 = curve[curve.length - 1][0];
  const lo = Math.min(-10, ...curve.map((p) => p[1]));
  const hi = Math.max(10, ...curve.map((p) => p[1]));
  const W = 100;
  const H = 20;
  const x = (t) => ((t - t0) / (t1 - t0)) * W;
  const y = (e) => 1 + (1 - (e - lo) / (hi - lo)) * (H - 2);
  const d = curve.map(([t, e], i) => `${i ? 'L' : 'M'}${x(t).toFixed(2)} ${y(e).toFixed(2)}`).join('');
  return (
    <Box component="svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true"
      sx={(theme) => ({ width: '100%', height: H, display: 'block', overflow: 'visible', color: theme.vars.palette.primary.main })}>
      <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="currentColor" strokeOpacity={0.35} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
      <circle cx={x(now)} cy={y(sun.elevation)} r={2.2} fill="currentColor" vectorEffect="non-scaling-stroke" />
    </Box>
  );
}

export default function StationMiniCard({ activeStation, onStationChange }) {
  const now = useNow(15_000);
  const meta = stationMeta(activeStation);
  const minute = Math.floor(now / 60_000);
  const sun = useMemo(() => dayState(minute * 60_000, meta.latitude, meta.longitude), [minute, meta.latitude, meta.longitude]);
  const solar = hhmm.format(new Date(now + solarTimeOffsetMs(meta.longitude)));
  const [lat, lon] = coordText(meta.latitude, meta.longitude);
  const day = dayLine(sun);

  return (
    <Box
      component="section"
      aria-label={`${meta.name} station`}
      data-testid="station-mini-card"
      sx={(theme) => ({
        mx: 3, mb: 3, p: 3,
        borderRadius: '12px',
        backgroundColor: theme.vars.palette.background.default,
      })}
    >
      <Stack direction="row" sx={{ gap: 3, alignItems: 'center' }}>
        <Locator activeStation={activeStation} onStationChange={onStationChange} />
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 15, fontWeight: 600, lineHeight: '20px' }}>{meta.name}</Typography>
          <Typography component="p" sx={{ typography: 'mono', fontSize: 12, lineHeight: '16px', color: 'text.secondary', mt: 0.5 }}>
            {lat}<br />{lon}
          </Typography>
          <Typography sx={{ fontSize: 12, lineHeight: '16px', color: 'text.secondary', mt: 1 }}>{meta.elevation_m} m · {meta.personnelWinter} winter crew</Typography>
        </Box>
      </Stack>

      <Stack direction="row" sx={{ mt: 3, gap: 3, fontSize: 12, lineHeight: '16px', color: 'text.secondary' }}>
        <Hint title="Local mean solar time, from the station's longitude. station_config.json records no official station time zone.">
          <span tabIndex={0}>Solar <Box component="span" sx={{ typography: 'mono', fontSize: 12, color: 'text.primary' }}>{solar}</Box></span>
        </Hint>
        <span>IST <Box component="span" sx={{ typography: 'mono', fontSize: 12, color: 'text.primary' }}>{istHHMM(now).replace(' IST', '')}</Box></span>
      </Stack>

      <Hint title="Computed from the sun's position for the station's coordinates, today (wall clock). Model-derived; geometric horizon, no refraction." sx={{ display: 'block', mt: 2 }}>
        <Box tabIndex={0} data-testid="polar-day-line" sx={{ fontSize: 12, lineHeight: '16px', color: 'text.secondary' }}>
          <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>{day.label}</Box>
          {day.detail && ` · ${day.detail}`}
        </Box>
      </Hint>
      <Box sx={{ mt: 1.5 }}><SunPath sun={sun} now={minute * 60_000} /></Box>
    </Box>
  );
}
