/* ═══════════════════════════════════════════════════════════════
   Aurora — sidebar: modules grouped into Monitor / Operate / Analyse /
   System; the active item is a soft accent-tinted pill with an accent icon.
   The foot holds the station mini-card (map locator, solar time + IST, polar
   day/night). Collapsible to icons on desktop (labels move into hints, the
   mini-card hides); a temporary drawer below the md breakpoint.
   ═══════════════════════════════════════════════════════════════ */
import { lazy, Suspense } from 'react';
import { Box, Divider, IconButton, List, ListItem, ListItemButton, ListItemIcon, ListItemText, ListSubheader } from '@mui/material';
import KeyboardDoubleArrowLeft from '@mui/icons-material/KeyboardDoubleArrowLeft';
import KeyboardDoubleArrowRight from '@mui/icons-material/KeyboardDoubleArrowRight';
import { layout } from '../theme/tokens';
import Hint from '../ui/Hint';
import { MODULES, NAV_ACTIONS, NAV_SECTIONS } from './navigation';

// The phone drawer (Modal + Slide) loads only on small screens.
const MobileNavDrawer = lazy(() => import('./MobileNavDrawer'));
// Not needed for first paint; loads right after it.
const StationMiniCard = lazy(() => import('./StationMiniCard'));

function NavItem({ id, label, Icon, selected, collapsed, onClick }) {
  const button = (
    <ListItemButton
      selected={selected}
      onClick={onClick}
      aria-current={selected ? 'page' : undefined}
      aria-label={collapsed ? label : undefined}
      className={`sidebar-item${selected ? ' active' : ''}`}
      data-testid={`nav-${id}`}
      sx={{ mx: 3, px: collapsed ? 0 : 3, justifyContent: collapsed ? 'center' : 'flex-start' }}
    >
      <ListItemIcon sx={{ minWidth: collapsed ? 0 : 32, justifyContent: 'center' }}>
        <Icon fontSize="small" />
      </ListItemIcon>
      {!collapsed && <ListItemText primary={label} />}
    </ListItemButton>
  );
  return (
    <ListItem disablePadding sx={{ display: 'block' }}>
      {collapsed ? <Hint title={label} placement="right" sx={{ display: 'flex' }}>{button}</Hint> : button}
    </ListItem>
  );
}

export function NavContent({ activeModule, onSelect, onAction, collapsed, onToggleCollapse, showCollapse, activeStation, onStationChange }) {
  return (
    <Box component="nav" aria-label="Modules" sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', pb: 2 }}>
        {NAV_SECTIONS.map((section, i) => (
          <List
            key={section.id}
            dense
            data-tour={`nav-${section.id}`}
            aria-label={section.label}
            subheader={collapsed
              ? (i > 0 ? <Divider component="li" aria-hidden="true" sx={{ mx: 3, my: 2 }} /> : <Box component="li" aria-hidden="true" sx={{ height: 12 }} />)
              : <ListSubheader sx={{ px: 6 }}>{section.label}</ListSubheader>}
            sx={{ py: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}
          >
            {section.items.map((item) => {
              if (item.startsWith('action:')) {
                const key = item.slice(7);
                const a = NAV_ACTIONS[key];
                return (
                  <NavItem key={item} id={key} label={a.label} Icon={a.Icon} collapsed={collapsed}
                    onClick={() => onAction(key)} />
                );
              }
              const m = MODULES[item];
              return (
                <NavItem key={item} id={item} label={m.label} Icon={m.Icon} collapsed={collapsed}
                  selected={activeModule === item} onClick={() => onSelect(item)} />
              );
            })}
          </List>
        ))}
      </Box>
      {!collapsed && activeStation && (
        <Suspense fallback={null}>
          <StationMiniCard activeStation={activeStation} onStationChange={onStationChange} />
        </Suspense>
      )}
      {showCollapse && (
        <Box sx={{ px: 3, pb: 3, display: 'flex', justifyContent: collapsed ? 'center' : 'flex-end' }}>
          <Hint title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} placement="right">
            <IconButton size="small" onClick={onToggleCollapse} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
              {collapsed ? <KeyboardDoubleArrowRight fontSize="small" /> : <KeyboardDoubleArrowLeft fontSize="small" />}
            </IconButton>
          </Hint>
        </Box>
      )}
    </Box>
  );
}

export default function SideNav({ isDesktop, mobileOpen, onMobileClose, collapsed, ...rest }) {
  if (!isDesktop) {
    return (
      <Suspense fallback={null}>
        <MobileNavDrawer open={mobileOpen} onClose={onMobileClose} {...rest} />
      </Suspense>
    );
  }
  const width = collapsed ? layout.navWidthCollapsed : layout.navWidth;
  return (
    <Box
      component="aside"
      className="sidebar-nav"
      sx={(theme) => ({
        width,
        flex: 'none',
        borderRight: `1px solid ${theme.vars.palette.aurora.borderSubtle}`,
        backgroundColor: theme.vars.palette.background.paper,
        transition: theme.transitions.create('width', { duration: theme.transitions.duration.short }),
        overflow: 'hidden',
      })}
    >
      <NavContent {...rest} collapsed={collapsed} showCollapse />
    </Box>
  );
}
