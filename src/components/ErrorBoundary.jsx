/* ═══════════════════════════════════════════════════════════════
   Aurora — ErrorBoundary
   Catches render errors in one panel so the rest of the app keeps
   working. Shows a friendly card with a retry button (re-mounts).
   ═══════════════════════════════════════════════════════════════ */
import { Component, Fragment } from 'react';
// Built from startup-bundle primitives only (Box, Typography, ButtonBase): this file is
// eager, and MUI Alert/Button would add ~12 kB to startup JS.
import { Box, ButtonBase, Typography } from '@mui/material';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, attempt: 0 };
    this.retry = this.retry.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(`[ErrorBoundary] ${this.props.name || 'panel'} crashed:`, error, info?.componentStack);
  }

  componentDidUpdate(prevProps) {
    // Navigating to another panel/station clears the error.
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.retry();
    }
  }

  retry() {
    this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));
  }

  render() {
    if (this.state.error) {
      return (
        <Box sx={{ p: 4 }}>
          {/* Palette paths, not theme.vars: an error card must render even without the theme. */}
          <Box role="alert" data-testid="error-boundary" sx={{
            p: 4, borderRadius: '10px', bgcolor: 'status.criticalTint', color: 'text.primary',
            display: 'flex', gap: 3, alignItems: 'flex-start', flexWrap: 'wrap',
          }}>
            <Box sx={{ flex: '1 1 260px', minWidth: 0 }}>
              <Typography component="h3" sx={{ fontWeight: 600, fontSize: 14 }}>{this.props.name || 'This panel'} hit an error</Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>The rest of Aurora keeps working. Details are in the browser console.</Typography>
              <Typography variant="caption" component="code" sx={{ typography: 'mono', display: 'block', mt: 1, wordBreak: 'break-word' }}>{String(this.state.error?.message || this.state.error)}</Typography>
            </Box>
            <ButtonBase onClick={this.retry} sx={{ px: 3, height: 32, borderRadius: '8px', fontWeight: 600, fontSize: 14, border: 1, borderColor: 'aurora.borderControl' }}>Retry</ButtonBase>
          </Box>
        </Box>
      );
    }
    // key forces a clean re-mount on retry
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
  }
}
