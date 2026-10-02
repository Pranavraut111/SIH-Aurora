/* Aurora — the keyboard shortcuts help ("?"). Loaded on first open. */
import { Dialog, DialogContent, DialogTitle, IconButton, Stack, Table, TableBody, TableCell, TableRow, Typography } from '@mui/material';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import Keys from '../ui/Keys';
import { MODULES, NAV_ACTIONS } from './navigation';

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

export default function ShortcutsDialog({ open, onClose }) {
  const rows = [
    [[MOD, 'K'], 'Command palette'],
    [['?'], 'This help'],
    [['Esc'], 'Close a dialog, drawer or menu'],
    ...Object.values(MODULES).map((m) => [['g', m.key], `Go to ${m.label}`]),
    [['g', NAV_ACTIONS.twinInspector.key], 'Open the Twin inspector'],
  ];
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth aria-labelledby="shortcuts-title" slotProps={{ paper: { 'data-testid': 'shortcuts-dialog' } }}>
      <DialogTitle id="shortcuts-title" sx={{ display: 'flex', alignItems: 'center' }}>
        <Stack sx={{ flex: 1 }}>Keyboard shortcuts</Stack>
        <IconButton onClick={onClose} aria-label="Close keyboard shortcuts"><CloseOutlined /></IconButton>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>Shortcuts are off while you type in a field. For “g” sequences, press g, then the letter.</Typography>
        <Table size="small" aria-label="Keyboard shortcuts">
          <TableBody>
            {rows.map(([keys, what]) => (
              <TableRow key={what}><TableCell sx={{ pl: 0, width: 110 }}><Keys keys={keys} /><span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{keys.join(' then ')}</span></TableCell><TableCell sx={{ pr: 0 }}>{what}</TableCell></TableRow>
            ))}
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}
