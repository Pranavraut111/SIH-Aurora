/* Incident card queue: a visitor's own incident that could not take the card says why. */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PLAYBOOKS from '../../simulator/playbooks.json';
import AppThemeProvider from '../theme/AppThemeProvider';
import IncidentCard from './IncidentCard';

const book = (id) => PLAYBOOKS.playbooks.find((b) => b.id === id);
const inc = (over) => ({
  status: 'active', severity: 'critical', risk: 'high', baselineRisk: 'high', sources: [], affected: [], everAffected: [],
  sensors: [], done: [], startedAt: 0, alertIds: [], ...over,
});
const gen = inc({ key: 'bharati:generator_failure', station: 'bharati', playbookId: 'generator_failure' });
const blizzard = inc({ key: 'maitri:blizzard', station: 'maitri', playbookId: 'blizzard', severity: 'warning' });

const renderCard = (queue) => render(
  <AppThemeProvider><IncidentCard incident={gen} book={book('generator_failure')} queue={queue} /></AppThemeProvider>);

describe('IncidentCard queue', () => {
  it('shows why the visitor\'s own incident is queued', () => {
    renderCard([gen, { ...blizzard, queuedBehind: 'Your blizzard is queued behind a critical generator failure at Bharati.' }]);
    expect(screen.getByTestId('incident-card')).toHaveAttribute('data-incident', 'generator_failure');
    expect(screen.getByText('Warning: blizzard · Maitri')).toBeInTheDocument();
    expect(screen.getByTestId('incident-queued-note')).toHaveTextContent('Your blizzard is queued behind a critical generator failure at Bharati.');
  });

  it('shows no note for incidents that were not the visitor\'s own', () => {
    renderCard([gen, blizzard]);
    expect(screen.queryByTestId('incident-queued-note')).toBeNull();
  });
});
