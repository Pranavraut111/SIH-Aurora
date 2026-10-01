/* ═══════════════════════════════════════════════════════════════
   Aurora — navigation registry: the ONE list of modules, their sidebar
   section, label, icon and page-header copy. The sidebar, page header,
   (later) command palette and product tour all read from here.

   `migrated: true` marks modules already rebuilt on the new design system;
   the rest render their legacy panel inside <LegacySurface> until Phase 2.
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
    label: 'Overview', section: 'monitor', Icon: DashboardOutlined,
    title: 'Station overview', description: '3D digital twin of the station with live subsystem status.',
  },
  environmental: {
    label: 'Weather', section: 'monitor', Icon: ThermostatOutlined,
    title: 'Weather observations', description: 'Surface weather from the AWS feed and ERA5 reanalysis, with anomaly and forecast tools.',
  },
  infrastructure: {
    label: 'Infrastructure', section: 'monitor', Icon: ApartmentOutlined,
    title: 'Infrastructure', description: 'Building telemetry and the dependency graph between subsystems.',
  },
  energy: {
    label: 'Energy grid', section: 'monitor', Icon: BoltOutlined, migrated: true,
    title: 'Energy grid', description: 'Diesel generation, fuel burn and the electrical and heating load it supplies.',
  },
  logistics: {
    label: 'Logistics', section: 'operate', Icon: Inventory2Outlined,
    title: 'Logistics and supplies', description: 'Operator-entered inventory ledger and supply autonomy.',
  },
  remote: {
    label: 'Remote commands', section: 'operate', Icon: SettingsRemoteOutlined,
    title: 'Remote commands', description: 'Simulated command dispatch and its audit log. Nothing reaches real equipment.',
  },
  simulation: {
    label: 'What-if scenarios', section: 'analyse', Icon: TuneOutlined,
    title: 'What-if scenarios', description: 'Run hypothetical hazards through the physics model.',
  },
  ai: {
    label: 'AI diagnostics', section: 'analyse', Icon: InsightsOutlined,
    title: 'AI diagnostics', description: 'Physics-residual anomaly detection, decisions and forecasts.',
  },
  reports: {
    label: 'Reports', section: 'analyse', Icon: DescriptionOutlined,
    title: 'Station reports', description: 'Status report with print, CSV and JSON export.',
  },
  admin: {
    label: 'Administration', section: 'system', Icon: SettingsOutlined,
    title: 'Administration', description: 'Data sources, alert thresholds and station configuration.',
  },
};

/** Sidebar actions that open a tool instead of switching module. */
export const NAV_ACTIONS = {
  twinInspector: { label: 'Twin inspector', section: 'analyse', Icon: AccountTreeOutlined },
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
