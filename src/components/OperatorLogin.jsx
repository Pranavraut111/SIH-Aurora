/* ═══════════════════════════════════════════════════════════════
   Aurora — operator login (write access).
   The token is held in memory only, so a refresh logs you out; see
   src/services/adminToken.js for why. Viewing never needs a login.
   ═══════════════════════════════════════════════════════════════ */
import { useEffect, useRef, useState } from 'react';
import { LuLock, LuLockOpen } from 'react-icons/lu';
import { useAdminToken } from '../hooks/useAdminToken';
import './OperatorLogin.css';

export default function OperatorLogin() {
  const { loggedIn, writeProtected, login, logout } = useAdminToken();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Nothing to log in to when the server does not protect writes (local development).
  if (writeProtected !== true) return null;

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
      <button
        type="button"
        className="status-pill operator-pill logged-in"
        onClick={logout}
        title="Signed in as operator — click to sign out. Writes are enabled."
        data-testid="operator-logout"
      >
        <LuLockOpen size={13} />
        <span className="pill-label font-mono">OPERATOR</span>
      </button>
    );
  }

  return (
    <div className="operator-login-wrap">
      <button
        type="button"
        className="status-pill operator-pill"
        onClick={() => setOpen((v) => !v)}
        title="Read-only. Sign in with the operator token to make changes."
        data-testid="operator-login"
      >
        <LuLock size={13} />
        <span className="pill-label font-mono">READ-ONLY</span>
      </button>

      {open && (
        <form className="operator-login-panel glass-panel" onSubmit={submit}>
          <label htmlFor="operator-token">Operator token</label>
          <input
            id="operator-token"
            ref={inputRef}
            type="password"
            autoComplete="off"
            spellCheck="false"
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(''); }}
            placeholder="X-Admin-Token"
            data-testid="operator-token-input"
          />
          <p className="operator-login-note">
            Kept in memory only — a page refresh signs you out. Viewing the dashboard
            never needs a token.
          </p>
          {error && <p className="operator-login-error" role="alert">{error}</p>}
          <div className="operator-login-actions">
            <button type="button" onClick={() => { setOpen(false); setError(''); }}>Cancel</button>
            <button type="submit" disabled={busy || !value.trim()} data-testid="operator-submit">
              {busy ? 'Checking…' : 'Sign in'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
