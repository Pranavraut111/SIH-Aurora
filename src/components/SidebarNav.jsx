/* ═══════════════════════════════════════════════════════════════
   Aurora — Collapsible Primary Sidebar Navigation
   Categorized mission control navigation.
   Groups: OVERVIEW, MONITORING, OPERATIONS, ANALYSIS & AI, ADMINISTRATION.
   ═══════════════════════════════════════════════════════════════ */
import { motion } from 'framer-motion';
import {
  LuLayoutDashboard,
  LuThermometerSnowflake,
  LuBuilding2,
  LuZap,
  LuPackage,
  LuRadioTower,
  LuSlidersHorizontal,
  LuSparkles,
  LuFileText,
  LuSettings,
  LuChevronLeft,
  LuChevronRight,
  LuActivity,
} from 'react-icons/lu';
import './SidebarNav.css';

export const NAV_SECTIONS = [
  {
    category: 'OVERVIEW',
    items: [
      { id: 'overview', label: 'Mission Overview', IconComp: LuLayoutDashboard, color: '#58a6ff' },
    ],
  },
  {
    category: 'MONITORING',
    items: [
      { id: 'environmental', label: 'Weather Observations', IconComp: LuThermometerSnowflake, color: '#38bdf8' },
      { id: 'infrastructure', label: 'Infrastructure', IconComp: LuBuilding2, color: '#a78bfa' },
      { id: 'energy', label: 'Energy Grid', IconComp: LuZap, color: '#fbbf24' },
    ],
  },
  {
    category: 'OPERATIONS',
    items: [
      { id: 'logistics', label: 'Logistics & Supply', IconComp: LuPackage, color: '#34d399' },
      { id: 'remote', label: 'Remote C&C', IconComp: LuRadioTower, color: '#38bdf8' },
    ],
  },
  {
    category: 'ANALYSIS & AI',
    items: [
      { id: 'simulation', label: 'What-If Sim', IconComp: LuSlidersHorizontal, color: '#c084fc' },
      { id: 'ai', label: 'AI Diagnostics', IconComp: LuSparkles, color: '#f472b6' },
      { id: 'reports', label: 'Station Reports', IconComp: LuFileText, color: '#60a5fa' },
    ],
  },
  {
    category: 'ADMINISTRATION',
    items: [
      { id: 'admin', label: 'System Admin', IconComp: LuSettings, color: '#94a3b8' },
    ],
  },
];

export default function SidebarNav({
  activeModule,
  onModuleChange,
  isCollapsed,
  onToggleCollapse,
  alertCount = 0,
}) {
  return (
    <aside className={`sidebar-nav ${isCollapsed ? 'collapsed' : 'expanded'}`}>
      {/* Sidebar Header / Toggle */}
      <div className="sidebar-header">
        {!isCollapsed && (
          <div className="sidebar-heading-text">
            <span className="sidebar-sub-label">MISSION NAVIGATION</span>
            <span className="sidebar-status-live">
              <span className="sidebar-live-dot" /> LIVE
            </span>
          </div>
        )}
        <button
          className="sidebar-collapse-btn"
          onClick={onToggleCollapse}
          title={isCollapsed ? 'Expand Sidebar Navigation' : 'Collapse Sidebar Navigation'}
        >
          {isCollapsed ? <LuChevronRight size={18} /> : <LuChevronLeft size={18} />}
        </button>
      </div>

      {/* Nav List */}
      <div className="sidebar-content">
        {NAV_SECTIONS.map((section) => (
          <div key={section.category} className="sidebar-group">
            {!isCollapsed && (
              <div className="sidebar-category-title">{section.category}</div>
            )}
            <div className="sidebar-group-items">
              {section.items.map((item) => {
                const isActive = activeModule === item.id;
                return (
                  <button
                    key={item.id}
                    className={`sidebar-item ${isActive ? 'active' : ''} ${isCollapsed ? 'item-collapsed' : ''}`}
                    onClick={() => onModuleChange(item.id)}
                    title={isCollapsed ? item.label : undefined}
                    style={isActive ? { '--active-color': item.color } : {}}
                  >
                    {isActive && (
                      <motion.div
                        className="sidebar-active-indicator"
                        layoutId="sidebarActivePill"
                        transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                      />
                    )}
                    <div
                      className="sidebar-item-icon"
                      style={{ color: isActive ? item.color : 'inherit' }}
                    >
                      <item.IconComp size={20} strokeWidth={isActive ? 2.2 : 1.7} />
                    </div>
                    {!isCollapsed && (
                      <span className="sidebar-item-label">{item.label}</span>
                    )}
                    {!isCollapsed && item.id === 'infrastructure' && alertCount > 0 && (
                      <span className="sidebar-item-badge">{alertCount}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Sidebar Footer */}
      {!isCollapsed && (
        <div className="sidebar-footer">
          <div className="sidebar-footer-card">
            <div className="sidebar-footer-row">
              <LuActivity size={14} className="sidebar-footer-icon" />
              <span className="sidebar-footer-title">Station Telemetry</span>
            </div>
            <p className="sidebar-footer-sub">Data source: see badge in top bar</p>
          </div>
        </div>
      )}
    </aside>
  );
}
