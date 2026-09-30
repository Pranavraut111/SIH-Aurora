import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LuRadioTower, LuZap, LuFlame, LuDroplets, LuSatellite,
  LuCircleCheck, LuOctagonAlert, LuClock, LuSend,
  LuShieldAlert, LuTerminal, LuRefreshCw
} from 'react-icons/lu';
import './RemoteControlPanel.css';
import { apiGet, apiPost } from '../services/api';

export default function RemoteControlPanel({ activeStation = 'maitri', sensorData, onAcknowledgeAlert }) {
  const [commands, setCommands] = useState([]);
  const [activeAlerts, setActiveAlerts] = useState([]);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchMsg, setDispatchMsg] = useState(null);

  // Subsystem states
  const [genset2State, setGenset2State] = useState('STANDBY'); // 'RUNNING' | 'STANDBY' | 'OFF'
  const [auxHeatingState, setAuxHeatingState] = useState(false);
  const [snowMeltState, setSnowMeltState] = useState(true);
  const [antennaGainState, setAntennaGainState] = useState('AUTO');

  const fetchState = async () => {
    try {
      const d1 = await apiGet(`/remote/commands?stationId=${activeStation}`);
      setCommands(d1?.commands || []);
      const d2 = await apiGet(`/alerts?stationId=${activeStation}`);
      setActiveAlerts(d2?.activeAlerts || []);
    } catch (e) {
      console.warn('C&C fetch error:', e);
    }
  };

  useEffect(() => {
    fetchState();
    const interval = setInterval(fetchState, 3000);
    return () => clearInterval(interval);
  }, [activeStation]);

  const handleDispatch = async (subsystem, command, params = {}) => {
    setDispatching(true);
    try {
      const d = await apiPost('/remote/dispatch', {
        stationId: activeStation,
        subsystem,
        command,
        parameters: params,
        issuedBy: 'Remote Mission Control Commander'
      });
      setDispatchMsg(`Command dispatched: ${command} (${d?.executionTimeMs}ms)`);
      fetchState();
    } catch (err) {
      console.error(err);
    } finally {
      setDispatching(false);
      setTimeout(() => setDispatchMsg(null), 4000);
    }
  };

  return (
    <motion.div
      className="remote-panel-container glass-panel"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 30 }}
      transition={{ type: 'spring', stiffness: 240, damping: 26 }}
    >
      {/* Header */}
      <div className="remote-header">
        <div>
          <div className="remote-title-row">
            <LuRadioTower size={22} className="remote-title-icon" />
            <h2 className="remote-title font-display">
              {activeStation === 'maitri' ? 'Maitri' : 'Bharati'} Remote Command & Control (C&C)
            </h2>
          </div>
          <p className="remote-subtitle text-caption">
            Tele-command dispatch pipeline, satellite latency monitor, and operational incident management.
          </p>
        </div>

        <div className="satellite-link-pill">
          <span className="sat-dot"></span>
          <span>Iridium SBD + VSAT Primary Link (420ms RTT)</span>
        </div>
      </div>

      {dispatchMsg && (
        <motion.div
          className="dispatch-success-banner"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
        >
          <LuCircleCheck size={14} /> {dispatchMsg}
        </motion.div>
      )}

      {/* Grid: Subsystem Controls Left, Incident & Command Queue Right */}
      <div className="remote-content-grid">
        {/* Subsystem Actuators */}
        <div className="actuators-column">
          <h3 className="section-heading font-display">Station Equipment Actuators</h3>

          {/* Genset 2 */}
          <div className="actuator-card glass-panel-subtle">
            <div className="actuator-header">
              <div className="actuator-icon-box" style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' }}>
                <LuZap size={18} />
              </div>
              <div className="actuator-meta">
                <span className="actuator-name font-display">Backup Genset #2</span>
                <span className="actuator-status text-caption">Status: <strong>{genset2State}</strong></span>
              </div>
            </div>
            <div className="actuator-buttons">
              <button
                className={`btn-actuator ${genset2State === 'RUNNING' ? 'active green' : ''}`}
                onClick={() => { setGenset2State('RUNNING'); handleDispatch('Power Grid', 'ENGAGE_BACKUP_GENSET_RUN'); }}
                disabled={dispatching}
              >
                Auto-Start & Synchronize
              </button>
              <button
                className={`btn-actuator ${genset2State === 'STANDBY' ? 'active yellow' : ''}`}
                onClick={() => { setGenset2State('STANDBY'); handleDispatch('Power Grid', 'SET_GENSET_STANDBY_HOT'); }}
                disabled={dispatching}
              >
                Hot-Standby
              </button>
            </div>
          </div>

          {/* Heating Zone B Booster */}
          <div className="actuator-card glass-panel-subtle">
            <div className="actuator-header">
              <div className="actuator-icon-box" style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' }}>
                <LuFlame size={18} />
              </div>
              <div className="actuator-meta">
                <span className="actuator-name font-display">Auxiliary Heating (Zone B)</span>
                <span className="actuator-status text-caption">State: <strong>{auxHeatingState ? 'ACTIVE (+28 kW)' : 'OFFLINE'}</strong></span>
              </div>
            </div>
            <div className="actuator-buttons">
              <button
                className={`btn-actuator ${auxHeatingState ? 'active red' : ''}`}
                onClick={() => {
                  const next = !auxHeatingState;
                  setAuxHeatingState(next);
                  handleDispatch('Thermal Grid', next ? 'ENABLE_ZONE_B_HEATING' : 'DISABLE_ZONE_B_HEATING');
                }}
                disabled={dispatching}
              >
                {auxHeatingState ? 'Disengage Aux Circuit' : 'Engage Aux Thermal Circuit'}
              </button>
            </div>
          </div>

          {/* Snow Melt Tracer */}
          <div className="actuator-card glass-panel-subtle">
            <div className="actuator-header">
              <div className="actuator-icon-box" style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8' }}>
                <LuDroplets size={18} />
              </div>
              <div className="actuator-meta">
                <span className="actuator-name font-display">Water Snow-Melt Heat Tracers</span>
                <span className="actuator-status text-caption">State: <strong>{snowMeltState ? 'ENERGIZED (Anti-Freeze)' : 'OFFLINE'}</strong></span>
              </div>
            </div>
            <div className="actuator-buttons">
              <button
                className={`btn-actuator ${snowMeltState ? 'active blue' : ''}`}
                onClick={() => {
                  const next = !snowMeltState;
                  setSnowMeltState(next);
                  handleDispatch('Water Treatment', next ? 'ENABLE_SNOWMELT_TRACER' : 'DISABLE_SNOWMELT_TRACER');
                }}
                disabled={dispatching}
              >
                {snowMeltState ? 'Tracer Heaters Online' : 'Energize Tracer Heaters'}
              </button>
            </div>
          </div>

          {/* Comms Dish Stow */}
          <div className="actuator-card glass-panel-subtle">
            <div className="actuator-header">
              <div className="actuator-icon-box" style={{ background: 'rgba(168, 85, 247, 0.15)', color: '#a855f7' }}>
                <LuSatellite size={18} />
              </div>
              <div className="actuator-meta">
                <span className="actuator-name font-display">High-Gain Satellite Radome</span>
                <span className="actuator-status text-caption">Mode: <strong>{antennaGainState}</strong></span>
              </div>
            </div>
            <div className="actuator-buttons">
              <button
                className={`btn-actuator ${antennaGainState === 'AUTO' ? 'active' : ''}`}
                onClick={() => { setAntennaGainState('AUTO'); handleDispatch('Comms Tower', 'SET_RADOME_TRACKING_AUTO'); }}
                disabled={dispatching}
              >
                Auto-Track
              </button>
              <button
                className={`btn-actuator ${antennaGainState === 'STOWED' ? 'active yellow' : ''}`}
                onClick={() => { setAntennaGainState('STOWED'); handleDispatch('Comms Tower', 'STOW_DISH_BLIZZARD_MODE'); }}
                disabled={dispatching}
              >
                Blizzard Stow Mode
              </button>
            </div>
          </div>
        </div>

        {/* Command Log & Active Alert Resolution */}
        <div className="logs-column">
          {/* Active Incidents */}
          <div className="incidents-box glass-panel-subtle">
            <h3 className="section-heading font-display">Active Telemetry Alerts ({activeAlerts.length})</h3>
            {activeAlerts.length === 0 ? (
              <div className="all-clear-message">
                <LuCircleCheck size={16} color="#10b981" />
                <span>All station systems reporting nominal parameters.</span>
              </div>
            ) : (
              <div className="alert-cards-scroll">
                {activeAlerts.map((alt) => (
                  <div key={alt.id} className={`incident-row ${alt.level}`}>
                    <div className="incident-row-top">
                      <span className={`badge badge-${alt.level}`}>{alt.level.toUpperCase()}</span>
                      <span className="incident-loc">{alt.buildingName}</span>
                      <button
                        className="btn-ack"
                        onClick={() => onAcknowledgeAlert?.(alt.buildingId)}
                      >
                        Acknowledge
                      </button>
                    </div>
                    <p className="incident-msg">{alt.message}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Dispatched Command Audit Trail */}
          <div className="command-trail-box glass-panel-subtle">
            <h3 className="section-heading font-display">
              <LuTerminal size={15} /> Remote Command Audit Log
            </h3>
            <div className="command-rows-scroll font-mono">
              {commands.length === 0 ? (
                <div className="text-muted" style={{ padding: '12px' }}>No remote commands dispatched in current session.</div>
              ) : (
                commands.map((cmd) => (
                  <div key={cmd.id} className="cmd-log-row">
                    <div className="cmd-log-top">
                      <span className="cmd-id">{cmd.id}</span>
                      <span className="cmd-sys">[{cmd.subsystem}]</span>
                      <span className="cmd-status badge badge-success">{cmd.status}</span>
                    </div>
                    <div className="cmd-name">{cmd.command}</div>
                    <div className="cmd-footer text-caption">
                      <span>{new Date(cmd.created_at).toLocaleTimeString()}</span>
                      <span>By: {cmd.issued_by}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
