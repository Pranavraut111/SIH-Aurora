/* ═══════════════════════════════════════════════════════════════
   Aurora — operator login (write access).
   The token is held in memory only, so a refresh logs you out; see
   src/services/adminToken.js for why. Viewing never needs a login.
   Signed out: a visible "Read-only" control that opens a dialog saying what
   signing in unlocks. Signed in: "Operator"; one click signs out.
   ═══════════════════════════════════════════════════════════════ */
import { lazy, Suspense, useState } from 'react';
import { Box, ButtonBase, Tooltip } from '@mui/material';
import LockOpenOutlined from '@mui/icons-material/LockOpenOutlined';
import LockOutlined from '@mui/icons-material/LockOutlined';
import { useAdminToken } from '../hooks/useAdminToken';

// The dialog (Modal, TextField, Alert) is only needed once someone signs in,
// so it stays out of the initial bundle.
const OperatorLoginDialog = lazy(() => import('./OperatorLoginDialog'));

const pillSx = {
  height: 28,
  px: 2,
  gap: 1.5,
  borderRadius: '4px',
  fontSize: 13,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  border: 1,
  '& .MuiSvgIcon-root': { fontSize: 16 },
};

export default function OperatorLogin() {
  const { loggedIn, writeProtected, login, logout } = useAdminToken();
  const [open, setOpen] = useState(false);
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
    } else {
      setError(res.error);
    }
  }

  if (loggedIn) {
    return (
      <Tooltip title="Signed in as operator: controls that change state are enabled. Click to sign out.">
        <ButtonBase
          onClick={logout}
          data-testid="operator-logout"
          aria-label="Operator: signed in. Sign out"
          sx={{ ...pillSx, color: 'primary.main', borderColor: 'primary.main' }}
        >
          <LockOpenOutlined />
          <span>Operator</span>
        </ButtonBase>
      </Tooltip>
    );
  }

  return (
    <>
      <Tooltip title="You can view everything. Sign in with the operator token to change thresholds, inventory, alerts or the simulator.">
        <ButtonBase
          onClick={() => setOpen(true)}
          data-testid="operator-login"
          aria-haspopup="dialog"
          aria-label="Read-only. Sign in as operator"
          sx={{ ...pillSx, color: 'text.secondary', borderColor: 'divider', '&:hover': { color: 'text.primary', borderColor: 'text.secondary' } }}
        >
          <LockOutlined />
          <span>Read-only</span>
          <Box component="span" sx={{ color: 'primary.main', display: { xs: 'none', sm: 'inline' } }}>Sign in</Box>
        </ButtonBase>
      </Tooltip>

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
