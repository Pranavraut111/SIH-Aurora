/* ═══════════════════════════════════════════════════════════════
   Aurora — station switcher: both stations always visible as a segmented
   control, so the active one is obvious and switching is one click.
   Names and coordinates come from station_config.json (via stationConfig.js).
   ═══════════════════════════════════════════════════════════════ */
import { ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material';
import { STATION_IDS, formatCoords, stationMeta } from '../data/stationConfig';

export default function StationSwitcher({ value, onChange }) {
  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={value}
      onChange={(_, next) => { if (next && next !== value) onChange(next); }}
      aria-label="Station"
      data-testid="station-switcher"
      data-tour="station-switcher"
    >
      {STATION_IDS.map((sid) => {
        const m = stationMeta(sid);
        return (
          <Tooltip key={sid} title={`${m.fullName} · ${m.region} · ${formatCoords(sid)}`}>
            <ToggleButton
              value={sid}
              className={`station-option${value === sid ? ' active' : ''}`}
              data-testid={`station-option-${sid}`}
              sx={{ px: 3, minWidth: 76 }}
            >
              {m.name}
            </ToggleButton>
          </Tooltip>
        );
      })}
    </ToggleButtonGroup>
  );
}
