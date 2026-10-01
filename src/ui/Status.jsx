/* ═══════════════════════════════════════════════════════════════
   Aurora — status primitives. The only components that use status colours.
   Status is never colour alone: a dot is always paired with a text label.
   ═══════════════════════════════════════════════════════════════ */
import { Box, Chip } from '@mui/material';

export const STATUS_LABEL = {
  normal: 'Normal', warning: 'Warning', critical: 'Critical', offline: 'Offline', simulated: 'Simulated',
};

export function StatusDot({ status = 'offline', size = 8, sx }) {
  return (
    <Box
      component="span"
      aria-hidden="true"
      sx={[(theme) => ({
        display: 'inline-block',
        flex: 'none',
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: theme.vars.palette.status[status] ?? theme.vars.palette.status.offline,
      }), ...(Array.isArray(sx) ? sx : [sx])]}
    />
  );
}

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
