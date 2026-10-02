/* ═══════════════════════════════════════════════════════════════
   Aurora — station switcher: both stations always visible as a segmented
   control, so the active one is obvious and switching is one click.
   Names and coordinates come from station_config.json (via stationConfig.js).
   ═══════════════════════════════════════════════════════════════ */
import { ToggleButton, ToggleButtonGroup } from '@mui/material';
import Hint from '../ui/Hint';
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
      sx={{ flex: 'none' }}
    >
      {STATION_IDS.map((sid) => {
        const m = stationMeta(sid);
        return (
          <Hint key={sid} title={`${m.fullName} · ${m.region} · ${formatCoords(sid)}`}>
            <ToggleButton
              value={sid}
              className={`station-option${value === sid ? ' active' : ''}`}
              data-testid={`station-option-${sid}`}
              sx={{ px: { xs: 1.75, sm: 3 }, minWidth: { xs: 0, sm: 76 }, height: 32 }}
            >
              {m.name}
            </ToggleButton>
          </Hint>
        );
      })}
    </ToggleButtonGroup>
  );
}
