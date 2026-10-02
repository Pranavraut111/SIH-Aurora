/* Aurora — the visual half of FeedbackProvider (Snackbar + confirm Dialog), loaded on
   first use so MUI's Modal/Snackbar stay out of the startup bundle. */
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Snackbar, Typography } from '@mui/material';

export default function FeedbackUI({ toast, toastOpen, onToastClose, onToastExited, ask, onAnswer }) {
  const sticky = toast && (toast.severity === 'error' || toast.severity === 'warning');
  return (
    <>
      <Snackbar
        key={toast?.id}
        open={Boolean(toast) && toastOpen}
        autoHideDuration={sticky ? null : 5000}
        onClose={(_, reason) => { if (reason !== 'clickaway') onToastClose(); }}
        slotProps={{ transition: { onExited: onToastExited } }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {toast ? (
          <Alert severity={toast.severity} variant="filled" onClose={onToastClose} data-testid="toast"
            role={sticky ? 'alert' : 'status'} sx={{ width: '100%', maxWidth: 560, boxShadow: 'none' }}>
            {toast.text}
          </Alert>
        ) : <span />}
      </Snackbar>
      <Dialog open={Boolean(ask)} onClose={() => onAnswer(false)} maxWidth="xs" fullWidth aria-labelledby="confirm-title"
        aria-describedby="confirm-body" slotProps={{ paper: { 'data-testid': 'confirm-dialog' } }}>
        {ask && (
          <>
            <DialogTitle id="confirm-title">{ask.title}</DialogTitle>
            <DialogContent>
              <Typography id="confirm-body" variant="body2" component="div" sx={{ color: 'text.secondary' }}>{ask.body}</Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => onAnswer(false)} autoFocus={Boolean(ask.danger)} data-testid="confirm-cancel">Cancel</Button>
              <Button variant="contained" color={ask.danger ? 'error' : 'primary'} onClick={() => onAnswer(true)}
                autoFocus={!ask.danger} data-testid="confirm-ok">{ask.confirmLabel || 'Confirm'}</Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </>
  );
}
