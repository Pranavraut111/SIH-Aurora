/* ═══════════════════════════════════════════════════════════════
   Aurora — global status strip under the app bar: where the data comes
   from, the telemetry link, active alerts, the event log, operator access
   and freshness. Always visible, the same on every page.
   ═══════════════════════════════════════════════════════════════ */
import { Box, ButtonBase, Divider, Tooltip, Typography } from '@mui/material';
import HistoryOutlined from '@mui/icons-material/HistoryOutlined';
import NotificationsOutlined from '@mui/icons-material/NotificationsOutlined';
import SensorsOutlined from '@mui/icons-material/SensorsOutlined';
import { useNow } from '../hooks/useNow';
import { formatRelative, formatTimeIST } from '../lib/format';
import { layout } from '../theme/tokens';
import { StatusDot } from '../ui/Status';
import OperatorLogin from '../components/OperatorLogin';
import { dataSourceInfo } from './dataSource';

function StripItem({ children, tooltip, onClick, ...rest }) {
  const content = (
    <ButtonBase
      component={onClick ? 'button' : 'div'}
      onClick={onClick}
      disabled={!onClick}
      sx={(theme) => ({
        height: 28,
        px: 2,
        gap: 1.5,
        borderRadius: '4px',
        flex: 'none',
        color: theme.vars.palette.text.secondary,
        fontSize: 13,
        fontWeight: 500,
        whiteSpace: 'nowrap',
        '&.Mui-disabled': { color: theme.vars.palette.text.secondary },
        '&:hover': onClick ? { backgroundColor: theme.vars.palette.action.hover, color: theme.vars.palette.text.primary } : {},
        '& .MuiSvgIcon-root': { fontSize: 16 },
      })}
      {...rest}
    >
      {children}
    </ButtonBase>
  );
  return tooltip ? <Tooltip title={tooltip}>{content}</Tooltip> : content;
}

export default function StatusStrip({
  telemetryBadge,
  isConnected,
  alertCount,
  criticalCount,
  updatedAt,
  onOpenLink,
  onOpenAlerts,
  onToggleTimeline,
}) {
  const now = useNow(1000);
  const source = dataSourceInfo(telemetryBadge);
  const warningCount = alertCount - criticalCount;
  const alertStatus = criticalCount > 0 ? 'critical' : alertCount > 0 ? 'warning' : 'normal';
  const alertLabel = alertCount === 0
    ? 'No alerts'
    : [criticalCount && `${criticalCount} critical`, warningCount && `${warningCount} warning`].filter(Boolean).join(' · ');

  return (
    <Box
      role="region"
      aria-label="Station status"
      data-tour="status-strip"
      sx={(theme) => ({
        height: layout.statusStripHeight,
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: { xs: 2, md: 4 },
        borderBottom: `1px solid ${theme.vars.palette.divider}`,
        backgroundColor: theme.vars.palette.background.default,
        overflowX: 'auto',
        scrollbarWidth: 'none',
      })}
    >
      <StripItem
        tooltip={source.help}
        data-testid="data-source-badge"
        data-source={telemetryBadge}
        aria-label={`Data source: ${source.label}`}
      >
        <StatusDot status={source.status} />
        <span>{source.label}</span>
      </StripItem>

      <StripItem
        onClick={onOpenLink}
        tooltip="Telemetry link details"
        aria-label={`Telemetry link: ${isConnected ? 'up' : 'cut (simulated)'}`}
        className="status-pill connection"
      >
        <SensorsOutlined />
        <Box component="span" sx={{ display: { xs: isConnected ? 'none' : 'inline', sm: 'inline' } }}>{isConnected ? 'Link up' : 'Link cut (simulated)'}</Box>
      </StripItem>

      <StripItem
        onClick={onOpenAlerts}
        tooltip="Open the alert centre"
        data-testid="alerts-pill"
        data-alert-count={alertCount}
        data-tour="alert-centre"
        aria-label={`Alerts: ${alertLabel}`}
      >
        <NotificationsOutlined />
        {alertCount > 0 && <StatusDot status={alertStatus} />}
        <Box component="span" sx={(theme) => ({ color: alertCount > 0 ? theme.vars.palette.status[alertStatus] : 'inherit', fontWeight: alertCount > 0 ? 600 : 500 })}>
          {alertLabel}
        </Box>
      </StripItem>

      <StripItem onClick={onToggleTimeline} tooltip="Station event log" aria-label="Open the event log">
        <HistoryOutlined />
        <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>Events</Box>
      </StripItem>

      <Divider orientation="vertical" flexItem sx={{ my: 2, mx: 1, display: { xs: 'none', sm: 'block' } }} />
      <Box data-tour="operator-login" sx={{ flex: 'none' }}><OperatorLogin /></Box>

      <Box sx={{ flex: 1, minWidth: 8 }} />
      {updatedAt != null && (
        <Typography variant="body2" sx={{ color: 'text.secondary', whiteSpace: 'nowrap', flex: 'none', display: { xs: 'none', sm: 'block' } }}>
          Telemetry <Box component="span" sx={{ typography: 'mono', color: 'text.primary' }}>{formatTimeIST(updatedAt)}</Box> · {formatRelative(updatedAt, now)}
        </Typography>
      )}
    </Box>
  );
}
