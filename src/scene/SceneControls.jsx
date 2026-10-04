/* ═══════════════════════════════════════════════════════════════
   Aurora 3D — the scene's DOM controls (the canvas itself is aria-hidden):
     · Station / Antarctica view toggle (also the A key)
     · "Buildings": every subsystem as a button, with its physical zone and
       its alert level as text, so selection never needs the canvas
     · "Schematic layout — positions approximate" and "About this view"
     · Normal / X-ray / Systems / Heat map inspection modes (keys X, H)
     · a polite live region with the station and alert summary
   ═══════════════════════════════════════════════════════════════ */
import { useEffect, useId, useRef, useState } from 'react';
import { Box, Button, ButtonBase, Paper, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import StatusDot from '../ui/StatusDot';
import ViewInArOutlined from '@mui/icons-material/ViewInArOutlined';
import LayersOutlined from '@mui/icons-material/LayersOutlined';
import HubOutlined from '@mui/icons-material/HubOutlined';
import ThermostatOutlined from '@mui/icons-material/ThermostatOutlined';
import { STATUS_LABEL } from '../ui/statusLabels';

const srOnly = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' };

const panelSx = (t) => ({
  bgcolor: t.vars.palette.background.paper, border: `1px solid ${t.vars.palette.divider}`, borderRadius: '10px',
  boxShadow: t.vars.palette.aurora?.shadowFloat, color: 'text.primary',
});

const SCENE_MODE_OPTIONS = [
  { id: 'normal', label: 'Normal', Icon: ViewInArOutlined, hint: 'Normal view' },
  { id: 'xray', label: 'X-ray', Icon: LayersOutlined, hint: 'See inside: ghosted shells, blueprint edges, subsystem cores (X)' },
  { id: 'systems', label: 'Systems', Icon: HubOutlined, hint: 'Dependency flows between subsystems' },
  { id: 'heatmap', label: 'Heat map', Icon: ThermostatOutlined, hint: 'Threshold proximity and model residuals (H)' },
];

export default function SceneControls({
  view, onViewChange, antarcticaEnabled, zones, selectedBuilding, onSelectBuilding,
  summary, environment, stationName, aboutLines, pins = [], onPinSelect, flying,
  sceneMode = 'normal', onSceneModeChange,
}) {
  const [open, setOpen] = useState(null);   // 'buildings' | 'about' | null
  const listId = useId(); const aboutId = useId();
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(null); e.stopPropagation(); } };
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(null); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('pointerdown', onDown); };
  }, [open]);

  return (
    <Box ref={rootRef} data-tour="scene-controls" sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2 }}>
      <Box sx={{ position: 'absolute', top: 12, left: 12, display: 'flex', gap: 1.5, alignItems: 'flex-start', flexWrap: 'wrap', pointerEvents: 'auto', maxWidth: 'calc(100% - 24px)' }}>
        {antarcticaEnabled && (
          <ToggleButtonGroup exclusive size="small" value={view} aria-label="3D view" data-testid="scene-view-toggle"
            onChange={(_, v) => { if (v && v !== view) onViewChange(v); }}
            sx={(t) => ({ ...panelSx(t), '& .MuiToggleButton-root': { border: 0, px: 2.5, height: 32 } })}>
            <ToggleButton value="station" data-testid="scene-view-station">Station</ToggleButton>
            <ToggleButton value="antarctica" data-testid="scene-view-antarctica">Antarctica</ToggleButton>
          </ToggleButtonGroup>
        )}
        {view === 'station' && (
          <Box sx={{ position: 'relative' }}>
            <Button size="small" variant="outlined" aria-expanded={open === 'buildings'} aria-controls={listId}
              data-testid="scene-buildings-button" onClick={() => setOpen(open === 'buildings' ? null : 'buildings')}
              sx={(t) => ({ ...panelSx(t), height: 32, px: 2.5, textTransform: 'none', fontWeight: 600 })}>
              Buildings
            </Button>
            {open === 'buildings' && (
              <Paper id={listId} role="region" aria-label={`${stationName} buildings`} data-testid="scene-buildings-list"
                sx={(t) => ({ ...panelSx(t), position: 'absolute', top: 40, left: 0, width: 'min(340px, calc(100vw - 48px))', maxHeight: 'min(420px, 60vh)', overflowY: 'auto', p: 1 })}>
                <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                  {zones.map((z) => (
                    <li key={z.id}>
                      <ButtonBase data-testid={`scene-building-${z.id}`} data-status={z.level} aria-pressed={selectedBuilding === z.id}
                        onClick={() => { onSelectBuilding(z.id); setOpen(null); }}
                        sx={(t) => ({
                          width: '100%', textAlign: 'left', display: 'flex', alignItems: 'flex-start', gap: 2, px: 2, py: 1.5, borderRadius: '6px',
                          '&:hover, &.Mui-focusVisible': { bgcolor: t.vars.palette.aurora.surfaceRaised },
                          outline: selectedBuilding === z.id ? `2px solid ${t.vars.palette.primary.main}` : 'none',
                        })}>
                        <Box sx={{ pt: 0.5 }}><StatusDot status={z.level} /></Box>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{z.name}</Typography>
                          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{z.physical}</Typography>
                        </Box>
                        <Typography sx={(t) => ({ fontSize: 12, fontWeight: 600, color: z.level === 'normal' ? t.vars.palette.text.secondary : t.vars.palette.status[z.level] })}>
                          {STATUS_LABEL[z.level]}
                        </Typography>
                      </ButtonBase>
                    </li>
                  ))}
                </Box>
              </Paper>
            )}
          </Box>
        )}
        {view === 'station' && onSceneModeChange && (
          <ToggleButtonGroup exclusive size="small" value={sceneMode} aria-label="Inspection mode" data-testid="scene-mode-toggle"
            onChange={(_, v) => { if (v && v !== sceneMode) onSceneModeChange(v); }}
            sx={(t) => ({
              ...panelSx(t), '& .MuiToggleButton-root': { border: 0, px: 2, height: 32, textTransform: 'none', fontWeight: 600, fontSize: 13, gap: 0.75 },
              '& .MuiToggleButton-root.Mui-selected': { color: '#7FDBFF', bgcolor: 'rgba(127,219,255,0.12)' },
            })}>
            {SCENE_MODE_OPTIONS.map((m) => (
              <ToggleButton key={m.id} value={m.id} data-testid={`scene-mode-${m.id}`} title={m.hint}>
                <m.Icon sx={{ fontSize: 16 }} />{m.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        )}
      </Box>

      <Box className="scene-note" sx={{ position: 'absolute', top: 12, right: 12, pointerEvents: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1, maxWidth: 'calc(100% - 24px)' }}>
        <Box sx={(t) => ({ ...panelSx(t), display: 'flex', alignItems: 'center', gap: 1.5, pl: 2.5, pr: 1, height: 32, fontSize: 12, color: 'text.secondary' })}>
          <span data-testid="scene-schematic-note">{view === 'station' ? 'Schematic layout — positions approximate' : 'Outline: Natural Earth 1:110m'}</span>
          <Button size="small" aria-expanded={open === 'about'} aria-controls={aboutId} data-testid="scene-about-button"
            onClick={() => setOpen(open === 'about' ? null : 'about')} sx={{ minWidth: 0, height: 26, px: 1.5, textTransform: 'none', fontSize: 12 }}>
            About this view
          </Button>
        </Box>
        {open === 'about' && (
          <Paper id={aboutId} role="region" aria-label="About this view" data-testid="scene-about"
            sx={(t) => ({ ...panelSx(t), width: 'min(380px, calc(100vw - 48px))', p: 3, fontSize: 13, color: 'text.secondary' })}>
            {aboutLines.map((l) => <Typography key={l} sx={{ fontSize: 13, color: 'text.secondary', mb: 1.25, '&:last-child': { mb: 0 } }}>{l}</Typography>)}
          </Paper>
        )}
      </Box>

      {view === 'antarctica' && !flying && pins.map((p) => p.pos && (
        <ButtonBase key={p.id} data-testid={`scene-pin-${p.id}`} aria-pressed={p.selected}
          aria-label={p.selected ? `${p.name}, selected station: show the station` : `Fly to ${p.name}`}
          onClick={() => onPinSelect(p.id)}
          sx={(t) => ({
            ...panelSx(t), position: 'absolute', left: 0, top: 0, pointerEvents: 'auto',
            // Above the pin head; flipped below it when that would leave the scene's top edge.
            transform: `translate(${Math.round(p.pos[0])}px, ${Math.round(p.pos[1])}px) translate(-50%, ${p.pos[1] < 96 ? '14px' : 'calc(-100% - 6px)'})`,
            px: 2, py: 1, gap: 1.5, display: 'flex', alignItems: 'baseline', whiteSpace: 'nowrap',
            borderColor: p.selected ? t.vars.palette.primary.main : t.vars.palette.divider,
            '&:hover, &.Mui-focusVisible': { bgcolor: t.vars.palette.aurora.surfaceRaised },
          })}>
          <Typography component="span" sx={{ fontSize: 13, fontWeight: 600 }}>{p.name}</Typography>
          <Typography component="span" sx={{ display: { xs: 'none', sm: 'inline' }, fontSize: 12, color: 'text.secondary', fontFamily: '"IBM Plex Mono", monospace' }}>{p.coords}</Typography>
        </ButtonBase>
      ))}

      <Box sx={srOnly} aria-live="polite" data-testid="scene-live-summary">{summary}</Box>
      <Box sx={srOnly} data-testid="scene-environment">{environment}</Box>
    </Box>
  );
}
