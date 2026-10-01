import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LuPackage,
  LuPencil,
  LuFuel,
  LuUtensils,
  LuBriefcaseMedical,
  LuWrench,
  LuDroplets,
  LuCheck,
  LuShieldCheck,
} from 'react-icons/lu';
import './LogisticsPanel.css';
import { apiGet, apiPost, describeApiError } from '../services/api';
import { stationMeta } from '../data/stationConfig';
import { getOperatorName, setOperatorName as persistOperatorName, OPERATOR_NAME_RE } from '../services/operator';

const CATEGORY_ICONS = {
  Energy: LuFuel,
  'Life Support': LuUtensils,
  Medical: LuBriefcaseMedical,
  Maintenance: LuWrench,
  Water: LuDroplets,
};

export default function LogisticsPanel({ activeStation = 'maitri' }) {
  const [items, setItems] = useState([]);
  const [editingItem, setEditingItem] = useState(null);
  const [formCurrent, setFormCurrent] = useState('');
  const [formDaily, setFormDaily] = useState('');
  const [operatorName, setOperatorName] = useState(getOperatorName);
  const [saveStatus, setSaveStatus] = useState(null);   // { ok, text }
  const [loadError, setLoadError] = useState(null);
  const [history, setHistory] = useState([]);

  const fetchInventory = async () => {
    try {
      const [d, h] = await Promise.all([
        apiGet(`/logistics?stationId=${activeStation}`),
        apiGet(`/logistics/history?stationId=${activeStation}&limit=10`),
      ]);
      setItems(d?.items || []);
      setHistory(h?.history || []);
      setLoadError(null);
    } catch (e) {
      console.error('Failed to fetch logistics:', e);
      setLoadError(describeApiError(e));
    }
  };

  useEffect(() => {
    fetchInventory();
  }, [activeStation]);

  const handleOpenEdit = (item) => {
    setEditingItem(item);
    setFormCurrent(item.current);
    setFormDaily(item.dailyUse);
  };

  const handleSaveItem = async (e) => {
    e.preventDefault();
    if (!editingItem) return;
    if (!OPERATOR_NAME_RE.test(operatorName.trim())) {
      setSaveStatus({ ok: false, text: 'Operator name: 2–60 letters, digits, spaces or . , \' ( ) _ -' });
      return;
    }

    try {
      await apiPost('/logistics/update', {
        stationId: activeStation,
        itemId: editingItem.id,
        current: Number(formCurrent),
        dailyConsumption: Number(formDaily),
        updatedBy: operatorName.trim(),
      });
      persistOperatorName(operatorName);
      setSaveStatus({ ok: true, text: `Saved ${editingItem.name} to the backend database (audited).` });
      setEditingItem(null);
      fetchInventory();
    } catch (err) {
      console.error('[Logistics] update failed', err);
      setSaveStatus({ ok: false, text: `Not saved: ${describeApiError(err)}` });
    } finally {
      setTimeout(() => setSaveStatus(null), 6000);
    }
  };

  return (
    <motion.div
      className="logistics-panel-container glass-panel"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 30 }}
      transition={{ type: 'spring', stiffness: 240, damping: 26 }}
    >
      {/* Header */}
      <div className="logistics-header">
        <div>
          <div className="logistics-title-row">
            <LuPackage size={22} className="logistics-title-icon" />
            <h2 className="logistics-title font-display">
              {stationMeta(activeStation).name} Station Logistics & Critical Supplies
            </h2>
          </div>
          <p className="logistics-subtitle text-caption">
            Operator-entered inventory ledger (no authentication; every edit is audited with the entered name).
          </p>
        </div>

        <div className="provenance-badge-operational">
          <LuShieldCheck size={14} /> OPERATOR-ENTERED (not telemetry)
        </div>
      </div>

      {saveStatus && (
        <motion.div
          className="save-success-banner"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
        >
          <LuCheck size={14} /> <span className={saveStatus.ok ? 'text-success' : 'text-danger'} data-testid="logistics-save-status">{saveStatus.text}</span>
        </motion.div>
      )}
      {loadError && <div className="save-success-banner text-danger" role="status">Inventory unavailable: {loadError}</div>}

      {/* Inventory Grid */}
      <div className="logistics-cards-grid">
        {items.map((item) => {
          const IconComp = CATEGORY_ICONS[item.category] || LuPackage;
          const pct = Math.min(100, Math.round((item.current / item.max) * 100));
          const isLow = item.isLow || pct < 30;

          return (
            <motion.div
              key={item.id}
              className={`logistics-card ${isLow ? 'low' : ''}`}
              whileHover={{ y: -2 }}
            >
              <div className="card-top-row">
                <div className="item-icon-box">
                  <IconComp size={18} />
                </div>
                <div className="item-title-col">
                  <span className="item-name font-display">{item.name}</span>
                  <span className="item-category text-caption">{item.category}</span>
                </div>
                <button
                  className="btn-edit-item"
                  onClick={() => handleOpenEdit(item)}
                  title="Update Stock Count"
                >
                  <LuPencil size={14} />
                </button>
              </div>

              {/* Numbers */}
              <div className="card-nums-row">
                <div className="num-col">
                  <span className="num-label">Current Stock</span>
                  <span className="num-val font-mono">
                    {item.current.toLocaleString()} <small>{item.unit}</small>
                  </span>
                </div>
                <div className="num-col right">
                  <span className="num-label">Autonomy</span>
                  <span className={`num-val font-mono ${item.daysRemaining < 45 ? 'urgent' : ''}`}>
                    {item.daysRemaining == null ? 'no consumption' : `${item.daysRemaining} days`}
                  </span>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="item-prog-track">
                <div
                  className={`item-prog-fill ${isLow ? 'low' : ''}`}
                  style={{ width: `${pct}%` }}
                />
              </div>

              {/* Footer */}
              <div className="card-footer-row">
                <span className="footer-burn text-caption">Burn: {item.dailyUse} {item.unit}/day</span>
                <span className="footer-updated text-caption">By: {item.updatedBy || '—'}</span>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Edit audit log (GET /api/logistics/history) */}
      <div className="logistics-history glass-panel-subtle" data-testid="logistics-history">
        <h3 className="section-heading font-display">Recent edits (audit log)</h3>
        {history.length === 0 ? (
          <p className="text-caption text-muted">No edits recorded for this station yet.</p>
        ) : (
          <table className="logistics-history-table font-mono">
            <thead><tr><th>When</th><th>Item</th><th>Field</th><th>Old → New</th><th>By</th></tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td>{new Date(h.updatedAt).toLocaleString()}</td>
                  <td>{h.itemId}</td>
                  <td>{h.field}</td>
                  <td>{h.oldValue} → {h.newValue}</td>
                  <td>{h.updatedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Edit Item Modal */}
      <AnimatePresence>
        {editingItem && (
          <div className="modal-backdrop" onClick={() => setEditingItem(null)}>
            <motion.div
              className="operator-entry-modal glass-panel"
              onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
            >
              <div className="modal-header">
                <h3>Update Logistics Stock &mdash; {editingItem.name}</h3>
                <button className="btn-close-modal" onClick={() => setEditingItem(null)}>✕</button>
              </div>

              <form onSubmit={handleSaveItem} className="operator-form">
                <div className="form-group">
                  <label>Current Quantity ({editingItem.unit}):</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    max={editingItem.max}
                    value={formCurrent}
                    onChange={(e) => setFormCurrent(e.target.value)}
                    className="form-input font-mono"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Daily Consumption Rate ({editingItem.unit}/day):</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={formDaily}
                    onChange={(e) => setFormDaily(e.target.value)}
                    className="form-input font-mono"
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="logistics-operator">Operator name (recorded in the audit log; not authenticated):</label>
                  <input
                    id="logistics-operator"
                    value={operatorName}
                    maxLength={60}
                    onChange={(e) => setOperatorName(e.target.value)}
                    className="form-input"
                    required
                  />
                </div>

                <div className="modal-actions">
                  <button type="button" className="btn-cancel" onClick={() => setEditingItem(null)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-save">
                    Save to Station Database
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
