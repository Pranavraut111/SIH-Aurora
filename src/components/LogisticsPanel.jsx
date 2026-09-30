import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LuPackage, LuPlus, LuPencil, LuTriangleAlert,
  LuFuel, LuUtensils, LuBriefcaseMedical, LuWrench, LuDroplets,
  LuCheck, LuShieldCheck, LuSparkles
} from 'react-icons/lu';
import './LogisticsPanel.css';

const API_URL = 'http://localhost:8080/api';

const CATEGORY_ICONS = {
  Energy: LuFuel,
  'Life Support': LuUtensils,
  Medical: LuBriefcaseMedical,
  Maintenance: LuWrench,
  Water: LuDroplets,
};

export default function LogisticsPanel({ activeStation = 'maitri', sensorData }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [formCurrent, setFormCurrent] = useState('');
  const [formDaily, setFormDaily] = useState('');
  const [operatorName, setOperatorName] = useState('Station Commander');
  const [saveStatus, setSaveStatus] = useState(null);

  const fetchInventory = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/logistics?stationId=${activeStation}`);
      if (res.ok) {
        const d = await res.json();
        setItems(d.items || []);
      }
    } catch (e) {
      console.warn('Failed to fetch logistics:', e);
    } finally {
      setLoading(false);
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

    try {
      const res = await fetch(`${API_URL}/logistics/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stationId: activeStation,
          itemId: editingItem.id,
          current: Number(formCurrent),
          dailyConsumption: Number(formDaily),
          updatedBy: operatorName
        })
      });

      if (res.ok) {
        setSaveStatus(`Updated ${editingItem.name} successfully.`);
        setEditingItem(null);
        fetchInventory();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setTimeout(() => setSaveStatus(null), 4000);
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
              {activeStation === 'maitri' ? 'Maitri' : 'Bharati'} Station Logistics & Critical Supplies
            </h2>
          </div>
          <p className="logistics-subtitle text-caption">
            Polar inventory monitoring, autonomy calculations, and authenticated operator entry.
          </p>
        </div>

        <div className="provenance-badge-operational">
          <LuShieldCheck size={14} /> Operator-Managed Station Telemetry
        </div>
      </div>

      {saveStatus && (
        <motion.div
          className="save-success-banner"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
        >
          <LuCheck size={14} /> {saveStatus}
        </motion.div>
      )}

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
                    {item.daysRemaining > 900 ? '∞' : `${item.daysRemaining} days`}
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
                <span className="footer-updated text-caption">By: {item.updatedBy || 'Commander'}</span>
              </div>
            </motion.div>
          );
        })}
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
                    value={formDaily}
                    onChange={(e) => setFormDaily(e.target.value)}
                    className="form-input font-mono"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Logging Operator Identity:</label>
                  <select
                    value={operatorName}
                    onChange={(e) => setOperatorName(e.target.value)}
                    className="form-input"
                  >
                    <option value="Station Commander">Station Commander</option>
                    <option value="Lead Logistics Officer">Lead Logistics Officer</option>
                    <option value="Chief Medical Officer">Chief Medical Officer</option>
                    <option value="Principal Electrical Engineer">Principal Electrical Engineer</option>
                  </select>
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
