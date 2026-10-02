/* ═══════════════════════════════════════════════════════════════
   Aurora — a button for a state-changing action. Disabled with the reason
   in a tooltip when write protection is on and no operator is signed in;
   the backend enforces the same rule (require_admin), this only says so.
   ═══════════════════════════════════════════════════════════════ */
import { Button, Tooltip } from '@mui/material';
import { useAdminToken } from '../hooks/useAdminToken';

export default function WriteButton({ disabled, tooltip, children, ...rest }) {
  const { canWrite, writeBlockedTitle } = useAdminToken();
  const blocked = !canWrite;
  const button = <Button disabled={disabled || blocked} data-write-blocked={blocked || undefined} {...rest}>{children}</Button>;
  const title = blocked ? `${writeBlockedTitle}: sign in to use this.` : tooltip;
  // A disabled button gets no pointer events, so the tooltip wraps a span.
  return title ? <Tooltip title={title}><span style={{ display: 'inline-flex' }}>{button}</span></Tooltip> : button;
}
