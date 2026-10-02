/* ═══════════════════════════════════════════════════════════════
   Aurora — Remote commands (rollout 1B, checkpoint 2).

   SIMULATED dispatch, and the page says so everywhere: POST /remote/dispatch
   records a request; the backend tick moves it to "acknowledged (simulated)";
   nothing reaches equipment and the twin does not change. The command set is
   the backend's catalogue (station_config.json), and "last request" is read
   from the command log, never from a client-side default. Alerts are the
   alert engine's, acknowledged by id with the operator's name.
   ═══════════════════════════════════════════════════════════════ */
import { useState } from 'react';
import { Alert, Box, Card, Chip, Grid, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { apiGet, apiPost, describeApiError } from '../../services/api';
import { usePolling } from '../../hooks/usePolling';
import { useAdminToken } from '../../hooks/useAdminToken';
import { useNow } from '../../hooks/useNow';
import { getOperatorName } from '../../services/operator';
import { stationMeta } from '../../data/stationConfig';
import { formatDateTimeIST, formatTimeIST, formatValue } from '../../lib/format';
import { describeFailure } from '../../lib/failure';
import KpiCard from '../../ui/KpiCard';
import PageHeader from '../../ui/PageHeader';
import ProvenanceChip from '../../ui/Provenance';
import ScrollX from '../../ui/ScrollX';
import SectionCard from '../../ui/SectionCard';
import { ErrorState, LoadingBlock } from '../../ui/States';
import { StatusChip } from '../../ui/Status';
import WriteButton from '../../ui/WriteButton';
import { useConfirm, useToast } from '../../ui/feedbackContext';
import { MODULES, sectionLabel } from '../../shell/navigation';

const hidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' };
// Plain-language labels for the catalogue's command ids (the id is shown too).
const COMMAND_LABEL = {
  ENGAGE_BACKUP_GENSET_RUN: 'Start backup gen-set',
  SET_GENSET_STANDBY_HOT: 'Backup gen-set to hot standby',
  ENABLE_ZONE_B_HEATING: 'Zone B auxiliary heating on',
  DISABLE_ZONE_B_HEATING: 'Zone B auxiliary heating off',
  ENABLE_SNOWMELT_TRACER: 'Snow-melt heat tracers on',
  DISABLE_SNOWMELT_TRACER: 'Snow-melt heat tracers off',
  SET_RADOME_TRACKING_AUTO: 'Satellite dish: automatic tracking',
  STOW_DISH_BLIZZARD_MODE: 'Satellite dish: stow for blizzard',
};
const label = (cmd) => COMMAND_LABEL[cmd] || cmd.replace(/_/g, ' ').toLowerCase();

function SimulatedChip({ status }) {
  return <Chip size="small" label={status} sx={(t) => ({ color: t.vars.palette.status.simulated, bgcolor: t.vars.palette.status.simulatedTint })} />;
}

export default function RemoteModule({ activeStation = 'maitri', activeAlerts = [], canAcknowledge = true, onAcknowledgeAlert, updatedAt }) {
  const meta = MODULES.remote;
  const { canWrite } = useAdminToken();
  const now = useNow(60_000);
  const [state, setState] = useState({ station: null, commands: null, catalog: null, error: null });
  const [busy, setBusy] = useState(null);
  const confirm = useConfirm();
  const toast = useToast();
  const [ackBusy, setAckBusy] = useState(null);

  const load = async (isActive = () => true) => {
    const d = await apiGet(`/remote/commands?stationId=${activeStation}`);
    if (isActive()) setState({ station: activeStation, commands: d?.commands || [], catalog: d?.catalog || {}, error: null });
  };
  usePolling(async (isActive) => {
    try { await load(isActive); } catch (err) {
      console.error('[Remote] load failed', err);
      if (isActive()) setState((s) => ({ ...s, station: activeStation, error: err }));
      throw err;
    }
  }, 3000, { key: activeStation });

  const ready = state.station === activeStation && state.commands != null;
  const commands = ready ? state.commands : [];
  const catalog = ready ? Object.entries(state.catalog).filter(([k]) => !k.startsWith('_')) : [];
  const lastFor = (subsystem) => commands.find((c) => c.subsystem === subsystem);
  const pending = commands.filter((c) => c.status?.startsWith('queued')).length;
  const dayAgo = now - 86_400_000;
  const today = commands.filter((c) => c.created_at >= dayAgo).length;
  const unacked = activeAlerts.filter((a) => !a.acknowledged);

  async function dispatch(subsystem, command) {
    const ok = await confirm({
      title: `Request “${label(command)}”?`,
      body: `Recorded for ${stationMeta(activeStation).name} as ${getOperatorName()}: queued, then acknowledged by the backend (simulated). Nothing is sent to equipment.`,
      confirmLabel: 'Record request',
    });
    if (!ok) return;
    setBusy(command);
    try {
      const d = await apiPost('/remote/dispatch', { stationId: activeStation, subsystem, command, parameters: {}, issuedBy: getOperatorName() });
      toast({ text: `${label(command)}: ${d?.status ?? 'queued (simulated)'}. Recorded only; nothing was sent to equipment.` });
      await load().catch((e) => console.error('[Remote] refresh failed', e));
    } catch (err) {
      console.error('[Remote] dispatch failed', err);
      toast({ severity: 'error', text: `Not recorded: ${describeApiError(err)}` });
    } finally {
      setBusy(null);
    }
  }

  async function acknowledge(a) {
    const ok = await confirm({
      title: 'Acknowledge this alert?',
      body: `${a.buildingName}: ${a.message} Recorded as acknowledged by ${getOperatorName()}; it stays listed until the reading is normal again.`,
      confirmLabel: 'Acknowledge',
    });
    if (!ok) return;
    setAckBusy(a.id);
    const res = await onAcknowledgeAlert?.(a.id);
    setAckBusy(null);
    toast(res?.ok ? { text: `Acknowledged: ${a.buildingName}.` } : { severity: 'error', text: `Acknowledge failed: ${res?.error || 'no response'}` });
  }

  return (
    <Box data-testid="remote-module">
      <PageHeader
        section={sectionLabel(meta.section)}
        title={meta.title}
        description={`${meta.description} ${stationMeta(activeStation).name} station.`}
        updatedAt={updatedAt}
        updatedLabel="Snapshot"
        provenance={<ProvenanceChip kind="SIMULATED" subject="Dispatch" detail="Requests are recorded and acknowledged by the backend only. No link to station equipment exists." />}
      />

      <Alert severity="info" sx={{ mb: 4 }} data-testid="remote-simulated-note">
        Simulated dispatch. A request is recorded as “queued (simulated)” and later “acknowledged (simulated)” by the backend.
        Nothing is sent to station equipment and the twin is not changed.
      </Alert>
      {state.error && <ErrorState sx={{ mb: 4 }}>The command log could not be loaded because {describeFailure(state.error)}. Retrying automatically.</ErrorState>}

      <Typography variant="h2" sx={hidden}>Summary</Typography>
      <Box component="section" aria-label="Command summary" sx={{ display: 'grid', gap: 4, mb: 4, gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' } }}>
        <KpiCard label="Unacknowledged alerts" value={activeAlerts.length ? unacked.length : 0} testId="kpi-unacked"
          status={unacked.some((a) => a.level === 'critical') ? 'critical' : unacked.length ? 'warning' : undefined}
          context={`${activeAlerts.length} active in the alert engine`} sx={{ gridColumn: { xs: 'span 2', md: 'auto' } }} />
        <KpiCard label="Requests, last 24 h" value={ready ? today : null} testId="kpi-requests" context="Simulated, from the command log" />
        <KpiCard label="Awaiting simulated ack" value={ready ? pending : null} testId="kpi-pending" context="Acknowledged automatically after a few seconds" />
      </Box>

      <Grid container spacing={4}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <SectionCard title="Command requests" subtitle="From the backend's command catalogue. Each request is recorded, not executed." testId="remote-controls"
            provenance={<ProvenanceChip kind="SIMULATED" />}>
            {!ready && !state.error ? <LoadingBlock lines={6} /> : (
              <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' } }}>
                {catalog.map(([subsystem, cmds]) => {
                  const last = lastFor(subsystem);
                  return (
                    <Card key={subsystem} sx={{ p: 4, bgcolor: 'aurora.surfaceRaised', borderColor: 'transparent', display: 'flex', flexDirection: 'column', gap: 2 }} data-testid={`remote-subsystem-${subsystem}`}>
                      <Typography sx={{ fontWeight: 600 }}>{subsystem}</Typography>
                      <Typography variant="body2" sx={{ color: 'text.secondary', minHeight: 40 }}>
                        {last ? <>Last request: <Box component="span" sx={{ color: 'text.primary' }}>{label(last.command)}</Box>, {formatTimeIST(last.created_at)} by {last.issued_by} ({last.status})</> : 'No request recorded yet.'}
                      </Typography>
                      <Stack sx={{ gap: 1.5, mt: 'auto' }}>
                        {cmds.map((cmd) => (
                          <WriteButton key={cmd} variant="outlined" size="small" onClick={() => dispatch(subsystem, cmd)}
                            disabled={busy != null} data-testid={`remote-cmd-${cmd}`} sx={{ justifyContent: 'flex-start', width: '100%' }}>
                            {busy === cmd ? 'Recording…' : label(cmd)}
                          </WriteButton>
                        ))}
                      </Stack>
                    </Card>
                  );
                })}
              </Box>
            )}
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <SectionCard title="Active alerts" subtitle="From the alert engine. Acknowledging records your name; the alert clears when the reading returns to normal." testId="remote-alerts">
            {!activeAlerts.length ? (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>No active alerts.</Typography>
            ) : (
              <Stack component="ul" sx={{ m: 0, p: 0, listStyle: 'none', gap: 3 }}>
                {activeAlerts.map((a) => (
                  <Box component="li" key={a.id} sx={{ p: 4, borderRadius: '10px', bgcolor: 'aurora.surfaceRaised' }}>
                    <Stack direction="row" sx={{ gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                      <StatusChip status={a.level === 'critical' ? 'critical' : 'warning'} />
                      <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{a.buildingName}</Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary', ml: 'auto' }}>{formatTimeIST(a.timestamp)}</Typography>
                    </Stack>
                    <Typography variant="body2" sx={{ mt: 1.5 }}>{a.message}</Typography>
                    <Typography variant="caption" component="p" sx={{ color: 'text.secondary', m: 0 }}>
                      {a.sensor}: {formatValue(a.value, a.unit, 1)} (threshold {formatValue(a.threshold, a.unit, 1)})
                    </Typography>
                    <Box sx={{ mt: 2 }}>
                      {a.acknowledged ? (
                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>Acknowledged by {a.acknowledgedBy}</Typography>
                      ) : canAcknowledge ? (
                        <WriteButton size="small" variant="outlined" onClick={() => acknowledge(a)} disabled={ackBusy === a.id}>
                          {ackBusy === a.id ? 'Acknowledging…' : 'Acknowledge'}
                        </WriteButton>
                      ) : (
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>Browser-demo alerts cannot be acknowledged.</Typography>
                      )}
                    </Box>
                  </Box>
                ))}
              </Stack>
            )}
            {!canWrite && activeAlerts.length > 0 && (
              <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 3 }}>Sign in as operator to acknowledge.</Typography>
            )}
          </SectionCard>
        </Grid>
      </Grid>

      <Box sx={{ mt: 4 }}>
        <SectionCard title="Command log" subtitle="Simulated requests for this station, newest first" testId="remote-log">
          {!ready && !state.error ? <LoadingBlock lines={4} /> : !commands.length ? (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>No simulated commands logged for this station.</Typography>
          ) : (
            <ScrollX label="Command log, scrollable">
              <Table size="small" aria-label="Command log" sx={{ minWidth: 640 }}>
                <TableHead>
                  <TableRow><TableCell sx={{ pl: 0 }}>Requested (IST)</TableCell><TableCell>Command</TableCell><TableCell>Status</TableCell><TableCell>By</TableCell><TableCell sx={{ pr: 0 }}>ID</TableCell></TableRow>
                </TableHead>
                <TableBody>
                  {commands.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell sx={{ pl: 0, typography: 'mono', fontSize: 12, whiteSpace: 'nowrap' }}>{formatDateTimeIST(c.created_at).replace(' IST', '')}</TableCell>
                      <TableCell>{label(c.command)}<Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>{c.subsystem}</Typography></TableCell>
                      <TableCell><SimulatedChip status={c.status} /></TableCell>
                      <TableCell>{c.issued_by}</TableCell>
                      <TableCell sx={{ pr: 0, typography: 'mono', fontSize: 12, color: 'text.secondary' }}>{c.id}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollX>
          )}
        </SectionCard>
      </Box>
    </Box>
  );
}
