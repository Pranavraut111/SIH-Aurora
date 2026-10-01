/* ═══════════════════════════════════════════════════════════════
   Aurora — Overview HUD (Command Center Heads-Up Display)
   Expansive, high-contrast polar mission control overlay.
   Large Station Information Card + Prominent Twin Inspector (Bottom-Left).
   Substantially Sized 2x2 Telemetry Cards (Bottom-Right).
   ═══════════════════════════════════════════════════════════════ */
import { motion } from 'framer-motion';
import { useState } from 'react';
import { STATIONS } from '../data/stationData';
import {
  LuMapPin,
  LuCloudOff,
  LuThermometerSnowflake,
  LuWind,
  LuZap,
  LuShieldCheck,
  LuShieldAlert,
  LuSparkles,
  LuUsers,
  LuMountain,
  LuCalendar,
  LuMic,
} from 'react-icons/lu';
import './OverviewHUD.css';
import { apiPost } from '../services/api';

export default function OverviewHUD({
  sensorData,
  alerts = {},
  activeStation,
  isConnected = true,
  onOpenTwinInspector,
}) {
  const station = STATIONS[activeStation] || STATIONS.maitri;
  const envData = sensorData?.lab || {};
  const genData = sensorData?.generator || {};

  // Live telemetry only — missing values render as "—" (no hardcoded stand-ins).
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const temp = num(envData.env_temp);
  const wind = num(envData.env_wind);
  const power = num(genData.gen_power);
  
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  // We need a ref to hold the recognition instance so we can stop/start it
  const [recognition, setRecognition] = useState(null);

  const speak = (text) => {
    return new Promise((resolve) => {
      setIsSpeaking(true);
      window.speechSynthesis.cancel();
      // Clean up markdown
      const cleanText = text.replace(/[*#_]/g, '').replace(/\[.*\]/g, '');
      const utterance = new SpeechSynthesisUtterance(cleanText);
      const voices = window.speechSynthesis.getVoices();
      const preferredVoice = voices.find(v => v.name.includes('Daniel') || v.name.includes('UK English Male') || v.name.includes('Google UK English Male')) 
        || voices.find(v => v.lang === 'en-GB' || v.lang === 'en-US');
      if (preferredVoice) utterance.voice = preferredVoice;
      
      utterance.rate = 1.1; // slightly brisk, still clear
      utterance.pitch = 0.9;
      
      utterance.onend = () => {
        setIsSpeaking(false);
        resolve();
      };
      utterance.onerror = () => {
        setIsSpeaking(false);
        resolve();
      };
      window.speechSynthesis.speak(utterance);
    });
  };

  const processQuery = async (queryText) => {
    // If it's just a greeting
    if (queryText.toLowerCase().trim() === 'hello aurora' || queryText.toLowerCase().trim() === 'aurora') {
      await speak("Yes, Commander. I am online and monitoring all station telemetry. How can I assist?");
      return;
    }
    
    // Send only the user's question; the backend grounds the answer in the
    // current decision JSON (Groq LLM, or an offline summary without one).
    try {
      const d = await apiPost('/aurora-explain', { station: activeStation, freeText: queryText, question: 'free' }, { timeoutMs: 25000 });
      const ans = d?.explanation || 'No answer returned.';
      await speak(d?.llmAvailable === false ? `Offline summary. ${ans}` : ans);
    } catch (e) {
      console.error('[Voice] aurora-explain failed', e);
      await speak(e?.kind === 'http'
        ? `The backend returned an error, status ${e.status}.`
        : 'The backend is unreachable.');
    }
  };

  const toggleVoiceMode = () => {
    if (isVoiceMode) {
      // Turn OFF
      if (recognition) {
        recognition.onend = null;
        recognition.stop();
      }
      window.speechSynthesis.cancel();
      setIsVoiceMode(false);
      setIsSpeaking(false);
    } else {
      // Turn ON
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        alert("Your browser doesn't support Web Speech API.");
        return;
      }
      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = false;
      
      rec.onresult = async (event) => {
        // Only process the latest final result
        const last = event.results.length - 1;
        if (event.results[last].isFinal) {
          const transcript = event.results[last][0].transcript.trim();
          console.log("[Voice] heard:", transcript);
          
          // Conversational mode: while the voice assistant is on, every utterance is processed.
          // Pause recognition while speaking so it doesn't hear itself
          rec.stop();
          await processQuery(transcript);
          
          // Restart listening after speaking if the voice assistant is still on
          // Note: state might be stale here, but rec.onend will handle restart
        }
      };
      
      rec.onerror = (e) => console.warn('[Voice] microphone error:', e.error);
      
      rec.onend = () => {
        // If mode is still true, restart listening (continuous mode often stops on silence)
        // We use a small timeout to avoid thrashing
        setTimeout(() => {
          if (document.querySelector('.btn-hud-voice.listening') && !document.querySelector('.btn-hud-voice .pulse-icon.speaking')) {
            try { rec.start(); } catch (e) { console.warn('[Voice] could not restart recognition', e); }
          }
        }, 300);
      };
      
      setRecognition(rec);
      rec.start();
      setIsVoiceMode(true);
      speak("Voice assistant on. Say 'Hello Aurora' or ask your question directly.");
    }
  };

  // Count alerts
  const alertValues = Object.values(alerts);
  const criticalCount = alertValues.filter((a) => a === 'critical').length;
  const warningCount = alertValues.filter((a) => a === 'warning').length;
  const normalCount = alertValues.filter((a) => a === 'normal').length;
  const totalSystems = Math.max(Object.keys(alerts).length, 6);

  const stats = [
    {
      label: 'OUTSIDE TEMP',
      value: temp == null ? '—' : temp.toFixed(1),
      unit: '°C',
      statusText: temp == null ? 'No telemetry' : temp < -35 ? 'Severe Cold' : 'Polar Baseline',
      color: temp == null ? '#94a3b8' : temp < -40 ? '#f87171' : temp < -30 ? '#fbbf24' : '#38bdf8',
      IconComp: LuThermometerSnowflake,
      iconColor: '#38bdf8',
      bgGlow: 'rgba(56, 189, 248, 0.15)',
    },
    {
      label: 'WIND SPEED',
      value: wind == null ? '—' : wind.toFixed(0),
      unit: 'km/h',
      statusText: wind == null ? 'No telemetry' : wind > 80 ? 'Blizzard Warning' : wind > 40 ? 'Strong Wind' : 'Calm to Moderate',
      color: wind == null ? '#94a3b8' : wind > 80 ? '#fbbf24' : '#f8fafc',
      IconComp: LuWind,
      iconColor: '#38bdf8',
      bgGlow: 'rgba(56, 189, 248, 0.12)',
    },
    {
      label: 'POWER GENERATION',
      value: power == null ? '—' : power.toFixed(0),
      unit: 'kW',
      statusText: power == null ? 'No telemetry' : 'Generator output (model-derived)',
      color: power == null ? '#94a3b8' : '#fbbf24',
      IconComp: LuZap,
      iconColor: '#fbbf24',
      bgGlow: 'rgba(251, 191, 36, 0.15)',
    },
    {
      label: 'SUBSYSTEM STATUS',
      value: `${normalCount}/${totalSystems}`,
      unit: criticalCount > 0 ? 'CRIT' : warningCount > 0 ? 'WARN' : 'OK',
      statusText: criticalCount > 0 ? 'Fault Detected' : warningCount > 0 ? 'Advisory Active' : 'All Systems Nominal',
      color: criticalCount > 0 ? '#f87171' : warningCount > 0 ? '#fbbf24' : '#34d399',
      IconComp: criticalCount > 0 ? LuShieldAlert : LuShieldCheck,
      iconColor: criticalCount > 0 ? '#f87171' : '#34d399',
      bgGlow: criticalCount > 0 ? 'rgba(248, 113, 113, 0.2)' : 'rgba(52, 211, 153, 0.15)',
    },
  ];

  return (
    <div className="overview-hud-container">
      {/* Offline banner — top center */}
      {!isConnected && (
        <motion.div
          className="hud-offline-banner glass-panel"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        >
          <LuCloudOff size={20} className="offline-icon" />
          <div className="offline-text">
            <strong>SATELLITE LINK LOST &mdash; LOCAL AUTONOMOUS MODE ACTIVE</strong>
            <span>Station running on local edge telemetry &bull; Readings queued for resync</span>
          </div>
        </motion.div>
      )}

      {/* ── Bottom-Left: Prominent Station Information Card ── */}
      <motion.div
        className="hud-station-card glass-panel"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.3 }}
      >
        {/* Twin Inspector Button positioned prominently above/within the card */}
        <div className="hud-inspector-bar">
          {onOpenTwinInspector && (
            <button
              className="btn-hud-twin-inspector"
              onClick={onOpenTwinInspector}
              title="Inspect 3D Subsystems and Mesh Telemetry"
            >
              <LuSparkles size={14} className="hud-sparkle" />
              <span>Digital Twin Inspector</span>
              <span className="hud-btn-arrow">&rarr;</span>
            </button>
          )}
          <button
            className={`btn-hud-voice ${isVoiceMode ? 'listening' : ''}`}
            onClick={toggleVoiceMode}
            title="Turn the voice assistant on or off (continuous listening)"
          >
            <LuMic size={15} className={isVoiceMode ? 'pulse-icon' : ''} />
            <span>{isVoiceMode ? (isSpeaking ? 'Speaking…' : 'Listening…') : 'Voice assistant'}</span>
          </button>
        </div>

        <div className="hud-card-header">
          <h1 className="hud-card-title font-display">{station.fullName}</h1>
          <div className="hud-card-location">
            <LuMapPin size={14} className="hud-pin-icon" />
            <span className="hud-coords-text font-mono">
              {station.coords}
            </span>
            <span className="hud-sep">|</span>
            <span className="hud-region-text">{station.region}</span>
          </div>
        </div>

        <div className="hud-card-metadata font-mono">
          <div className="hud-meta-pill">
            <LuCalendar size={12} className="meta-icon" />
            <span>Est. {station.established}</span>
          </div>
          <div className="hud-meta-pill">
            <LuUsers size={12} className="meta-icon" />
            <span>{station.personnel ?? '—'} winter crew</span>
          </div>
          <div className="hud-meta-pill">
            <LuMountain size={12} className="meta-icon" />
            <span>Elev: {station.elevation}</span>
          </div>
          <div className="hud-meta-pill">
            <LuThermometerSnowflake size={12} className="meta-icon" />
            <span>Mean Winter: {station.winterTemp}</span>
          </div>
        </div>
      </motion.div>

      {/* ── Bottom-Right: Substantially Sized 2x2 Telemetry Cards ── */}
      <motion.div
        className="hud-telemetry-container"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.3 }}
      >
        <div className="hud-telemetry-grid">
          {stats.map((stat) => (
            <div key={stat.label} className="hud-telemetry-card glass-panel">
              <div
                className="telemetry-icon-box"
                style={{ background: stat.bgGlow, color: stat.iconColor }}
              >
                <stat.IconComp size={22} strokeWidth={1.8} />
              </div>

              <div className="telemetry-info-wrap">
                <span className="telemetry-label">{stat.label}</span>
                <div className="telemetry-value-row">
                  <span
                    className="telemetry-number font-mono tabular-nums"
                    style={{ color: stat.color }}
                  >
                    {stat.value}
                  </span>
                  <span className="telemetry-unit font-mono">{stat.unit}</span>
                </div>
                <span className="telemetry-status-sub text-caption">{stat.statusText}</span>
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
