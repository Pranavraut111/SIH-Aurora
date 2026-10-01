/* ═══════════════════════════════════════════════════════════════
   Aurora — ErrorBoundary
   Catches render errors in one panel so the rest of the app keeps
   working. Shows a friendly card with a retry button (re-mounts).
   ═══════════════════════════════════════════════════════════════ */
import { Component, Fragment } from 'react';
import './ErrorBoundary.css';

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
        <div className="error-boundary-card" role="alert" data-testid="error-boundary">
          <h3>{this.props.name || 'This panel'} hit an error</h3>
          <p>The rest of Aurora keeps working. Details are in the browser console.</p>
          <code>{String(this.state.error?.message || this.state.error)}</code>
          <button type="button" onClick={this.retry}>Retry</button>
        </div>
      );
    }
    // key forces a clean re-mount on retry
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
  }
}
