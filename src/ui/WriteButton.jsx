/* ═══════════════════════════════════════════════════════════════
   Aurora — a button for a state-changing action. Disabled with the reason
   in a tooltip when write protection is on and no operator is signed in;
   the backend enforces the same rule, this only says so.
   In judge mode (VISITOR_SANDBOX) visitors may use it: their change goes to
   their private sandbox. `team` marks actions that change the shared station
   (simulator mode, link toggle), which always need the team sign-in.
   ═══════════════════════════════════════════════════════════════ */
import { Button, Tooltip } from '@mui/material';
import { useAdminToken } from '../hooks/useAdminToken';

export default function WriteButton({ disabled, tooltip, team = false, children, ...rest }) {
  const { canWrite, canWriteShared, sandbox, writeBlockedTitle, sharedBlockedTitle } = useAdminToken();
  const blocked = team ? !canWriteShared : !canWrite;
  const button = <Button disabled={disabled || blocked} data-write-blocked={blocked || undefined} data-sandbox={(!team && sandbox) || undefined} {...rest}>{children}</Button>;
  const title = blocked ? `${team ? sharedBlockedTitle : writeBlockedTitle} (⋮ menu → Team sign-in).`
    : (!team && sandbox ? (tooltip ? `${tooltip} Saved to your private sandbox.` : 'Saved to your private sandbox: only you see it, for 1 hour.') : tooltip);
  // A disabled button gets no pointer events, so the tooltip wraps a span.
  return title ? <Tooltip title={title}><span style={{ display: 'inline-flex' }}>{button}</span></Tooltip> : button;
}
