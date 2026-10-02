/* Aurora — keyboard key caps for shortcut hints (decorative; pair with text). */
import { Box, Stack } from '@mui/material';

export default function Keys({ keys }) {
  return (
    <Stack direction="row" sx={{ gap: 0.5 }} aria-hidden="true">
      {keys.map((k) => (
        <Box key={k} component="kbd" sx={{ px: 1.25, minWidth: 20, textAlign: 'center', borderRadius: '4px', border: 1, borderColor: 'divider', fontSize: 12, lineHeight: '20px', fontFamily: 'inherit', color: 'text.secondary' }}>{k}</Box>
      ))}
    </Stack>
  );
}
