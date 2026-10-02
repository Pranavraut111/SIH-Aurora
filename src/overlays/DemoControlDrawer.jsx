/* ═══════════════════════════════════════════════════════════════
   Aurora — Demo Control (rollout 1B). Replaces the legacy DemoControl.

   Injects a synthetic fault into the active station through the backend
   proxy (POST /sim/inject/{id}, /sim/reset; write-protected). Each scenario
   is described by what it actually overrides: the simulator's targets,
   approached 30 % per tick for the scenario's duration. Every value it
   touches is then labelled Simulated. Confirmed first; reported as a toast.
   ═══════════════════════════════════════════════════════════════ */
import { useState } from 'react';
import { Box, ButtonBase, LinearProgress, Stack, Typography } from '@mui/material';
import RestartAltOutlined from '@mui/icons-material/RestartAltOutlined';
import { apiGet, apiPost } from '../services/api';
import { usePolling } from '../hooks/usePolling';
import { sensorCatalog, stationMeta } from '../data/stationConfig';
import { formatValue } from '../lib/format';
import { describeFailure } from '../lib/failure';
import { ErrorState, LoadingBlock } from '../ui/States';
import { StatusChip } from '../ui/Status';
import WriteButton from '../ui/WriteButton';
import { useAdminToken } from '../hooks/useAdminToken';
import { useConfirm, useToast } from '../ui/feedbackContext';
import SideSheet from './SideSheet';

function targetText(stationId, targets = {}) {
  const cat = sensorCatalog(stationId);
  return Object.entries(targets).map(([key, v]) => {
    const sensor = key.split('.')[1];
    const c = cat[sensor];
    return `${c?.name ?? sensor} → ${formatValue(v, c?.unit ?? '', 1)}`;
  }).join(', ');
}

export default function DemoControlDrawer({ open, onClose, activeStation }) {
  const confirm = useConfirm();
  const toast = useToast();
  const { canWrite } = useAdminToken();
  const [state, setState] = useState({ station: null, data: null, error: null });
  const [busy, setBusy] = useState(null);

  usePolling(async (isActive) => {
    try {
      const d = await apiGet(`/sim/scenarios?stationId=${activeStation}`);
      if (isActive()) setState({ station: activeStation, data: d, error: null });
    } catch (err) {
      if (isActive()) setState({ station: activeStation, data: null, error: err });
      throw err;
    }
  }, 3000, { key: activeStation, enabled: Boolean(open) });

  const d = state.station === activeStation ? state.data : null;
  const name = stationMeta(activeStation).name;
  const active = d?.activeScenario ? d.scenarios?.[d.activeScenario] : null;

  async function inject(id, sc) {
    const ok = await confirm({
      title: `Inject “${sc.name}” into ${name}?`,
      body: <>Overrides for {sc.duration} s: {targetText(activeStation, sc.targets)}. The values are labelled Simulated and may raise alerts. Nothing real is affected.</>,
      confirmLabel: 'Inject', danger: true,
    });
    if (!ok) return;
    setBusy(id);
    try {
      await apiPost(`/sim/inject/${id}?stationId=${activeStation}`);
      toast({ text: `Injected “${sc.name}” into ${name} for ${sc.duration} s.` });
    } catch (err) {
      console.error('[Demo] inject failed', err);
      toast({ severity: 'error', text: `Not injected: ${err?.status === 503 ? 'the simulator is offline' : describeFailure(err)}.` });
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    const ok = await confirm({ title: `Clear injected scenarios on ${name}?`, body: 'Removes every override; readings return to the model on the next ticks.', confirmLabel: 'Reset' });
    if (!ok) return;
    setBusy('reset');
    try {
      await apiPost(`/sim/reset?stationId=${activeStation}`);
      toast({ text: `Cleared injected scenarios on ${name}.` });
    } catch (err) {
      console.error('[Demo] reset failed', err);
      toast({ severity: 'error', text: `Reset failed: ${describeFailure(err)}.` });
    } finally {
      setBusy(null);
    }
  }

  return (
    <SideSheet open={open} onClose={onClose} title="Demo control" testId="demo-control-panel"
      subtitle={`Inject a synthetic fault into ${name} to exercise alerts, cascade rules and the decision engine.`}>
      {state.error && state.station === activeStation && (
        <ErrorState sx={{ mb: 3 }}>{state.error?.status === 503 ? 'The simulator is offline: scenarios cannot be injected.' : `Scenarios unavailable: ${describeFailure(state.error)}.`}</ErrorState>
      )}
      {!d && !state.error && <LoadingBlock lines={6} />}
      {d && (
        <>
          {active && (
            <Box sx={{ p: 4, mb: 4, borderRadius: '10px', bgcolor: 'status.simulatedTint' }} role="status">
              <Stack direction="row" sx={{ gap: 2, alignItems: 'center' }}>
                <StatusChip status="simulated" label="Active" />
                <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{active.name}</Typography>
              </Stack>
              <LinearProgress sx={{ mt: 2 }} aria-label="Scenario running" />
            </Box>
          )}
          <Stack component="ul" sx={{ m: 0, p: 0, listStyle: 'none', gap: 2 }}>
            {Object.entries(d.scenarios || {}).map(([id, sc]) => (
              <Box component="li" key={id}>
                <ButtonBase onClick={() => inject(id, sc)} disabled={!canWrite || busy != null || d.activeScenario === id}
                  data-testid={`demo-scenario-${id}`}
                  sx={(t) => ({
                    display: 'block', width: '100%', textAlign: 'left', p: 4, borderRadius: '10px', bgcolor: t.vars.palette.aurora.surfaceRaised,
                    '&:hover': { bgcolor: t.vars.palette.action.hover }, '&.Mui-disabled': { opacity: 0.6 },
                  })}>
                  <Stack direction="row" sx={{ gap: 2, alignItems: 'baseline' }}>
                    <Typography sx={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{sc.name}</Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontFeatureSettings: '"tnum" 1' }}>{sc.duration} s</Typography>
                  </Stack>
                  <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>{sc.description}</Typography>
                  {sc.targets && <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 1, mb: 0 }}>Overrides: {targetText(activeStation, sc.targets)}</Typography>}
                </ButtonBase>
              </Box>
            ))}
          </Stack>
          {!canWrite && <Typography variant="body2" sx={{ color: 'text.secondary', mt: 3 }}>Sign in as operator to inject scenarios.</Typography>}
          <Box sx={{ mt: 4 }}>
            <WriteButton variant="outlined" startIcon={<RestartAltOutlined />} onClick={reset} disabled={busy != null} data-testid="demo-reset">Reset all scenarios</WriteButton>
          </Box>
          <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 3 }}>
            Simulator tick #{d.tickCount}. Values move 30 % of the way to each target per tick.
          </Typography>
        </>
      )}
    </SideSheet>
  );
}
