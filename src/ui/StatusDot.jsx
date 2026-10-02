/* Aurora — status dot. Split from Status.jsx so the shell can show a dot without
   pulling MUI Chip into the startup bundle. Never colour alone: pair it with text. */
import { Box } from '@mui/material';

export default function StatusDot({ status = 'offline', size = 8, sx }) {
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
