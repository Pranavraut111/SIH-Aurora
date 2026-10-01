/* ═══════════════════════════════════════════════════════════════
   Aurora — 2D station overview (no-WebGL fallback)
   Rendered instead of the three.js scene when WebGL is unavailable
   or the 3D renderer throws. Same buildings, same status colours,
   same click behaviour (opens the building panel).
   ═══════════════════════════════════════════════════════════════ */
import { BUILDINGS } from '../data/stationData';
import './StationFallback2D.css';

const STATUS_LABEL = { normal: 'Normal', warning: 'Warning', critical: 'Critical' };

export default function StationFallback2D({
  alertStates = {},
  selectedBuilding,
  onBuildingClick,
  onBuildingHover,
  reason,
}) {
  return (
    <div className="station-2d" data-testid="station-2d-fallback">
      <div className="station-2d-note" role="status">
        2D overview — {reason || '3D view unavailable'}. All data and panels work normally.
      </div>
      <div className="station-2d-grid">
        {Object.entries(BUILDINGS).map(([id, b]) => {
          const level = alertStates[id] || 'normal';
          return (
            <button
              key={id}
              type="button"
              className={`station-2d-card status-${level} ${selectedBuilding === id ? 'selected' : ''}`}
              onClick={() => onBuildingClick?.(id)}
              onMouseEnter={() => onBuildingHover?.(id)}
              onMouseLeave={() => onBuildingHover?.(null)}
              aria-pressed={selectedBuilding === id}
              data-building={id}
            >
              <span className="station-2d-dot" aria-hidden="true" />
              <span className="station-2d-name">{b.name}</span>
              <span className="station-2d-desc">{b.description}</span>
              <span className="station-2d-status">{STATUS_LABEL[level] || level}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
