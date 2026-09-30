/* ═══════════════════════════════════════════════════════════════
   Aurora v2 — Event Timeline
   Chronological log of station events:
   detection → analysis → action → outcome
   ═══════════════════════════════════════════════════════════════ */
import { motion, AnimatePresence } from 'framer-motion';
import {
  LuClock, LuTriangleAlert, LuCircleCheck, LuCloud, LuZap,
  LuBrain, LuRadio, LuChevronDown, LuChevronUp, LuX,
} from 'react-icons/lu';
import './EventTimeline.css';

const TYPE_CONFIG = {
  alert:         { icon: LuTriangleAlert, color: 'var(--status-warning)', label: 'Alert' },
  resolved:      { icon: LuCircleCheck,   color: 'var(--status-success)', label: 'Resolved' },
  pattern_start: { icon: LuCloud,         color: 'var(--module-environmental)', label: 'Weather' },
  pattern_end:   { icon: LuCloud,         color: 'var(--text-muted)',     label: 'Weather' },
  automation:    { icon: LuZap,           color: 'var(--accent)',         label: 'Auto' },
  decision:      { icon: LuBrain,         color: 'var(--accent-2)',       label: 'Decision' },
  connectivity:  { icon: LuRadio,         color: 'var(--module-infrastructure)', label: 'Comms' },
  injection:     { icon: LuZap,           color: 'var(--text-muted)',     label: 'Dev' },
};

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export default function EventTimeline({ events = [], onClose }) {
  const reversedEvents = [...events].reverse().slice(0, 50);

  return (
    <motion.div
      className="event-timeline glass-panel"
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 40 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    >
      <div className="et-header">
        <LuClock size={16} strokeWidth={1.5} className="et-header-icon" />
        <h3 className="et-title">Event Timeline</h3>
        <span className="et-count">{events.length}</span>
        {onClose && (
          <button className="et-close" onClick={onClose} aria-label="Close timeline">
            <LuX size={16} strokeWidth={1.5} />
          </button>
        )}
      </div>

      <div className="et-list">
        {reversedEvents.length === 0 && (
          <div className="et-empty">No events recorded yet</div>
        )}
        <AnimatePresence initial={false}>
          {reversedEvents.map((evt, i) => {
            const config = TYPE_CONFIG[evt.type] || TYPE_CONFIG.alert;
            const IconComp = config.icon;
            return (
              <motion.div
                key={evt.id}
                className={`et-item et-type-${evt.type}`}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ delay: i * 0.02 }}
              >
                <div className="et-item-dot" style={{ background: config.color }} />
                <div className="et-item-time font-mono">{formatTime(evt.timestamp)}</div>
                <div className="et-item-icon" style={{ color: config.color }}>
                  <IconComp size={14} strokeWidth={1.5} />
                </div>
                <div className="et-item-content">
                  <span className="et-item-message">{evt.message}</span>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
