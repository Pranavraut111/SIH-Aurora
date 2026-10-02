/* Aurora — the operator sign-in dialog, split out of OperatorLogin so its
   MUI Dialog/TextField code loads only when someone signs in. */
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material';

export default function OperatorLoginDialog({ open, value, error, busy, onChange, onClose, onSubmit }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth aria-labelledby="operator-login-title">
      <form onSubmit={onSubmit}>
        <DialogTitle id="operator-login-title">Sign in as operator</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 4 }}>
            Signing in enables the controls that change state: alert thresholds, the inventory ledger,
            alert acknowledgement, remote commands and the simulator. Viewing never needs a token.
          </Typography>
          <TextField
            autoFocus
            fullWidth
            size="small"
            type="password"
            label="Operator token"
            autoComplete="off"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            slotProps={{ htmlInput: { 'data-testid': 'operator-token-input', spellCheck: 'false' } }}
          />
          <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 2 }}>
            Kept in memory only. Refreshing the page signs you out.
          </Typography>
          {error && <Alert severity="error" role="alert" sx={{ mt: 3 }}>{error}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={busy || !value.trim()} data-testid="operator-submit">
            {busy ? 'Checking…' : 'Sign in'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
