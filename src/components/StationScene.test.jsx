/* WebGL detection: StationScene probes for a WebGL context and renders the 2D
   overview instead of the three.js scene when there isn't one. jsdom has no WebGL,
   so the negative case is the default and the positive case is stubbed. */
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StationScene from './StationScene';

/** Make canvas.getContext answer for the given context ids and null for the rest. */
function stubCanvasContexts(supported) {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((id) => {
    if (!supported.includes(id)) return null;
    return { getExtension: () => ({ loseContext: () => {} }) };
  });
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('without WebGL', () => {
  it('renders the 2D fallback rather than the 3D scene', () => {
    stubCanvasContexts([]);
    render(<StationScene alertStates={{}} />);
    expect(screen.getByTestId('station-2d-fallback')).toBeInTheDocument();
  });

  it('tells the operator why, and that nothing else is degraded', () => {
    stubCanvasContexts([]);
    render(<StationScene alertStates={{}} />);
    const note = screen.getByRole('status');
    expect(note).toHaveTextContent('WebGL is not available in this browser');
    expect(note).toHaveTextContent('All data and panels work normally');
  });

  it('keeps the buildings, their status colours and the click behaviour', () => {
    stubCanvasContexts([]);
    const onBuildingClick = vi.fn();
    render(<StationScene alertStates={{ generator: 'critical' }} onBuildingClick={onBuildingClick} />);

    const generator = document.querySelector('[data-building="generator"]');
    expect(generator).toBeTruthy();
    expect(generator.className).toContain('status-critical');
    fireEvent.click(generator);
    expect(onBuildingClick).toHaveBeenCalledWith('generator');
  });

  it('falls back when the probe itself throws, and logs it', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new Error('context creation blocked');
    });
    render(<StationScene alertStates={{}} />);
    expect(screen.getByTestId('station-2d-fallback')).toBeInTheDocument();
    expect(console.warn).toHaveBeenCalledWith('[StationScene] WebGL probe failed', expect.any(Error));
  });

  it('accepts a WebGL1-only browser (experimental-webgl) and still reports the real reason', () => {
    stubCanvasContexts(['experimental-webgl']);
    render(<StationScene alertStates={{}} />);
    // The probe passes, so the 3D path is attempted; in jsdom the renderer then fails,
    // which must also land on the 2D overview — with the renderer's reason, not the probe's.
    expect(screen.getByTestId('station-2d-fallback')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('3D renderer failed');
  });
});

describe('with WebGL but a renderer that fails', () => {
  it('still lands on the 2D overview and says the renderer failed, not that WebGL is missing', () => {
    stubCanvasContexts(['webgl2', 'webgl']);
    render(<StationScene alertStates={{}} />);
    const note = screen.getByRole('status');
    expect(note).toHaveTextContent('3D renderer failed');
    expect(note).not.toHaveTextContent('WebGL is not available');
  });
});
