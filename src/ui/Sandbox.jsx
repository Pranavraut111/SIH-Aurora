/* ═══════════════════════════════════════════════════════════════
   Aurora — visitor sandbox UI (judge mode, VISITOR_SANDBOX).
   SandboxNotice: shown above every panel with sandbox-able writes, says the
   changes are private and reset after 1 hour, and offers "Reset my sandbox".
   SandboxTag: marks a row the visitor changed privately (the API flags it
   `sandbox: true`). Neither renders outside judge mode or when signed in.
   ═══════════════════════════════════════════════════════════════ */
import { useState } from 'react';
import { Box, Button, Chip, Typography } from '@mui/material';
import ScienceOutlined from '@mui/icons-material/ScienceOutlined';
import { useAdminToken } from '../hooks/useAdminToken';
import { SANDBOX_CHANGED, apiPost } from '../services/api';
import { useConfirm, useToast } from './feedbackContext';

export function SandboxNotice({ children, sx }) {
  const { sandbox, judge } = useAdminToken();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  if (!sandbox) return null;
  const ttl = Math.round((judge.sandboxTtlS || 3600) / 60);

  async function reset() {
    const ok = await confirm({ title: 'Reset your sandbox?', body: 'Forgets every change you made here (thresholds, inventory, acknowledgements, commands). The shared station is not affected.', confirmLabel: 'Reset my sandbox' });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await apiPost('/sandbox/reset');
      window.dispatchEvent(new CustomEvent(SANDBOX_CHANGED));
      toast({ text: r.removed ? 'Your sandbox was reset: you now see the shared station.' : 'Your sandbox was already empty.' });
    } catch (err) {
      console.error('[sandbox] reset failed', err);
      toast({ severity: 'error', text: 'Could not reset your sandbox. Try again in a moment.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box role="note" data-testid="sandbox-notice"
      sx={[(t) => ({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2, px: 3, py: 2, mb: 4, borderRadius: '10px',
        bgcolor: t.vars.palette.aurora.accentTint, color: 'text.primary' }), ...(Array.isArray(sx) ? sx : [sx])]}>
      <ScienceOutlined fontSize="small" sx={{ color: 'primary.main' }} />
      <Typography variant="body2" sx={{ flex: 1, minWidth: 220 }}>
        <strong>Your sandbox:</strong> changes are private and reset after {ttl === 60 ? '1 hour' : `${ttl} minutes`}.
        {children ? <> {children}</> : null}
      </Typography>
      <Button size="small" variant="outlined" onClick={reset} disabled={busy} data-testid="sandbox-reset">Reset my sandbox</Button>
    </Box>
  );
}

export function SandboxTag({ show, sx, label = 'Your sandbox' }) {
  if (!show) return null;
  return (
    <Chip component="span" size="small" label={label} data-testid="sandbox-tag"
      sx={[(t) => ({ height: 20, fontSize: 11, fontWeight: 600, color: t.vars.palette.primary.main, bgcolor: t.vars.palette.aurora.accentTint }),
        ...(Array.isArray(sx) ? sx : [sx])]} />
  );
}
