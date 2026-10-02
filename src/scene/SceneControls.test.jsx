/* The 3D scene's DOM controls: everything the canvas does is reachable without it. */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AppThemeProvider from '../theme/AppThemeProvider';
import SceneControls from './SceneControls';

const zones = [
  { id: 'generator', name: 'Generator Shed', physical: 'Power module', level: 'critical' },
  { id: 'livingQuarters', name: 'Living Quarters', physical: 'Spine of the U', level: 'warning' },
  { id: 'lab', name: 'Research Lab', physical: 'Containers', level: 'normal' },
];
const base = {
  view: 'station', onViewChange: vi.fn(), antarcticaEnabled: true, zones, selectedBuilding: null,
  summary: 'Maitri station, schematic layout.', environment: 'Day.', stationName: 'Maitri', aboutLines: ['The light falling snow is decorative, not data.'],
};
const renderControls = (props = {}) => render(<AppThemeProvider><SceneControls {...base} {...props} /></AppThemeProvider>);

describe('SceneControls', () => {
  it('lists every building with its alert level as text, and selecting one opens it', () => {
    const onSelectBuilding = vi.fn();
    renderControls({ onSelectBuilding });
    fireEvent.click(screen.getByTestId('scene-buildings-button'));
    expect(screen.getByTestId('scene-building-generator')).toHaveTextContent('Critical');
    expect(screen.getByTestId('scene-building-livingQuarters')).toHaveTextContent('Warning');
    expect(screen.getByTestId('scene-building-lab')).toHaveTextContent('Normal');
    fireEvent.click(screen.getByTestId('scene-building-generator'));
    expect(onSelectBuilding).toHaveBeenCalledWith('generator');
    expect(screen.queryByTestId('scene-buildings-list')).toBeNull();
  });

  it('says the layout is schematic and that the snowfall is decorative', () => {
    renderControls();
    expect(screen.getByTestId('scene-schematic-note')).toHaveTextContent('Schematic layout — positions approximate');
    fireEvent.click(screen.getByTestId('scene-about-button'));
    expect(screen.getByTestId('scene-about')).toHaveTextContent('decorative, not data');
  });

  it('announces the summary politely', () => {
    renderControls();
    expect(screen.getByTestId('scene-live-summary')).toHaveAttribute('aria-live', 'polite');
  });

  it('in the Antarctica view the stations are buttons', () => {
    const onPinSelect = vi.fn();
    renderControls({
      view: 'antarctica', onPinSelect,
      pins: [{ id: 'maitri', name: 'Maitri', coords: '70.77°S, 11.73°E', pos: [100, 100], selected: true },
        { id: 'bharati', name: 'Bharati', coords: '69.41°S, 76.19°E', pos: [200, 120], selected: false }],
    });
    expect(screen.queryByTestId('scene-buildings-button')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Fly to Bharati' }));
    expect(onPinSelect).toHaveBeenCalledWith('bharati');
  });
});
