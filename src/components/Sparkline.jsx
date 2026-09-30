/* ═══════════════════════════════════════════════════════════════
   Aurora — Sparkline Chart
   Tiny animated SVG chart showing sensor value history.
   Used inside BuildingPanel for each sensor.
   ═══════════════════════════════════════════════════════════════ */
import { useMemo } from 'react';

const SPARKLINE_W = 120;
const SPARKLINE_H = 32;

export default function Sparkline({
  data = [],
  color = 'var(--accent-primary)',
  alertLevel = 'normal',
  width = SPARKLINE_W,
  height = SPARKLINE_H,
}) {
  const sparkColor = alertLevel === 'critical'
    ? 'var(--status-critical)'
    : alertLevel === 'warning'
    ? 'var(--status-warning)'
    : color;

  const { path, areaPath, min, max, current } = useMemo(() => {
    if (!data || data.length < 2) {
      return { path: '', areaPath: '', min: 0, max: 0, current: 0 };
    }

    const values = data.map(d => (typeof d === 'object' ? d.value : d));
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const range = maxVal - minVal || 1;
    const pad = 2;

    const points = values.map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (width - pad * 2);
      const y = pad + (1 - (v - minVal) / range) * (height - pad * 2);
      return { x, y };
    });

    const linePoints = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const areaPoints = linePoints + ` L${points[points.length - 1].x.toFixed(1)},${height} L${points[0].x.toFixed(1)},${height} Z`;

    return {
      path: linePoints,
      areaPath: areaPoints,
      min: minVal,
      max: maxVal,
      current: values[values.length - 1],
    };
  }, [data, width, height]);

  if (!data || data.length < 2) {
    return (
      <svg width={width} height={height} className="sparkline empty">
        <line x1="0" y1={height / 2} x2={width} y2={height / 2}
          stroke="var(--text-muted)" strokeWidth="0.5" strokeDasharray="2,3" opacity="0.3" />
      </svg>
    );
  }

  return (
    <svg width={width} height={height} className="sparkline" style={{ overflow: 'visible' }}>
      {/* Gradient area fill */}
      <defs>
        <linearGradient id={`spark-grad-${color.replace(/[^a-z]/g, '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={sparkColor} stopOpacity="0.15" />
          <stop offset="100%" stopColor={sparkColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d={areaPath}
        fill={`url(#spark-grad-${color.replace(/[^a-z]/g, '')})`}
      />
      {/* Line */}
      <path
        d={path}
        fill="none"
        stroke={sparkColor}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Current value dot */}
      <circle
        cx={2 + ((data.length - 1) / (data.length - 1)) * (width - 4)}
        cy={2 + (1 - (current - min) / (max - min || 1)) * (height - 4)}
        r="2.5"
        fill={sparkColor}
      />
    </svg>
  );
}
