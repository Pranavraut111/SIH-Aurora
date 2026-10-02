/* ═══════════════════════════════════════════════════════════════
   Aurora 3D — deterministic value noise for the procedural terrain.
   Seeded, so a station's terrain is identical on every load and in every
   screenshot. Plain JS (no WebGL), unit-tested.
   ═══════════════════════════════════════════════════════════════ */

/** Park–Miller PRNG; returns a function giving floats in [0, 1). */
export function rng(seed = 1) {
  let s = Math.max(1, Math.floor(seed) % 2147483647);
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

/** A 2D noise field: value noise, fbm and ridged fbm, all from one seed. */
export function makeNoise(seed = 1) {
  const r = rng(seed);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i -= 1) {
    const j = Math.floor(r() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i += 1) perm[i] = p[i & 255];
  const hash = (x, y) => perm[perm[x & 255] + (y & 255)] / 255;
  const fade = (t) => t * t * (3 - 2 * t);

  function value(x, y) {
    const xi = Math.floor(x); const yi = Math.floor(y);
    const xf = x - xi; const yf = y - yi;
    const a = hash(xi, yi); const b = hash(xi + 1, yi); const c = hash(xi, yi + 1); const d = hash(xi + 1, yi + 1);
    const u = fade(xf); const v = fade(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, octaves = 5) {
    let sum = 0; let amp = 0.5; let f = 1;
    for (let i = 0; i < octaves; i += 1) { sum += amp * value(x * f, y * f); f *= 2.03; amp *= 0.5; }
    return sum;
  }
  function ridged(x, y, octaves = 5) {
    let sum = 0; let amp = 0.5; let f = 1;
    for (let i = 0; i < octaves; i += 1) { sum += amp * (1 - Math.abs(value(x * f, y * f) * 2 - 1)); f *= 2.1; amp *= 0.5; }
    return sum;
  }
  return { value, fbm, ridged, random: r };
}

export const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Weight of a levelled pad at (x, z): 1 inside a rotated rectangle (half-sizes hx, hz),
 * easing to 0 over `feather` metres outside it.
 */
export function padWeight(x, z, pad) {
  const c = Math.cos(-(pad.rot || 0)); const s = Math.sin(-(pad.rot || 0));
  const dx = x - pad.x; const dz = z - pad.z;
  const lx = dx * c - dz * s; const lz = dx * s + dz * c;
  const d = Math.max(Math.abs(lx) - pad.hx, Math.abs(lz) - pad.hz, 0);
  return 1 - smoothstep(0, pad.feather ?? 20, d);
}
