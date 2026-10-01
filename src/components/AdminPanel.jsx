import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  LuSettings,
  LuUsers,
  LuDatabase,
  LuSlidersHorizontal,
  LuRefreshCw,
  LuCheck,
  LuServer,
} from 'react-icons/lu';
import './AdminPanel.css';
import { apiGet, apiPost, describeApiError } from '../services/api';
import { getOperatorName, setOperatorName as persistOperatorName, OPERATOR_NAME_RE } from '../services/operator';
import { STATION_IDS, stationMeta, stationMetaDetailed } from '../data/stationConfig';


export default function AdminPanel({ activeStation = 'maitri' }) {
  const [config, setConfig] = useState(null);
  const [activeTab, setActiveTab] = useState('datasources'); // 'datasources' | 'users' | 'thresholds' | 'system'
  // Effective alert thresholds for the active station (station_config defaults + SQLite overrides).
  // edits: {sensor: {low|high: {warning|critical: string}}} — what the operator typed.
  const [edits, setEdits] = useState({});
  const [operatorName, setOperatorName] = useState(getOperatorName);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // { ok: boolean, text: string }
  const [loadError, setLoadError] = useState(null);
  const [ingesting, setIngesting] = useState(false);

  const fetchConfig = async () => {
    try {
      const d = await apiGet(`/admin/config?stationId=${activeStation}`);
      setConfig(d);
      setEdits({});
      setLoadError(null);
    } catch (e) {
      console.error('Admin config error:', e);
      setLoadError(describeApiError(e));
    }
  };

  useEffect(() => {
    fetchConfig();
  }, [activeStation]);

  const effective = config?.stationId === activeStation ? config.thresholds : null;
  const valueOf = (sensor, dir, level) => edits[sensor]?.[dir]?.[level] ?? String(effective?.[sensor]?.[dir]?.[level] ?? '');
  const setEdit = (sensor, dir, level, v) => setEdits((prev) => ({
    ...prev, [sensor]: { ...prev[sensor], [dir]: { ...prev[sensor]?.[dir], [level]: v } },
  }));
  const isOverridden = (sensor) => (config?.thresholdOverrides || []).some((o) => o.sensor === sensor && o.stationId === activeStation);

  const handleSaveThresholds = async (e) => {
    e.preventDefault();
    if (!effective) return;
    if (!OPERATOR_NAME_RE.test(operatorName.trim())) {
      setSaveStatus({ ok: false, text: 'Operator name: 2–60 letters, digits, spaces or . , \' ( ) _ -' });
      return;
    }
    // Only send values that actually changed.
    const changes = {};
    Object.entries(edits).forEach(([sensor, dirs]) => Object.entries(dirs).forEach(([dir, levels]) =>
      Object.entries(levels).forEach(([level, raw]) => {
        const num = Number(raw);
        if (raw === '' || Number.isNaN(num) || num === effective[sensor]?.[dir]?.[level]) return;
        changes[sensor] = { ...changes[sensor], [dir]: { ...changes[sensor]?.[dir], [level]: num } };
      })));
    if (!Object.keys(changes).length) {
      setSaveStatus({ ok: false, text: 'No changes to save.' });
      return;
    }
    setSaving(true);
    try {
      const res = await apiPost('/admin/config', { stationId: activeStation, thresholds: changes, updatedBy: operatorName.trim() });
      persistOperatorName(operatorName);
      setSaveStatus({ ok: true, text: `Saved ${res.valuesSaved} value(s) for ${activeStation}. The alert engine uses them from the next tick.` });
      fetchConfig();
    } catch (err) {
      console.error('[Admin] save thresholds failed', err);
      setSaveStatus({ ok: false, text: `Not saved: ${describeApiError(err)}` });
    } finally {
      setSaving(false);
      setTimeout(() => setSaveStatus(null), 8000);
    }
  };

  const handleReset = async (sensor) => {
    try {
      const res = await apiPost('/admin/config/reset', { stationId: activeStation, sensor, updatedBy: operatorName.trim() || getOperatorName() });
      setSaveStatus({ ok: true, text: `Reset ${sensor} to the station_config default (${res.removed} override value(s) removed).` });
      fetchConfig();
    } catch (err) {
      console.error('[Admin] reset failed', err);
      setSaveStatus({ ok: false, text: `Reset failed: ${describeApiError(err)}` });
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
          <form onSubmit={handleSaveThresholds} className="thresholds-form" data-testid="thresholds-form">
            {loadError && <p className="text-danger">{loadError} — thresholds cannot be loaded or saved.</p>}
            <p className="text-caption text-muted">
              Alert thresholds for <strong>{stationMeta(activeStation).fullName}</strong>, used by the backend alert engine
              (defaults from station_config.json; your changes are stored in SQLite as overrides for this station).
              An alert auto-resolves after {config?.alertResolveTicks ?? '—'} consecutive normal ticks.
            </p>
            <div className="threshold-row">
              <label htmlFor="admin-operator">Operator name (recorded with the change; not authenticated)</label>
              <input id="admin-operator" className="admin-input" maxLength={60} value={operatorName}
                onChange={(e) => setOperatorName(e.target.value)} />
            </div>
            {effective && (
              <table className="admin-table font-mono thresholds-table">
                <thead>
                  <tr><th>Sensor</th><th>Unit</th><th>Low warn</th><th>Low crit</th><th>High warn</th><th>High crit</th><th /></tr>
                </thead>
                <tbody>
                  {Object.entries(config.thresholdRules).map(([sensor, rule]) => (
                    <tr key={sensor} data-sensor={sensor}>
                      <td title={rule.basis}>{rule.name}<br /><small className="text-muted">{sensor} · {rule.building}</small></td>
                      <td>{rule.unit}<br /><small className="text-muted">{rule.min}–{rule.max}</small></td>
                      {['low', 'high'].flatMap((dir) => ['warning', 'critical'].map((level) => (
                        <td key={`${dir}-${level}`}>
                          {effective[sensor]?.[dir] ? (
                            <input
                              type="number"
                              step="any"
                              className="admin-input threshold-input"
                              aria-label={`${sensor} ${dir} ${level}`}
                              data-threshold={`${sensor}.${dir}.${level}`}
                              value={valueOf(sensor, dir, level)}
                              onChange={(e) => setEdit(sensor, dir, level, e.target.value)}
                            />
                          ) : <span className="text-muted">—</span>}
                        </td>
                      )))}
                      <td>
                        {isOverridden(sensor) && (
                          <button type="button" className="btn-sync-source" onClick={() => handleReset(sensor)}>Reset</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <button type="submit" className="btn-save-admin" disabled={!effective || saving}>
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
