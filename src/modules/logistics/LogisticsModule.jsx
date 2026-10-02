/* ═══════════════════════════════════════════════════════════════
   Aurora — Logistics module (rollout 1B, checkpoint 2).

   The operator-entered inventory ledger (GET /logistics, /logistics/history,
   POST /logistics/update). Nothing here is telemetry: the physics model keeps
   its own stock estimates (Infrastructure → Logistics Store). "Low" means at
   or below the item's reorder level, as the backend computes it; no client
   rule is added on top. Edits need the operator token when write protection
   is on, and every change is written to the audit log with the entered name.
   ═══════════════════════════════════════════════════════════════ */
import { useCallback, useState } from 'react';
import {
  Alert, Box, Button, Card, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, Stack,
  Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import EditOutlined from '@mui/icons-material/EditOutlined';
import { apiGet, apiPost, describeApiError } from '../../services/api';
import { usePolling } from '../../hooks/usePolling';
import { getOperatorName, OPERATOR_NAME_RE, setOperatorName as persistOperatorName } from '../../services/operator';
import { stationMeta } from '../../data/stationConfig';
import { formatDateTimeIST, formatNumber, formatValue, isNum } from '../../lib/format';
import { describeFailure } from '../../lib/failure';
import KpiCard from '../../ui/KpiCard';
import PageHeader from '../../ui/PageHeader';
import ProvenanceChip from '../../ui/Provenance';
import ScrollX from '../../ui/ScrollX';
import SectionCard from '../../ui/SectionCard';
import { EmptyState, ErrorState, LoadingBlock } from '../../ui/States';
import { StatusChip } from '../../ui/Status';
import WriteButton from '../../ui/WriteButton';
import { SandboxNotice, SandboxTag } from '../../ui/Sandbox';
import { useConfirm, useToast } from '../../ui/feedbackContext';
import { MODULES, sectionLabel } from '../../shell/navigation';

const hidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' };

function StockBar({ item }) {
  const pct = item.max > 0 ? Math.min(100, (item.current / item.max) * 100) : null;
  if (pct == null) return null;
  return (
    <LinearProgress variant="determinate" value={pct} color={item.isLow ? 'warning' : 'primary'}
      aria-label={`${item.name}: ${formatNumber(pct)}% of the ledger maximum`} sx={{ mt: 1 }} />
  );
}

function autonomyText(item) {
  return item.daysRemaining == null ? 'no daily use' : `${formatNumber(item.daysRemaining)} days`;
}

function EditDialog({ item, stationId, onClose, onSaved }) {
  const confirm = useConfirm();
  const [current, setCurrent] = useState(String(item.current));
  const [daily, setDaily] = useState(String(item.dailyUse));
  const [name, setName] = useState(getOperatorName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const cur = Number(current);
  const curError = current === '' || !Number.isFinite(cur) || cur < 0 ? 'Enter a number ≥ 0'
    : cur > item.max ? `At most the ledger maximum, ${formatValue(item.max, item.unit)}` : null;
  const dailyError = daily === '' || !Number.isFinite(Number(daily)) || Number(daily) < 0 ? 'Enter a number ≥ 0' : null;
  const nameError = OPERATOR_NAME_RE.test(name.trim()) ? null : "2–60 letters, digits, spaces or . , ' ( ) _ -";

  async function save(e) {
    e.preventDefault();
    if (curError || dailyError || nameError) return;
    const ok = await confirm({
      title: `Write ${item.name} to the ledger?`,
      body: `Stock ${formatValue(item.current, item.unit)} → ${formatValue(cur, item.unit)}; daily use ${formatValue(item.dailyUse, item.unit)} → ${formatValue(Number(daily), item.unit)}. Recorded in the audit log as ${name.trim()}.`,
      confirmLabel: 'Save to ledger',
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost('/logistics/update', {
        stationId, itemId: item.id, current: cur, dailyConsumption: Number(daily), updatedBy: name.trim(),
      });
      persistOperatorName(name);
      onSaved(res?.sandbox
        ? `Saved ${item.name} in your sandbox. Only you see it; the station's real ledger is unchanged.`
        : `Saved ${item.name}. The change is in the audit log.`);
    } catch (err) {
      console.error('[Logistics] update failed', err);
      setError(`Not saved: ${describeApiError(err)}`);
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth aria-labelledby="ledger-edit-title">
      <form onSubmit={save} noValidate>
        <DialogTitle id="ledger-edit-title">Update {item.name}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 4 }}>
            Operator-entered ledger. The change and your name are written to the audit log.
          </Typography>
          <Stack sx={{ gap: 4 }}>
            <TextField label={`Current stock (${item.unit})`} type="number" size="small" value={current} autoFocus
              onChange={(e) => setCurrent(e.target.value)} error={Boolean(curError)} helperText={curError || `Ledger maximum ${formatValue(item.max, item.unit)}`}
              slotProps={{ htmlInput: { min: 0, max: item.max, step: 'any', 'data-testid': 'ledger-current' } }} />
            <TextField label={`Daily use (${item.unit}/day)`} type="number" size="small" value={daily}
              onChange={(e) => setDaily(e.target.value)} error={Boolean(dailyError)} helperText={dailyError || ' '}
              slotProps={{ htmlInput: { min: 0, step: 'any' } }} />
            <TextField label="Your name (for the audit log)" size="small" value={name} onChange={(e) => setName(e.target.value)}
              error={Boolean(nameError)} helperText={nameError || 'Recorded with the change; it is not a login.'}
              slotProps={{ htmlInput: { maxLength: 60 } }} />
          </Stack>
          {error && <Alert severity="error" sx={{ mt: 3 }}>{error}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <WriteButton type="submit" variant="contained" disabled={busy || Boolean(curError || dailyError || nameError)} data-testid="ledger-save">
            {busy ? 'Saving…' : 'Save'}
          </WriteButton>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export default function LogisticsModule({ activeStation = 'maitri' }) {
  const meta = MODULES.logistics;
  const theme = useTheme();
  const wide = useMediaQuery(theme.breakpoints.up('md'), { noSsr: true });
  const [state, setState] = useState({ station: null, items: null, history: null, error: null });
  const [editing, setEditing] = useState(null);
  const toast = useToast();
  const [attempt, setAttempt] = useState(0);

  usePolling(async (isActive) => {
    try {
      const [inv, hist] = await Promise.all([
        apiGet(`/logistics?stationId=${activeStation}`),
        apiGet(`/logistics/history?stationId=${activeStation}&limit=20`),
      ]);
      if (isActive()) setState({ station: activeStation, items: inv?.items || [], history: hist?.history || [], error: null });
    } catch (err) {
      console.error('[Logistics] load failed', err);
      if (isActive()) setState((s) => ({ ...s, station: activeStation, error: err }));
      throw err;
    }
  }, 15000, { key: `${activeStation}:${attempt}` });
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  const ready = state.station === activeStation && state.items != null;
  const items = ready ? state.items : [];
  const history = ready ? state.history : [];
  const names = Object.fromEntries(items.map((i) => [i.id, i.name]));
  const withDays = items.filter((i) => isNum(i.daysRemaining));
  const shortest = withDays.length ? withDays.reduce((a, b) => (b.daysRemaining < a.daysRemaining ? b : a)) : null;
  const low = items.filter((i) => i.isLow);
  const lastEdit = history[0];
  const lastUpdated = items.reduce((m, i) => Math.max(m, i.lastUpdated || 0), 0) || null;
  const station = stationMeta(activeStation).name;

  return (
    <Box data-testid="logistics-module">
      <PageHeader
        section={sectionLabel(meta.section)}
        title={meta.title}
        description={`${meta.description} ${station} station.`}
        updatedAt={lastUpdated}
        updatedLabel="Ledger updated"
        provenance={<ProvenanceChip kind="OPERATOR-ENTERED" subject="Inventory" detail="Not telemetry. The physics model keeps its own stock estimates under Infrastructure → Logistics Store." />}
      />

      <SandboxNotice>Your ledger edits change only what you see, never the station's real ledger.</SandboxNotice>

      {state.error && (
        <ErrorState sx={{ mb: 4 }} onRetry={reload}>
          The ledger could not be loaded because {describeFailure(state.error)}.{ready ? ' Showing the last values received.' : ''}
        </ErrorState>
      )}

      <Typography variant="h2" sx={hidden}>Supply summary</Typography>
      <Box component="section" aria-label="Supply summary" data-testid="logistics-kpis" sx={{
        display: 'grid', gap: 4, mb: 4,
        gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', lg: 'minmax(0, 1.6fr) repeat(2, minmax(0, 1fr))' },
        gridTemplateAreas: { xs: '"hero hero" "a b" "c c"', lg: '"hero a b" "hero c c"' },
      }}>
        <Card component="section" aria-label="Shortest supply" data-testid="kpi-shortest" sx={{ gridArea: 'hero', p: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="label" component="h3" sx={{ color: 'text.secondary' }}>Shortest supply</Typography>
            {shortest?.isLow && <StatusChip status="warning" label="Reorder" />}
          </Stack>
          <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1.5 }}>
            <Typography variant="kpiHero" component="p" sx={{ m: 0, color: shortest ? 'text.primary' : 'text.disabled' }}>{shortest ? formatNumber(shortest.daysRemaining) : '—'}</Typography>
            {shortest && <Typography sx={{ color: 'text.secondary', fontSize: 20, fontWeight: 500 }}>days</Typography>}
          </Stack>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {shortest ? `${shortest.name}: ${formatValue(shortest.current, shortest.unit)} at ${formatValue(shortest.dailyUse, `${shortest.unit}/day`)}` : ready ? 'No item has a daily use recorded' : ''}
          </Typography>
          {withDays.length > 1 && (
            <Box component="ul" aria-label="Autonomy by item" sx={{ m: 0, p: 0, listStyle: 'none', mt: 'auto', display: 'grid', gap: 1.5 }}>
              {[...withDays].sort((x, y) => x.daysRemaining - y.daysRemaining).map((i) => (
                <Box component="li" key={i.id} sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 9rem) minmax(0, 1fr) 4.5rem', gap: 2, alignItems: 'center', fontSize: 13 }}>
                  <Box component="span" sx={{ color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.category}</Box>
                  <Box aria-hidden="true" sx={(t) => ({ height: 6, borderRadius: 3, bgcolor: t.vars.palette.aurora.borderSubtle, overflow: 'hidden' })}>
                    <Box sx={(t) => ({ height: '100%', width: `${(i.daysRemaining / Math.max(...withDays.map((x) => x.daysRemaining))) * 100}%`, bgcolor: i.isLow ? t.vars.palette.status.warning : t.vars.palette.primary.main })} />
                  </Box>
                  <Box component="span" sx={{ textAlign: 'right', fontFeatureSettings: '"tnum" 1' }}>{formatNumber(i.daysRemaining)} d</Box>
                </Box>
              ))}
            </Box>
          )}
        </Card>
        <KpiCard label="At or below reorder level" value={ready ? low.length : null} testId="kpi-low" sx={{ gridArea: 'a' }}
          status={low.length ? 'warning' : undefined}
          context={!ready ? 'Ledger not loaded' : low.length ? low.map((i) => i.name).join(', ') : 'Every item is above its reorder level'} />
        <KpiCard label="Items in the ledger" value={ready ? items.length : null} testId="kpi-items" sx={{ gridArea: 'b' }}
          context="Fuel, food, medical, spares, water" />
        <Card component="section" aria-label="Last ledger edit" data-testid="kpi-last-edit" sx={{ gridArea: 'c', p: 5, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="label" component="h3" sx={{ color: 'text.secondary' }}>Last ledger edit</Typography>
          {lastEdit ? (
            <>
              <Typography sx={{ fontWeight: 600 }}>{names[lastEdit.itemId] || lastEdit.itemId}: {lastEdit.field.replace(/_/g, ' ')}</Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {lastEdit.oldValue} → {lastEdit.newValue} by {lastEdit.updatedBy},{' '}
                <Box component="span" sx={{ typography: 'mono', fontSize: 13 }}>{formatDateTimeIST(lastEdit.updatedAt)}</Box>
              </Typography>
            </>
          ) : <Typography variant="body2" sx={{ color: 'text.secondary' }}>{ready ? 'No edits recorded yet.' : '—'}</Typography>}
        </Card>
      </Box>

      <SectionCard title="Inventory" subtitle="Autonomy = stock ÷ daily use. Low = at or below the item's reorder level." testId="logistics-inventory"
        provenance={<ProvenanceChip kind="OPERATOR-ENTERED" />}>
        {!ready && !state.error ? <LoadingBlock lines={6} /> : !ready ? (
          <EmptyState title="Ledger not loaded">It appears here once the backend responds; the page retries automatically.</EmptyState>
        ) : !items.length ? (
          <EmptyState title="No inventory items">The ledger has no items for this station.</EmptyState>
        ) : wide ? (
          <Table size="small" aria-label="Inventory ledger">
            <TableHead>
              <TableRow>
                <TableCell sx={{ pl: 0 }}>Item</TableCell>
                <TableCell align="right">Stock</TableCell>
                <TableCell align="right">Daily use</TableCell>
                <TableCell align="right">Autonomy</TableCell>
                <TableCell align="right">Reorder at</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Updated</TableCell>
                <TableCell sx={{ pr: 0 }}><Box component="span" sx={hidden}>Actions</Box></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((i) => (
                <TableRow key={i.id} data-testid={`ledger-row-${i.id}`}>
                  <TableCell sx={{ pl: 0, minWidth: 220 }}>
                    <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{i.name} <SandboxTag show={i.sandbox} sx={{ ml: 1 }} /></Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>{i.category}</Typography>
                    <StockBar item={i} />
                  </TableCell>
                  <TableCell align="right" sx={{ fontFeatureSettings: '"tnum" 1' }}>
                    {formatValue(i.current, i.unit)}
                    <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>of {formatValue(i.max, i.unit)}</Typography>
                  </TableCell>
                  <TableCell align="right" sx={{ fontFeatureSettings: '"tnum" 1' }}>{formatValue(i.dailyUse, `${i.unit}/day`, i.dailyUse < 10 ? 1 : 0)}</TableCell>
                  <TableCell align="right" sx={{ fontFeatureSettings: '"tnum" 1', fontWeight: 600 }}>{autonomyText(i)}</TableCell>
                  <TableCell align="right" sx={{ fontFeatureSettings: '"tnum" 1', color: 'text.secondary' }}>{formatValue(i.reorderAt, i.unit)}</TableCell>
                  <TableCell>{i.isLow ? <StatusChip status="warning" label="Reorder" /> : <StatusChip status="normal" label="OK" />}</TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: 12, whiteSpace: 'nowrap' }}>
                    {i.updatedBy || '—'}<br />{i.lastUpdated ? formatDateTimeIST(i.lastUpdated) : ''}
                  </TableCell>
                  <TableCell align="right" sx={{ pr: 0 }}>
                    <WriteButton size="small" startIcon={<EditOutlined />} onClick={() => setEditing(i)} aria-label={`Update ${i.name}`} data-testid={`ledger-edit-${i.id}`}>Update</WriteButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Stack component="ul" sx={{ m: 0, p: 0, listStyle: 'none', gap: 3 }}>
            {items.map((i) => (
              <Box component="li" key={i.id} data-testid={`ledger-row-${i.id}`} sx={{ p: 4, borderRadius: '10px', bgcolor: 'aurora.surfaceRaised' }}>
                <Stack direction="row" sx={{ alignItems: 'flex-start', gap: 2 }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{i.name} <SandboxTag show={i.sandbox} sx={{ ml: 1 }} /></Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>{i.category}</Typography>
                  </Box>
                  {i.isLow ? <StatusChip status="warning" label="Reorder" /> : <StatusChip status="normal" label="OK" />}
                </Stack>
                <Stack direction="row" sx={{ justifyContent: 'space-between', mt: 2, fontSize: 14 }}>
                  <span>{formatValue(i.current, i.unit)} <Box component="span" sx={{ color: 'text.secondary' }}>of {formatValue(i.max, i.unit)}</Box></span>
                  <Box component="span" sx={{ fontWeight: 600 }}>{autonomyText(i)}</Box>
                </Stack>
                <StockBar item={i} />
                <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mt: 2 }}>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>Use {formatValue(i.dailyUse, `${i.unit}/day`, i.dailyUse < 10 ? 1 : 0)} · reorder at {formatValue(i.reorderAt, i.unit)}</Typography>
                  <WriteButton size="small" startIcon={<EditOutlined />} onClick={() => setEditing(i)} aria-label={`Update ${i.name}`}>Update</WriteButton>
                </Stack>
              </Box>
            ))}
          </Stack>
        )}
      </SectionCard>

      <Box sx={{ mt: 4 }}>
        <SectionCard title="Audit log" subtitle="Every ledger change, newest first" testId="logistics-history">
          {!ready && !state.error ? <LoadingBlock lines={4} /> : !history.length ? (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>{ready ? 'No edits recorded for this station yet.' : 'Not loaded.'}</Typography>
          ) : (
            <ScrollX label="Ledger audit log, scrollable">
              <Table size="small" aria-label="Ledger audit log" sx={{ minWidth: 560 }}>
                <TableHead>
                  <TableRow><TableCell sx={{ pl: 0 }}>When (IST)</TableCell><TableCell>Item</TableCell><TableCell>Field</TableCell><TableCell>Change</TableCell><TableCell sx={{ pr: 0 }}>By</TableCell></TableRow>
                </TableHead>
                <TableBody>
                  {history.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell sx={{ pl: 0, typography: 'mono', fontSize: 12, whiteSpace: 'nowrap' }}>{formatDateTimeIST(h.updatedAt).replace(' IST', '')}</TableCell>
                      <TableCell>{names[h.itemId] || h.itemId}</TableCell>
                      <TableCell>{h.field.replace(/_/g, ' ')}</TableCell>
                      <TableCell sx={{ fontFeatureSettings: '"tnum" 1' }}>{h.oldValue} → {h.newValue}</TableCell>
                      <TableCell sx={{ pr: 0 }}>{h.updatedBy} <SandboxTag show={h.sandbox} sx={{ ml: 1 }} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollX>
          )}
        </SectionCard>
      </Box>

      {editing && (
        <EditDialog item={editing} stationId={activeStation} onClose={() => setEditing(null)}
          onSaved={(msg) => { setEditing(null); toast({ text: msg }); reload(); }} />
      )}
    </Box>
  );
}
