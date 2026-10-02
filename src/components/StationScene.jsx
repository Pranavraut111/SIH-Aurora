/* ═══════════════════════════════════════════════════════════════
   Aurora — 3D overview entry (lazy-loaded chunk; Phase 2, docs/phase2-3d-plan.md).
   Probes for WebGL. With it: the realistic, data-driven station scene
   (src/scene/). Without it, or when the renderer fails: the 2D overview with
   the same buildings, status and click behaviour.
   ═══════════════════════════════════════════════════════════════ */
import { useCallback, useState } from 'react';
import StationFallback2D from './StationFallback2D';
import StationScene3D from '../scene/StationScene3D';

/** True when the browser can create a WebGL context (probe on a throwaway canvas). */
function hasWebGL() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch (err) {
    console.warn('[StationScene] WebGL probe failed', err);
    return false;
  }
}

/**
 * Overview scene: three.js 3D twin when WebGL works, otherwise (no WebGL, or
 * the renderer throws) a 2D overview with the same buildings and click behaviour.
 */
export default function StationScene(props) {
  const [mode, setMode] = useState(() => (hasWebGL() ? '3d' : '2d'));
  const [reason, setReason] = useState(() => (mode === '3d' ? null : 'WebGL is not available in this browser'));
  const handleFatal = useCallback((err) => {
    setReason(`3D renderer failed: ${err?.message || err}`);
    setMode('2d');
  }, []);
  if (mode === '2d') return <StationFallback2D {...props} reason={reason} />;
  return <StationScene3D {...props} onFatal={handleFatal} />;
}
