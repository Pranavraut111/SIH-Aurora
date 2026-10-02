/* ═══════════════════════════════════════════════════════════════
   Aurora — navigation registry: the ONE list of modules, their sidebar
   section, label, icon and page-header copy. The sidebar, page header,
   (later) command palette and product tour all read from here.

   `key` is the letter of the "g then letter" shortcut (shell/shortcuts.js).
   ═══════════════════════════════════════════════════════════════ */
import AccountTreeOutlined from '@mui/icons-material/AccountTreeOutlined';
import ApartmentOutlined from '@mui/icons-material/ApartmentOutlined';
import BoltOutlined from '@mui/icons-material/BoltOutlined';
import DashboardOutlined from '@mui/icons-material/DashboardOutlined';
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined';
import InsightsOutlined from '@mui/icons-material/InsightsOutlined';
import Inventory2Outlined from '@mui/icons-material/Inventory2Outlined';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import SettingsRemoteOutlined from '@mui/icons-material/SettingsRemoteOutlined';
import ThermostatOutlined from '@mui/icons-material/ThermostatOutlined';
import TuneOutlined from '@mui/icons-material/TuneOutlined';

export const MODULES = {
  overview: {
    label: 'Overview', key: 'o', section: 'monitor', Icon: DashboardOutlined,
    title: 'Station overview', description: '3D digital twin of the station with live subsystem status.',
  },
  environmental: {
    label: 'Weather', key: 'w', section: 'monitor', Icon: ThermostatOutlined,
    title: 'Weather', description: 'Live surface weather, stored AWS and ERA5 observations, and anomaly, forecast and risk tools.',
  },
  infrastructure: {
    label: 'Infrastructure', key: 'i', section: 'monitor', Icon: ApartmentOutlined,
    title: 'Infrastructure', description: 'Building telemetry and the dependency graph between subsystems.',
  },
  energy: {
    label: 'Energy grid', key: 'e', section: 'monitor', Icon: BoltOutlined,
    title: 'Energy grid', description: 'Diesel generation, fuel burn and the electrical and heating load it supplies.',
  },
  logistics: {
    label: 'Logistics', key: 'l', section: 'operate', Icon: Inventory2Outlined,
    title: 'Logistics and supplies', description: 'Operator-entered inventory ledger and supply autonomy.',
  },
  remote: {
    label: 'Remote commands', key: 'r', section: 'operate', Icon: SettingsRemoteOutlined,
    title: 'Remote commands', description: 'Simulated command dispatch and its audit log. Nothing reaches real equipment.',
  },
  simulation: {
    label: 'What-if scenarios', key: 's', section: 'analyse', Icon: TuneOutlined,
    title: 'What-if scenarios', description: 'Rule-based what-if: hypothetical hazards applied to the current snapshot.',
  },
  ai: {
    label: 'AI diagnostics', key: 'a', section: 'analyse', Icon: InsightsOutlined,
    title: 'AI diagnostics', description: 'Physics-residual anomaly detection, decisions and forecasts.',
  },
  reports: {
    label: 'Reports', key: 'p', section: 'analyse', Icon: DescriptionOutlined,
    title: 'Station reports', description: 'Status report with print, CSV and JSON export.',
  },
  admin: {
    label: 'Administration', key: 'd', section: 'system', Icon: SettingsOutlined,
    title: 'Administration', description: 'Data sources, alert thresholds and station configuration.',
  },
};

/** Sidebar actions that open a tool instead of switching module. */
export const NAV_ACTIONS = {
  twinInspector: { label: 'Twin inspector', key: 't', section: 'analyse', Icon: AccountTreeOutlined },
};

export const NAV_SECTIONS = [
  { id: 'monitor', label: 'Monitor', items: ['overview', 'environmental', 'infrastructure', 'energy'] },
  { id: 'operate', label: 'Operate', items: ['logistics', 'remote'] },
  { id: 'analyse', label: 'Analyse', items: ['simulation', 'ai', 'reports', 'action:twinInspector'] },
  { id: 'system', label: 'System', items: ['admin'] },
];

export function sectionLabel(sectionId) {
  return NAV_SECTIONS.find((s) => s.id === sectionId)?.label ?? '';
}
