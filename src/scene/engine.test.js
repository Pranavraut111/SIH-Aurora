import { describe, expect, it } from 'vitest';
import { isSoftwareRenderer } from './engine';

const glWith = (name) => ({
  getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 1 }),
  getParameter: (p) => (p === 1 ? name : 'WebKit WebGL'),
});

describe('software WebGL detection', () => {
  it('recognises CPU rasterisers', () => {
    ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', 'llvmpipe (LLVM 15.0.7, 256 bits)', 'ANGLE (Microsoft Basic Render Driver Direct3D11)']
      .forEach((n) => expect(isSoftwareRenderer(glWith(n))).toBe(true));
  });

  it('leaves real GPUs alone, and copes with a missing extension', () => {
    expect(isSoftwareRenderer(glWith('ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)'))).toBe(false);
    expect(isSoftwareRenderer(glWith('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0)'))).toBe(false);
    expect(isSoftwareRenderer({ getExtension: () => null, getParameter: () => 'WebKit WebGL' })).toBe(false);
  });
});
