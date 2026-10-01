/* ═══════════════════════════════════════════════════════════════
   Aurora — AI Diagnostics (real pipeline only, P0-4 / P0-5)
   Every value here comes from the simulator pipeline via the backend:
     /api/ai/anomaly   physics-residual Isolation Forest + 6σ residual gate
     /api/ai/decision  rule-based decision engine (+ audit trail)
     /api/ai/forecast  physics forward run on the live Open-Meteo forecast
     /api/ai/chronos   Chronos-Bolt quantiles (optional ML extras)
     /api/aurora-explain  Groq LLM, or an offline summary when unavailable
   No mock fallbacks: when a source is down the panel says so.
   ═══════════════════════════════════════════════════════════════ */
import { useCallback, useState } from 'react';
import { LuSparkles, LuMic, LuActivity, LuShieldCheck, LuTriangleAlert, LuListTree, LuTrendingUp } from 'react-icons/lu';
import { apiGet, apiPost } from '../services/api';
import { usePolling } from '../hooks/usePolling';
import './AiPanel.css';

const POLL_MS = 3000;
const QUESTIONS = [
  { id: 'status', label: 'Status' },
  { id: 'why', label: 'Why?' },
  { id: 'action', label: 'What should I do?' },
  { id: 'detail', label: 'Full detail' },
];

/** Human-readable state for a failed request (no fake data). */
function describeError(err) {
  if (!err) return null;
  if (err.kind === 'http' && err.status === 503) {
    const raw = typeof err.body?.detail === 'string' ? err.body.detail : '';
    return { title: 'Simulator offline', detail: raw.replace(/^Simulator offline:\s*/, '') || 'the simulation service is not running' };
  }
  if (err.kind === 'http') return { title: `Backend error (HTTP ${err.status})`, detail: err.url };
  return { title: 'Backend unreachable', detail: err.message };
}

function useAiSource(path, activeStation) {
  // Results are tagged with their station so a station switch shows "Loading…"
  // instead of the previous station's data (no reset-in-effect needed).
  const [state, setState] = useState({ station: null, data: null, error: null });
  usePolling(async (isActive) => {
    try {
      const data = await apiGet(`${path}?stationId=${activeStation}`, { timeoutMs: 5000 });
      if (isActive()) setState({ station: activeStation, data, error: null });
    } catch (err) {
      if (isActive()) setState({ station: activeStation, data: null, error: err });
      throw err;                       // let usePolling back off
    }
  }, POLL_MS, { key: `${path}|${activeStation}` });
  return state.station === activeStation
    ? { ...state, loading: false }
    : { data: null, error: null, loading: true };
}

function SourceState({ state, children }) {
  if (state.loading) return <p className="ai-subtitle">Loading…</p>;
  const e = describeError(state.error);
  if (e) {
    return (
      <div className="ai-offline-state" role="status">
        <LuTriangleAlert size={16} /> <strong>{e.title}</strong>
        <span className="text-muted"> — {e.detail}</span>
      </div>
    );
  }
  return children(state.data);
}

const fmt = (v, d = 1) => (typeof v === 'number' ? v.toFixed(d) : '—');

export default function AiPanel({ activeStation = 'maitri' }) {
  const anomaly = useAiSource('/ai/anomaly', activeStation);
  const decision = useAiSource('/ai/decision', activeStation);
  const forecast = useAiSource('/ai/forecast', activeStation);
  const chronos = useAiSource('/ai/chronos', activeStation);

  const [answerState, setAnswer] = useState(null);
  const [asking, setAsking] = useState(false);
  const [freeText, setFreeText] = useState('');
  const [listening, setListening] = useState(false);

  const ask = useCallback(async (question, text = '') => {
    setAsking(true);
    try {
      const res = await apiPost('/aurora-explain', { station: activeStation, question, freeText: text }, { timeoutMs: 25000 });
      setAnswer({ ...res, station: activeStation, asked: text || QUESTIONS.find((q) => q.id === question)?.label || question });
    } catch (err) {
      const e = describeError(err);
      setAnswer({ explanation: `${e.title}: ${e.detail}`, mode: 'error', llmAvailable: false, station: activeStation, asked: text || question });
    } finally {
      setAsking(false);
    }
  }, [activeStation]);

  // An answer belongs to the station it was asked about.
  const answer = answerState && (!answerState.station || answerState.station === activeStation) ? answerState : null;

  const startVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setAnswer({ explanation: 'Voice input is not supported by this browser — type your question instead.', mode: 'error', asked: 'voice' });
      return;
    }
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = false;
    rec.onstart = () => setListening(true);
    rec.onend = () => setListening(false);
    rec.onerror = (ev) => { setListening(false); setAnswer({ explanation: `Voice recognition error: ${ev.error}`, mode: 'error', asked: 'voice' }); };
    rec.onresult = (ev) => {
      const transcript = ev.results[0][0].transcript;
      setFreeText(transcript);
      ask('free', transcript);
    };
    rec.start();
  };

  const a = anomaly.data;
  const isAnomaly = Boolean(a?.isAnomaly);

  return (
    <div className="ai-module-container">
      {/* Header */}
      <div className="ai-header glass-panel">
        <div className="ai-header-left">
          <div className="ai-header-icon-box"><LuSparkles size={24} className="ai-header-icon" /></div>
          <div>
            <div className="ai-title-row">
              <h1 className="ai-title font-display">AI Diagnostics</h1>
              <span className="ai-badge-active">PHYSICS-RESIDUAL ISOLATION FOREST + 6σ GATE</span>
            </div>
            <p className="ai-subtitle">
              Observed telemetry vs the physics model's prediction for the same tick, for{' '}
              {activeStation === 'maitri' ? 'Maitri' : 'Bharati'}. Degradation signatures are synthetic prototypes.
            </p>
          </div>
        </div>
        <div className="ai-header-kpis">
          <div className="ai-kpi-chip">
            <span className="kpi-label">Anomaly score</span>
            <span className={`kpi-value font-mono ${isAnomaly ? 'text-danger' : 'text-success'}`}>{a ? fmt(a.anomalyScore, 3) : '—'}</span>
            <span className="kpi-sub">threshold {a ? fmt(a.threshold, 3) : '—'}</span>
          </div>
          <div className="ai-kpi-chip">
            <span className="kpi-label">State</span>
            <span className={`kpi-value font-mono ${isAnomaly ? 'text-danger' : 'text-success'}`}>{a ? (isAnomaly ? 'ANOMALOUS' : 'NORMAL') : '—'}</span>
            <span className="kpi-sub">{a?.triggeredBy?.length ? a.triggeredBy.join(' + ') : 'no rule fired'}</span>
          </div>
          <div className="ai-kpi-chip">
            <span className="kpi-label">Decision risk</span>
            <span className="kpi-value font-mono">{decision.data?.risk?.level ?? '—'}</span>
            <span className="kpi-sub">{decision.data?.event?.type?.replace(/_/g, ' ') ?? ''}</span>
          </div>
        </div>
      </div>

      {/* Anomaly evidence + candidate causes */}
      <div className="ai-brief-card glass-panel" data-testid="ai-anomaly">
        <div className="section-title-wrap"><LuActivity size={16} className="text-cyan" /><h3 className="section-title font-display">Anomaly detection</h3></div>
        <SourceState state={anomaly}>
          {(d) => (
            <>
              <div className="ai-score-bar-wrap">
                <div className="ai-score-bar-header">
                  <span className="score-label">Isolation-Forest path score (not a probability) · max residual {fmt(d.maxResidualSigma)}σ / gate {d.residualAlarmSigma}σ</span>
                  <span className="score-val font-mono">{fmt(d.anomalyScore, 3)} / {fmt(d.threshold, 3)}</span>
                </div>
                <div className="ai-score-track">
                  <div className="ai-score-fill" style={{ width: `${Math.min(100, (d.anomalyScore / Math.max(d.threshold, 0.01)) * 60)}%`, background: d.isAnomaly ? '#f87171' : '#34d399' }} />
                </div>
              </div>
              {d.evidence?.length ? (
                <ul className="ai-list">
                  {d.evidence.map((e) => (
                    <li key={e.sensor} className="font-mono">
                      {e.sensor}: {e.value} vs physics-expected {e.expected} ({e.deviation_sigma > 0 ? '+' : ''}{e.deviation_sigma}σ)
                    </li>
                  ))}
                </ul>
              ) : <p className="ai-subtitle"><LuShieldCheck size={14} /> No sensor deviates ≥ 3σ from the physics prediction.</p>}
              {d.candidateCauses?.length > 0 && (
                <p className="ai-subtitle">Possible causes (rule-based): {d.candidateCauses.map((c) => `${c.description} (${Math.round(c.confidence * 100)}%)`).join('; ')}</p>
              )}
            </>
          )}
        </SourceState>
      </div>

      {/* Residual table */}
      <div className="ai-matrix-section">
        <div className="matrix-section-header">
          <div className="section-title-wrap"><LuActivity size={16} className="text-cyan" /><h3 className="section-title font-display">Sensor residuals vs physics prediction (same tick)</h3></div>
        </div>
        <SourceState state={anomaly}>
          {(d) => (
            <div className="ai-grid">
              {(d.residuals || []).map((r) => {
                const hot = Math.abs(r.z) >= 3;
                return (
                  <div key={r.sensor} className={`ai-card glass-panel ${hot ? 'anomaly' : 'nominal'}`}>
                    <div className="ai-card-top">
                      <div><h4 className="ai-card-sensor font-display">{r.sensor.replace(/_/g, ' ')}</h4><span className="ai-card-facility text-caption">{r.building}</span></div>
                      <span className={`ai-score-badge ${hot ? 'badge-danger' : 'badge-success'}`}>{fmt(r.z)}σ</span>
                    </div>
                    <div className="ai-card-metrics">
                      <div className="ai-metric-item"><span className="ai-m-label">Observed</span><span className="ai-m-val font-mono">{fmt(r.observed, 2)}</span></div>
                      <div className="ai-metric-item"><span className="ai-m-label">Physics</span><span className="ai-m-val font-mono text-muted">{fmt(r.expected, 2)}</span></div>
                      <div className="ai-metric-item"><span className="ai-m-label">σ (assumed)</span><span className="ai-m-val font-mono">{r.sigma}</span></div>
                    </div>
                  </div>
                );
              })}
              {!(d.residuals || []).length && <p className="ai-subtitle">No residuals yet (detector warming up or not loaded).</p>}
            </div>
          )}
        </SourceState>
      </div>

      {/* Decision + audit trail */}
      <div className="ai-brief-card glass-panel" data-testid="ai-decision">
        <div className="section-title-wrap"><LuListTree size={16} className="text-cyan" /><h3 className="section-title font-display">Decision engine</h3></div>
        <SourceState state={decision}>
          {(d) => (
            <>
              <p className="ai-subtitle"><strong>{d.event?.description}</strong> — risk <strong>{d.risk?.level}</strong>
                {d.evaluation ? ` · evaluated at tick ${d.evaluation.tick} (${d.evaluation.reasons.join(', ')})` : ''}</p>
              {d.recentlyResolved && (
                <div className="ai-offline-state" data-testid="ai-recently-resolved">
                  Recently resolved {d.recentlyResolved.resolvedSecondsAgo}s ago: {d.recentlyResolved.event?.description} (was {d.recentlyResolved.risk})
                </div>
              )}
              {d.risk?.triggered_rules?.length > 0 && (
                <ul className="ai-list">{d.risk.triggered_rules.map((r) => <li key={r.id}>{r.id} {r.name} — {r.rationale}</li>)}</ul>
              )}
              {d.recommendation && (
                <p className="ai-subtitle">Recommendation: {d.recommendation.action}. Monitoring: {d.recommendation.monitoring}. Escalation: {d.recommendation.escalation}. Confidence: {d.recommendation.confidence}.</p>
              )}
              {d.auditTrail?.length > 0 && (
                <details><summary className="ai-subtitle">Audit trail ({d.auditTrail.length} steps)</summary>
                  <ol className="ai-list">{d.auditTrail.map((s) => <li key={s.step} className="font-mono">{s.step} — {s.source} ({s.provenance})</li>)}</ol>
                </details>
              )}
            </>
          )}
        </SourceState>
      </div>

      {/* Physics forecast + Chronos */}
      <div className="ai-brief-card glass-panel">
        <div className="section-title-wrap"><LuTrendingUp size={16} className="text-cyan" /><h3 className="section-title font-display">Forecasts</h3></div>
        <SourceState state={forecast}>
          {(f) => (f.available ? (
            <>
              <p className="ai-subtitle">Physics forward run · {f.provenance?.alignment} · risk {f.risk?.level}</p>
              <table className="ai-table font-mono">
                <thead><tr><th>Horizon</th><th>Outside °C</th><th>Load %</th><th>Gen °C</th><th>Fuel L/hr</th></tr></thead>
                <tbody>{f.predictions.map((p) => (
                  <tr key={p.horizon}><td>{p.horizon}</td><td>{fmt(p.weather?.env_temp)}</td><td>{fmt(p.predicted?.gen_load_pct)}</td><td>{fmt(p.predicted?.gen_temp_C)}</td><td>{fmt(p.predicted?.fuel_rate_Lhr)}</td></tr>
                ))}</tbody>
              </table>
            </>
          ) : <p className="ai-subtitle">Physics forecast unavailable: {f.reason}</p>)}
        </SourceState>
        <SourceState state={chronos}>
          {(c) => (c.available ? (
            <table className="ai-table font-mono">
              <thead><tr><th>Chronos-Bolt signal</th><th>p10</th><th>p50</th><th>p90</th><th>horizon</th></tr></thead>
              <tbody>{Object.entries(c.forecasts || {}).map(([sig, v]) => (v.available ? (
                <tr key={sig}><td>{sig}</td><td>{fmt(v.p10.at(-1))}</td><td>{fmt(v.median.at(-1))}</td><td>{fmt(v.p90.at(-1))}</td><td>+{v.horizon_minutes.at(-1)} min{v.note ? ` · ${v.note}` : ''}</td></tr>
              ) : (
                <tr key={sig}><td>{sig}</td><td colSpan={4}>{v.reason}</td></tr>
              )))}</tbody>
            </table>
          ) : <p className="ai-subtitle">Chronos unavailable: {c.reason}</p>)}
        </SourceState>
      </div>

      {/* Explanation */}
      <div className="ai-brief-card glass-panel" data-testid="ai-explain">
        <div className="ai-brief-header">
          <div className="ai-brief-title-wrap">
            <div>
              <h3 className="ai-brief-title font-display">Explanation</h3>
              <p className="ai-brief-sub">Groq LLM explains the decision JSON; without an LLM you get a deterministic offline summary.</p>
            </div>
          </div>
          <div className="btn-group-explain">
            {QUESTIONS.map((q) => (
              <button key={q.id} className="btn-ai-explain" disabled={asking} onClick={() => ask(q.id)}>{q.label}</button>
            ))}
            <button className={`btn-ai-voice ${listening ? 'listening' : ''}`} onClick={startVoice} disabled={asking || listening}>
              <LuMic size={15} className={listening ? 'pulse' : ''} /> {listening ? 'Listening…' : 'Voice'}
            </button>
          </div>
        </div>
        <form className="ai-ask-form" onSubmit={(e) => { e.preventDefault(); if (freeText.trim()) ask('free', freeText.trim()); }}>
          <input className="ai-ask-input" value={freeText} maxLength={500} placeholder="Ask about this station (e.g. “why is the risk high?”)" onChange={(e) => setFreeText(e.target.value)} />
          <button className="btn-ai-explain" type="submit" disabled={asking || !freeText.trim()}>{asking ? 'Asking…' : 'Ask'}</button>
        </form>
        {answer && (
          <div className="ai-explanation-box" data-testid="ai-answer">
            <div className="explain-header">
              <span className="explain-badge font-mono">
                {answer.mode === 'llm' ? 'LLM (GROQ)' : answer.mode === 'error' ? 'ERROR' : 'OFFLINE SUMMARY — LLM UNAVAILABLE'} · Q: {answer.asked}
              </span>
            </div>
            <div className="explain-text font-mono">{answer.explanation}</div>
          </div>
        )}
      </div>
    </div>
  );
}
