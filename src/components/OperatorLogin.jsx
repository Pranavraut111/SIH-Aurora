/* ═══════════════════════════════════════════════════════════════
   Aurora — operator login (write access).
   The token is held in memory only, so a refresh logs you out; see
   src/services/adminToken.js for why. Viewing never needs a login.
   Signed out: a filled "Sign in" button, always visible in the top bar at every
   width (with a quiet "Read-only" label beside it on wide screens), opening a
   dialog that says what signing in unlocks. Signed in: "Operator"; one click
   signs out. With write protection off (local dev) there is nothing to sign in to.
   The dialog can be opened from outside (the command palette) through
   dialogOpen / onDialogOpenChange; otherwise it keeps its own state.
   ═══════════════════════════════════════════════════════════════ */
import { lazy, Suspense, useState } from 'react';
import { Box, ButtonBase } from '@mui/material';
import LockOpenOutlined from '@mui/icons-material/LockOpenOutlined';
import LockOutlined from '@mui/icons-material/LockOutlined';
import { useAdminToken } from '../hooks/useAdminToken';
import Hint from '../ui/Hint';
import { useToast } from '../ui/feedbackContext';

// The dialog (Modal, TextField, Alert) is only needed once someone signs in,
// so it stays out of the initial bundle.
const OperatorLoginDialog = lazy(() => import('./OperatorLoginDialog'));

const buttonSx = (theme) => ({
  height: 32,
  px: { xs: 2.5, sm: 3 },
  gap: 1.5,
  borderRadius: '8px',
  fontSize: 13,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  flex: 'none',
  transition: theme.transitions.create(['background-color', 'color', 'border-color'], { duration: theme.transitions.duration.shortest }),
  '& .MuiSvgIcon-root': { fontSize: 16 },
});
const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' };

export default function OperatorLogin({ dialogOpen, onDialogOpenChange }) {
  const { loggedIn, writeProtected, login, logout } = useAdminToken();
  const toast = useToast();
  const [ownOpen, setOwnOpen] = useState(false);
  const open = (dialogOpen ?? ownOpen) && !loggedIn;
  const setOpen = onDialogOpenChange ?? setOwnOpen;
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Nothing to log in to when the server does not protect writes (local development).
  if (writeProtected !== true) return null;

  function close() {
    setOpen(false);
    setError('');
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const res = await login(value);
    setBusy(false);
    if (res.ok) {
      setValue('');
      setOpen(false);
      toast({ text: 'Signed in as operator. Controls that change state are enabled; each asks before it acts.' });
    } else {
      setError(res.error);
    }
  }

  if (loggedIn) {
    return (
      <Hint title="Signed in as operator: controls that change state are enabled. Click to sign out.">
        <ButtonBase
          onClick={() => { logout(); toast({ severity: 'info', text: 'Signed out. Aurora is read-only again.' }); }}
          data-testid="operator-logout"
          aria-label="Operator: signed in. Sign out"
          sx={(theme) => ({
            ...buttonSx(theme),
            color: 'primary.main',
            bgcolor: 'aurora.accentTint',
            '&:hover': { color: 'text.primary' },
          })}
        >
          <LockOpenOutlined />
          <span>Operator</span>
        </ButtonBase>
      </Hint>
    );
  }

  return (
    <>
      <Box component="span" aria-hidden="true" sx={{ alignSelf: 'center', mr: 2, fontSize: 13, color: 'text.secondary', whiteSpace: 'nowrap', display: { xs: 'none', lg: 'inline' } }}>
        Read-only
      </Box>
      <Hint title="You can view everything. Sign in with the operator token to change thresholds, inventory, alerts or the simulator.">
        <ButtonBase
          onClick={() => setOpen(true)}
          data-testid="operator-login"
          aria-haspopup="dialog"
          aria-label="Read-only. Sign in as operator"
          sx={(theme) => ({
            ...buttonSx(theme),
            color: 'primary.contrastText',
            bgcolor: 'primary.main',
            '&:hover': { bgcolor: 'primary.dark' },
          })}
        >
          <Box component="span" sx={visuallyHidden}>Read-only. </Box>
          <LockOutlined />
          <span>Sign in</span>
        </ButtonBase>
      </Hint>

      {open && (
        <Suspense fallback={null}>
          <OperatorLoginDialog
            open={open}
            value={value}
            error={error}
            busy={busy}
            onChange={(v) => { setValue(v); setError(''); }}
            onClose={close}
            onSubmit={submit}
          />
        </Suspense>
      )}
    </>
  );
}
