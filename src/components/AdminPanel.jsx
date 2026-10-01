import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  LuSettings, LuUsers, LuDatabase, LuSlidersHorizontal,
  LuRefreshCw, LuMapPin, LuCheck, LuServer
} from 'react-icons/lu';
import './AdminPanel.css';
import { apiGet, apiPost } from '../services/api';
import { STATION_IDS, stationMeta, stationMetaDetailed } from '../data/stationConfig';


export default function AdminPanel({ activeStation = 'maitri' }) {
  const [config, setConfig] = useState(null);
  const [activeTab, setActiveTab] = useState('datasources'); // 'datasources' | 'users' | 'thresholds' | 'system'
  // Thresholds come from the backend (SQLite admin_thresholds); no client defaults.
  const [thresholds, setThresholds] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // { ok: boolean, text: string }
  const [loadError, setLoadError] = useState(null);
  const [ingesting, setIngesting] = useState(false);

  const fetchConfig = async () => {
    try {
      const d = await apiGet('/admin/config');
      setConfig(d);
      setThresholds(d?.thresholds ? { ...d.thresholds } : null);
      setLoadError(null);
    } catch (e) {
      console.error('Admin config error:', e);
      setLoadError(e?.kind === 'http' ? `Backend error (HTTP ${e.status})` : 'Backend unreachable');
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const handleSaveThresholds = async (e) => {
    e.preventDefault();
    if (!thresholds) return;
    setSaving(true);
    try {
      const res = await apiPost('/admin/config', { thresholds, updatedBy: 'admin-panel' });
      setThresholds({ ...res.thresholds });
      setSaveStatus({ ok: true, text: `Saved to the backend database at ${new Date(res.updatedAt).toLocaleTimeString()}. Note: alert rules do not use these values yet.` });
      fetchConfig();
    } catch (err) {
      console.error('[Admin] save thresholds failed', err);
      const detail = err?.status === 422 && Array.isArray(err.body?.detail)
        ? err.body.detail.map((d) => (typeof d === 'string' ? d : d.msg)).join('; ')
        : err?.kind === 'http' ? `HTTP ${err.status}` : 'backend unreachable';
      setSaveStatus({ ok: false, text: `Not saved: ${detail}` });
    } finally {
      setSaving(false);
      setTimeout(() => setSaveStatus(null), 8000);
    }
  };

  const handleTriggerIngest = async (stationId) => {
    setIngesting(true);
    try {
      const res = await apiPost(`/ncpor/ingest?stationId=${stationId}`);
      const r = res?.results?.[stationId];
      setSaveStatus(r?.status === 'success'
        ? { ok: true, text: `Ingested ${r.records_ingested} NCPOR AWS records for ${stationId.toUpperCase()}.` }
        : { ok: false, text: `NCPOR ingest failed for ${stationId.toUpperCase()}: ${r?.error || 'no result'}. 0 records.` });
    } catch (e) {
      console.error('[Admin] ingest failed', e);
      setSaveStatus({ ok: false, text: e?.kind === 'http' ? `Ingest failed: HTTP ${e.status}` : 'Ingest failed: backend unreachable' });
    } finally {
      setIngesting(false);
      setTimeout(() => setSaveStatus(null), 8000);
    }
  };

  const THRESHOLD_LABELS = {
    generator_temp_warning: 'Generator coolant temperature — warning',
    generator_temp_critical: 'Generator coolant temperature — critical',
    wind_speed_warning_ms: 'Wind speed — warning',
    wind_speed_critical_ms: 'Wind speed — critical',
    fuel_reorder_days: 'Fuel reorder warning (days of supply)',
  };

  return (
    <motion.div
      className="admin-panel-container glass-panel"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 30 }}
      transition={{ type: 'spring', stiffness: 240, damping: 26 }}
    >
      {/* Header */}
      <div className="admin-header">
        <div>
          <div className="admin-title-row">
            <LuSettings size={22} className="admin-title-icon" />
            <h2 className="admin-title font-display">System Administration & Ingestion Pipeline</h2>
          </div>
          <p className="admin-subtitle text-caption">
            Manage data sources, threshold engines, role-based access, and platform telemetry integrity.
          </p>
        </div>
      </div>

      {saveStatus && (
        <motion.div
          className="admin-save-banner"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
        >
          <LuCheck size={14} /> <span className={saveStatus.ok ? 'text-success' : 'text-danger'} data-testid="admin-save-status">{saveStatus.text}</span>
        </motion.div>
      )}

      {/* Tabs */}
      <div className="admin-tabs">
        <button
          className={`admin-tab ${activeTab === 'datasources' ? 'active' : ''}`}
          onClick={() => setActiveTab('datasources')}
        >
          <LuDatabase size={15} /> Data Sources & Ingestion
        </button>
        <button
          className={`admin-tab ${activeTab === 'thresholds' ? 'active' : ''}`}
          onClick={() => setActiveTab('thresholds')}
        >
          <LuSlidersHorizontal size={15} /> Alert Threshold Rules
        </button>
        <button
          className={`admin-tab ${activeTab === 'users' ? 'active' : ''}`}
          onClick={() => setActiveTab('users')}
        >
          <LuUsers size={15} /> Users & Roles
        </button>
        <button
          className={`admin-tab ${activeTab === 'system' ? 'active' : ''}`}
          onClick={() => setActiveTab('system')}
        >
          <LuServer size={15} /> Station Configuration
        </button>
      </div>

      {/* Tab Content */}
      <div className="admin-tab-body">
        {activeTab === 'datasources' && (
          <div className="datasources-view">
            <div className="source-card glass-panel-subtle">
              <div className="source-meta">
                <div className="source-badge">Primary</div>
                <h4 className="source-name font-display">NCPOR Live Meteorological Portal</h4>
                <p className="source-url font-mono text-caption">https://data.ncpor.res.in/ (Maitri & Bharati AWS)</p>
                <p className="source-desc text-caption">
                  Hourly live observations of ambient air temperature, wind speed, atmospheric pressure, and relative humidity.
                </p>
              </div>
              <div className="source-actions">
                <button
                  className="btn-sync-source"
                  onClick={() => handleTriggerIngest('maitri')}
                  disabled={ingesting}
                >
                  <LuRefreshCw size={13} className={ingesting ? 'spin-icon' : ''} /> Sync Maitri
                </button>
                <button
                  className="btn-sync-source"
                  onClick={() => handleTriggerIngest('bharati')}
                  disabled={ingesting}
                >
                  <LuRefreshCw size={13} className={ingesting ? 'spin-icon' : ''} /> Sync Bharati
                </button>
              </div>
            </div>

            <div className="source-card glass-panel-subtle">
              <div className="source-meta">
                <div className="source-badge blue">Archive</div>
                <h4 className="source-name font-display">National Polar Data Center (NPDC) Observations</h4>
                <p className="source-url font-mono text-caption">https://npdc.ncpor.res.in (Surface & AWS Datasets)</p>
                <p className="source-desc text-caption">
                  Multi-decadal polar climate records, Gangotri/Maitri surface datasets, and DCWIS Bharati archives.
                </p>
              </div>
              <div className="source-status font-mono">
                Not integrated (no NPDC ingest implemented)
              </div>
            </div>
          </div>
        )}

        {activeTab === 'thresholds' && (
          <form onSubmit={handleSaveThresholds} className="thresholds-form">
            {loadError && <p className="text-danger">{loadError} — thresholds cannot be loaded or saved.</p>}
            {thresholds && Object.keys(THRESHOLD_LABELS).map((key) => {
              const rule = config?.thresholdRules?.[key];
              const meta = config?.thresholdsMeta?.[key];
              return (
                <div className="threshold-row" key={key}>
                  <label htmlFor={`th-${key}`}>
                    {THRESHOLD_LABELS[key]} ({rule?.unit}) <small className="text-muted">allowed {rule?.min}–{rule?.max}{meta ? ` · last set by ${meta.updatedBy}` : ''}</small>
                  </label>
                  <input
                    id={`th-${key}`}
                    type="number"
                    step="0.5"
                    value={thresholds[key] ?? ''}
                    onChange={(e) => setThresholds((t) => ({ ...t, [key]: e.target.value === '' ? null : Number(e.target.value) }))}
                    className="admin-input font-mono"
                  />
                </div>
              );
            })}
            <p className="text-caption text-muted">Stored in the backend database and validated (range, warning &lt; critical). Alert rules don't use them yet.</p>
            <button type="submit" className="btn-save-admin" disabled={!thresholds || saving}>
              {saving ? 'Saving…' : 'Save Alert Thresholds'}
            </button>
          </form>
        )}

        {activeTab === 'users' && (
          <div className="users-table-container">
            <p className="text-caption text-muted">{config?.usersProvenance || 'HARDCODED-DEMO'}</p>
            <table className="admin-table font-mono">
              <thead>
                <tr>
                  <th>User Identity</th>
                  <th>Designated Role</th>
                  <th>Station Jurisdiction</th>
                  <th>Permission Level</th>
                </tr>
              </thead>
              <tbody>
                {config?.users?.map((u) => (
                  <tr key={u.id}>
                    <td><strong>{u.name}</strong></td>
                    <td>{u.role}</td>
                    <td>{u.station}</td>
                    <td><span className="badge badge-success">{u.access}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'system' && (
          <div className="system-config-view">
            <p className="text-caption text-muted">
              From simulator/station_config.json (also served at /api/config/stations). Each value shows its source and confidence;
              values marked “confirm” still need NCPOR confirmation. Physics model parameters are separate (see Twin Inspector).
            </p>
            {STATION_IDS.map((sid) => (
              <div key={sid} className="sys-config-card glass-panel-subtle" data-testid={`station-meta-${sid}`}>
                <h4>{stationMeta(sid).fullName}</h4>
                <table className="admin-table font-mono">
                  <tbody>
                    {Object.entries(stationMetaDetailed(sid))
                      .filter(([, v]) => v && typeof v === 'object' && 'value' in v)
                      .map(([key, v]) => (
                        <tr key={key}>
                          <td>{key}</td>
                          <td><strong>{v.value ?? 'not established'}</strong></td>
                          <td>{v.confidence}{v.needsNcporConfirmation ? ' · confirm' : ''}</td>
                          <td className="text-muted">{v.source}{v.note ? ` — ${v.note}` : ''}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
