/* ═══════════════════════════════════════════════════════════════
   Aurora — Suspense placeholder for lazily loaded panels.
   Module panels, the 3D twin and the charts are code-split, so this is
   what shows while a chunk is fetched (a few ms once cached).
   ═══════════════════════════════════════════════════════════════ */
import './PanelFallback.css';

export default function PanelFallback({ name = 'Panel' }) {
  return (
    <div className="panel-fallback" role="status" aria-live="polite" data-testid="panel-fallback">
      <span className="panel-fallback-spinner" aria-hidden="true" />
      <span className="panel-fallback-text">Loading {name.toLowerCase()}…</span>
    </div>
  );
}
