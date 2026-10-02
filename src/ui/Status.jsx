/* ═══════════════════════════════════════════════════════════════
   Aurora — status primitives. The only components that use status colours.
   Status is never colour alone: a dot is always paired with a text label.
   ═══════════════════════════════════════════════════════════════ */
import { Chip } from '@mui/material';
import StatusDot from './StatusDot';
import { STATUS_LABEL } from './statusLabels';

export { StatusDot, STATUS_LABEL };


export function StatusChip({ status = 'normal', label, ...rest }) {
  return (
    <Chip
      size="small"
      label={label ?? STATUS_LABEL[status]}
      icon={<StatusDot status={status} size={6} sx={{ ml: '8px !important' }} />}
      data-status={status}
      sx={(theme) => ({
        color: theme.vars.palette.status[status],
        backgroundColor: theme.vars.palette.status[`${status}Tint`],
        '& .MuiChip-icon': { marginRight: '-2px' },
      })}
      {...rest}
    />
  );
}
