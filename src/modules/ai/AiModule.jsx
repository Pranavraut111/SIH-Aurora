/* ═══════════════════════════════════════════════════════════════
   Aurora — AI diagnostics (rollout 1B, checkpoint 2).

   Same real pipeline as the legacy AiPanel, polled every 3 s:
     /ai/anomaly   Isolation Forest on physics residuals + a residual σ gate
     /ai/decision  rule-based decision engine with its audit trail
     /ai/forecast  physics forward run on the Open-Meteo forecast
     /ai/chronos   Chronos-Bolt quantiles (optional ML extras)
     /aurora-explain  Groq LLM, or a deterministic offline summary
   When a source is down the card says which and why; nothing is filled in.
   Labels say what the numbers are: the IF path score is not a probability,
   a cause's "match strength" is mean |z| ÷ 10 (capped at 1), and the
   decision's confidence is a rule-based label.
   ═══════════════════════════════════════════════════════════════ */
import { useCallback, useState } from 'react';
import {
  Box, Button, Card, Collapse, LinearProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import MicNoneOutlined from '@mui/icons-material/MicNoneOutlined';
import { apiGet, apiPost } from '../../services/api';
import { usePolling } from '../../hooks/usePolling';
import { stationMeta } from '../../data/stationConfig';
import { formatNumber, isNum } from '../../lib/format';
import KpiCard from '../../ui/KpiCard';
import PageHeader from '../../ui/PageHeader';
import ProvenanceChip from '../../ui/Provenance';
import ScrollX from '../../ui/ScrollX';
import SectionCard from '../../ui/SectionCard';
import { LoadingBlock } from '../../ui/States';
import { StatusChip } from '../../ui/Status';
import { MODULES, sectionLabel } from '../../shell/navigation';

const POLL_MS = 3000;
const hidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' };
const QUESTIONS = [
  { id: 'status', label: 'Status' },
  { id: 'why', label: 'Why?' },
  { id: 'action', label: 'What should I do?' },
  { id: 'detail', label: 'Full detail' },
];
const RISK_STATUS = { high: 'critical', critical: 'critical', moderate: 'warning', elevated: 'warning', low: 'normal', normal: 'normal', nominal: 'normal', none: 'normal' };
/** "+1.2", "−3.4", "0.0" (no signed zero). */
const signedNum = (v, d = 1) => (!isNum(v) ? '—' : Math.abs(v) < 0.5 * 10 ** -d ? formatNumber(0, d) : `${v > 0 ? '+' : '−'}${formatNumber(Math.abs(v), d)}`);
const f = (v, d = 1) => formatNumber(isNum(v) ? v : null, d);

function describeError(err) {
  if (!err) return null;
  if (err.kind === 'http' && err.status === 503) {
    // The backend's detail names the internal simulator URL: useful in the log, not on screen.
    return { title: 'Simulator offline', detail: 'These diagnostics run in the simulator, which is not responding. Telemetry continues from the physics fallback.' };
  }
  if (err.kind === 'http') return { title: `Backend error (HTTP ${err.status})`, detail: err.url };
  return { title: 'Backend unreachable', detail: 'The backend is not responding. This panel retries automatically.' };
}

function useAiSource(path, station) {
  const [state, setState] = useState({ station: null, data: null, error: null });
  usePolling(async (isActive) => {
    try {
      const data = await apiGet(`${path}?stationId=${station}`, { timeoutMs: 5000 });
      if (isActive()) setState({ station, data, error: null });
    } catch (err) {
      if (isActive()) setState({ station, data: null, error: err });
      throw err;
    }
  }, POLL_MS, { key: `${path}|${station}` });
  return state.station === station ? { ...state, loading: false } : { data: null, error: null, loading: true };
}

function Source({ state, lines = 3, children }) {
  if (state.loading) return <LoadingBlock lines={lines} />;
  const e = describeError(state.error);
  if (e) {
    return (
      <Box role="status" sx={{ p: 4, borderRadius: '10px', bgcolor: 'aurora.surfaceRaised' }}>
        <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{e.title}</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>{e.detail}</Typography>
      </Box>
    );
  }
  return children(state.data);
}

export default function AiModule({ activeStation = 'maitri', updatedAt }) {
  const meta = MODULES.ai;
  const anomaly = useAiSource('/ai/anomaly', activeStation);
  const decision = useAiSource('/ai/decision', activeStation);
  const forecast = useAiSource('/ai/forecast', activeStation);
  const chronos = useAiSource('/ai/chronos', activeStation);
  const [answerState, setAnswer] = useState(null);
  const [asking, setAsking] = useState(false);
  const [freeText, setFreeText] = useState('');
  const [listening, setListening] = useState(false);
  const [showTrail, setShowTrail] = useState(false);

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
  const answer = answerState && (!answerState.station || answerState.station === activeStation) ? answerState : null;

  const startVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setAnswer({ explanation: 'Voice input is not supported by this browser. Type your question instead.', mode: 'error', asked: 'voice' });
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
  const d = decision.data;
  const fc = forecast.data;
  const scorePct = a && isNum(a.anomalyScore) && isNum(a.threshold) && a.threshold > 0 ? Math.min(100, (a.anomalyScore / a.threshold) * 50) : null;

  return (
    <Box data-testid="ai-module">
      <PageHeader
        section={sectionLabel(meta.section)}
        title={meta.title}
        description={`${meta.description} ${stationMeta(activeStation).name} station.`}
        updatedAt={updatedAt}
        updatedLabel="Snapshot"
        provenance={<>
          <ProvenanceChip kind="MODEL-DERIVED" subject="Detector" detail="Isolation Forest on residuals between observed telemetry and the physics model's prediction for the same tick. Degradation signatures are synthetic prototypes." />
          <ProvenanceChip kind="MODEL-DERIVED" subject="Decisions" detail="Rule-based decision engine; every step is in the audit trail." />
        </>}
      />

      <Typography variant="h2" sx={hidden}>Detector status</Typography>
      <Box component="section" aria-label="Detector status" data-testid="ai-kpis" sx={{
        display: 'grid', gap: 4, mb: 4,
        gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', lg: 'minmax(0, 1.6fr) repeat(2, minmax(0, 1fr))' },
        gridTemplateAreas: { xs: '"hero hero" "a b" "c c"', lg: '"hero a b" "hero c c"' },
      }}>
        <Card component="section" aria-label="Anomaly score" data-testid="kpi-anomaly" sx={{ gridArea: 'hero', p: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
            <Typography variant="label" component="h3" sx={{ color: 'text.secondary' }}>Anomaly score</Typography>
            {a && <StatusChip status={a.isAnomaly ? 'critical' : 'normal'} label={a.isAnomaly ? 'Anomalous' : 'Normal'} />}
          </Stack>
          <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1.5 }}>
            <Typography variant="kpiHero" component="p" sx={{ m: 0, color: a ? 'text.primary' : 'text.disabled' }}>{a ? f(a.anomalyScore, 3) : '—'}</Typography>
            {a && <Typography sx={{ color: 'text.secondary', fontSize: 18 }}>threshold {f(a.threshold, 3)}</Typography>}
          </Stack>
          {scorePct != null && (
            <Box>
              <LinearProgress variant="determinate" value={scorePct} color={a.isAnomaly ? 'error' : 'primary'} aria-label={`Score at ${formatNumber((a.anomalyScore / a.threshold) * 100)}% of the threshold`} />
              <Stack direction="row" sx={{ justifyContent: 'space-between', mt: 1 }}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>0</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>threshold (midpoint)</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>2×</Typography>
              </Stack>
            </Box>
          )}
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 'auto' }}>
            Isolation Forest path score: higher is more unusual. It is not a probability.
            {a?.triggeredBy?.length ? ` Triggered by: ${a.triggeredBy.join(' + ')}.` : ''}
          </Typography>
        </Card>
        <KpiCard label="Largest residual" value={a?.maxResidualSigma ?? null} unit="σ" decimals={1} testId="kpi-residual" sx={{ gridArea: 'a' }}
          loading={anomaly.loading}
          status={a && isNum(a.maxResidualSigma) && isNum(a.residualAlarmSigma) && a.maxResidualSigma >= a.residualAlarmSigma ? 'warning' : undefined}
          context={a ? `Alarm gate ${f(a.residualAlarmSigma, 0)}σ; σ per sensor is assumed` : anomaly.error ? describeError(anomaly.error).title : null} />
        <Card component="section" aria-label="Decision risk" data-testid="kpi-decision" sx={{ gridArea: 'b', p: 5, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="label" component="h3" sx={{ color: 'text.secondary' }}>Decision risk</Typography>
          {d?.risk?.level ? <Box><StatusChip status={RISK_STATUS[d.risk.level] || 'warning'} label={d.risk.level[0].toUpperCase() + d.risk.level.slice(1)} /></Box> : <Typography sx={{ color: 'text.disabled' }}>—</Typography>}
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 'auto' }}>{d?.event?.description || (decision.error ? describeError(decision.error).title : '')}</Typography>
        </Card>
        <Card component="section" aria-label="Forecast risk" data-testid="kpi-forecast" sx={{ gridArea: 'c', p: 5, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="label" component="h3" sx={{ color: 'text.secondary' }}>Forecast risk (physics forward run)</Typography>
          {fc?.available && fc.risk?.level ? <Box><StatusChip status={RISK_STATUS[fc.risk.level] || 'warning'} label={fc.risk.level[0].toUpperCase() + fc.risk.level.slice(1)} /></Box>
            : <Typography variant="body2" sx={{ color: 'text.secondary' }}>{fc && !fc.available ? `Unavailable: ${fc.reason}` : forecast.error ? describeError(forecast.error).title : '—'}</Typography>}
        </Card>
      </Box>

      <Box sx={{ display: 'grid', gap: 4, gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'repeat(2, minmax(0, 1fr))' }, alignItems: 'start' }}>
        <Stack sx={{ gap: 4, minWidth: 0 }}>
          <SectionCard title="Anomaly evidence" subtitle="Sensors that deviate ≥ 3σ from the physics prediction for the same tick" testId="ai-anomaly"
            provenance={<ProvenanceChip kind="MODEL-DERIVED" />}>
            <Source state={anomaly}>
              {(x) => (
                <>
                  {x.evidence?.length ? (
                    <Stack component="ul" sx={{ m: 0, p: 0, listStyle: 'none', gap: 2 }}>
                      {x.evidence.map((e) => (
                        <Box component="li" key={e.sensor} sx={{ p: 3, borderRadius: '8px', bgcolor: 'aurora.surfaceRaised' }}>
                          <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{e.sensor.replace(/_/g, ' ')}</Typography>
                          <Typography variant="body2" sx={{ fontFeatureSettings: '"tnum" 1' }}>
                            {f(e.value, 2)} observed vs {f(e.expected, 2)} expected ({signedNum(e.deviation_sigma)}σ)
                          </Typography>
                        </Box>
                      ))}
                    </Stack>
                  ) : <Typography variant="body2" sx={{ color: 'text.secondary' }}>No sensor deviates ≥ 3σ from the physics prediction.</Typography>}
                  {x.candidateCauses?.length > 0 && (
                    <Box sx={{ mt: 4 }}>
                      <Typography variant="h3" component="h3" sx={{ mb: 2 }}>Matching fault signatures (rule-based)</Typography>
                      <Table size="small" aria-label="Candidate causes">
                        <TableHead><TableRow><TableCell sx={{ pl: 0 }}>Signature</TableCell><TableCell align="right" sx={{ pr: 0 }}>Match strength</TableCell></TableRow></TableHead>
                        <TableBody>
                          {x.candidateCauses.map((c) => (
                            <TableRow key={c.cause}><TableCell sx={{ pl: 0 }}>{c.description}</TableCell><TableCell align="right" sx={{ pr: 0, fontFeatureSettings: '"tnum" 1' }}>{f(c.confidence, 2)}</TableCell></TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 1 }}>
                        Match strength = mean |z| of the signature&rsquo;s sensors ÷ 10, capped at 1. A heuristic, not a probability.
                      </Typography>
                    </Box>
                  )}
                </>
              )}
            </Source>
          </SectionCard>
          <SectionCard title="Decision engine" subtitle="Rule-based: event, triggered rules, recommendation and audit trail" testId="ai-decision"
            provenance={<ProvenanceChip kind="MODEL-DERIVED" subject="Rules" />}>
            <Source state={decision}>
              {(x) => (
                <>
                  <Typography sx={{ fontWeight: 600 }}>{x.event?.description || 'No event'}</Typography>
                  {x.evaluation && (
                    <Typography variant="caption" component="p" sx={{ color: 'text.secondary', m: 0 }}>Evaluated at tick {x.evaluation.tick} ({(x.evaluation.reasons || []).join(', ')})</Typography>
                  )}
                  {x.recentlyResolved && (
                    <Box data-testid="ai-recently-resolved" sx={{ mt: 2, p: 3, borderRadius: '8px', bgcolor: 'aurora.surfaceRaised', fontSize: 14 }}>
                      Recently resolved {x.recentlyResolved.resolvedSecondsAgo} s ago: {x.recentlyResolved.event?.description} (was {x.recentlyResolved.risk})
                    </Box>
                  )}
                  {x.risk?.triggered_rules?.length > 0 && (
                    <Stack component="ul" sx={{ m: 0, mt: 3, pl: 4, gap: 1, typography: 'body2' }}>
                      {x.risk.triggered_rules.map((r) => <li key={r.id}><Box component="span" sx={{ typography: 'mono', fontSize: 12 }}>{r.id}</Box> {r.name}: {r.rationale}</li>)}
                    </Stack>
                  )}
                  {x.recommendation && (
                    <Box component="dl" sx={{ m: 0, mt: 4, display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', columnGap: 4, rowGap: 1.5, fontSize: 14 }}>
                      {[['Action', x.recommendation.action], ['Monitoring', x.recommendation.monitoring], ['Escalation', x.recommendation.escalation],
                        ['Confidence', `${x.recommendation.confidence} (rule-based label from the anomaly score and risk level)`]].map(([k, v]) => (
                        <Box key={k} sx={{ display: 'contents' }}>
                          <Box component="dt" sx={{ color: 'text.secondary' }}>{k}</Box>
                          <Box component="dd" sx={{ m: 0 }}>{v}</Box>
                        </Box>
                      ))}
                    </Box>
                  )}
                  {x.auditTrail?.length > 0 && (
                    <>
                      <Button size="small" sx={{ mt: 3 }} onClick={() => setShowTrail((v) => !v)} aria-expanded={showTrail}>
                        {showTrail ? 'Hide' : 'Show'} audit trail ({x.auditTrail.length} steps)
                      </Button>
                      <Collapse in={showTrail} unmountOnExit>
                        <Stack component="ol" sx={{ m: 0, mt: 2, pl: 5, gap: 1, typography: 'body2' }}>
                          {x.auditTrail.map((s) => <li key={s.step}>{s.step}: {s.source} <Box component="span" sx={{ color: 'text.secondary' }}>({s.provenance})</Box></li>)}
                        </Stack>
                      </Collapse>
                    </>
                  )}
                </>
              )}
            </Source>
          </SectionCard>
        </Stack>
        <Stack sx={{ gap: 4, minWidth: 0 }}>
          <SectionCard title="Residuals" subtitle="Observed minus physics prediction, same tick. σ per sensor is an assumed noise level." testId="ai-residuals"
            provenance={<ProvenanceChip kind="MODEL-DERIVED" />}>
            <Source state={anomaly} lines={6}>
              {(x) => (x.residuals?.length ? (
                <ScrollX label="Sensor residuals, scrollable">
                  <Table size="small" aria-label="Sensor residuals" sx={{ minWidth: 420 }}>
                    <TableHead><TableRow><TableCell sx={{ pl: 0 }}>Sensor</TableCell><TableCell align="right">Observed</TableCell><TableCell align="right">Expected</TableCell><TableCell align="right">σ</TableCell><TableCell align="right" sx={{ pr: 0 }}>z</TableCell></TableRow></TableHead>
                    <TableBody>
                      {x.residuals.map((r) => {
                        const hot = Math.abs(r.z) >= 3;
                        return (
                          <TableRow key={r.sensor}>
                            <TableCell sx={{ pl: 0 }}>{r.sensor.replace(/_/g, ' ')}<Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>{r.building}</Typography></TableCell>
                            <TableCell align="right" sx={{ fontFeatureSettings: '"tnum" 1' }}>{f(r.observed, 2)}</TableCell>
                            <TableCell align="right" sx={{ fontFeatureSettings: '"tnum" 1', color: 'text.secondary' }}>{f(r.expected, 2)}</TableCell>
                            <TableCell align="right" sx={{ fontFeatureSettings: '"tnum" 1', color: 'text.secondary' }}>{r.sigma}</TableCell>
                            <TableCell align="right" sx={(t) => ({ pr: 0, fontFeatureSettings: '"tnum" 1', fontWeight: 600, color: hot ? t.vars.palette.status.warning : undefined })}>
                              {signedNum(r.z)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </ScrollX>
              ) : <Typography variant="body2" sx={{ color: 'text.secondary' }}>No residuals yet: the detector is warming up or not loaded.</Typography>)}
            </Source>
          </SectionCard>
          <SectionCard title="Forecasts" subtitle="Physics forward run on the Open-Meteo forecast; Chronos-Bolt quantiles when installed" testId="ai-forecasts"
            provenance={<ProvenanceChip kind="MODEL-DERIVED" />}>
            <Source state={forecast}>
              {(x) => (x.available ? (
                <>
                  <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mb: 2 }}>{x.provenance?.alignment}</Typography>
                  <ScrollX label="Physics forecast, scrollable">
                    <Table size="small" aria-label="Physics forecast" sx={{ minWidth: 420 }}>
                      <TableHead><TableRow><TableCell sx={{ pl: 0 }}>Horizon</TableCell><TableCell align="right">Outside °C</TableCell><TableCell align="right">Load %</TableCell><TableCell align="right">Coolant °C</TableCell><TableCell align="right" sx={{ pr: 0 }}>Fuel L/h</TableCell></TableRow></TableHead>
                      <TableBody>
                        {x.predictions.map((p) => (
                          <TableRow key={p.horizon}>
                            <TableCell sx={{ pl: 0 }}>{p.horizon}</TableCell>
                            <TableCell align="right" sx={{ fontFeatureSettings: '"tnum" 1' }}>{f(p.weather?.env_temp)}</TableCell>
                            <TableCell align="right" sx={{ fontFeatureSettings: '"tnum" 1' }}>{f(p.predicted?.gen_load_pct)}</TableCell>
                            <TableCell align="right" sx={{ fontFeatureSettings: '"tnum" 1' }}>{f(p.predicted?.gen_temp_C)}</TableCell>
                            <TableCell align="right" sx={{ pr: 0, fontFeatureSettings: '"tnum" 1' }}>{f(p.predicted?.fuel_rate_Lhr)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollX>
                </>
              ) : <Typography variant="body2" sx={{ color: 'text.secondary' }}>Physics forecast unavailable: {x.reason}</Typography>)}
            </Source>
            <Box sx={{ mt: 4 }}>
              <Source state={chronos}>
                {(c) => (c.available ? (
                  <ScrollX label="Chronos-Bolt quantiles, scrollable">
                    <Table size="small" aria-label="Chronos-Bolt quantiles" sx={{ minWidth: 420 }}>
                      <TableHead><TableRow><TableCell sx={{ pl: 0 }}>Chronos-Bolt signal</TableCell><TableCell align="right">p10</TableCell><TableCell align="right">p50</TableCell><TableCell align="right">p90</TableCell><TableCell align="right" sx={{ pr: 0 }}>Horizon</TableCell></TableRow></TableHead>
                      <TableBody>
                        {Object.entries(c.forecasts || {}).map(([sig, v]) => (v.available ? (
                          <TableRow key={sig}>
                            <TableCell sx={{ pl: 0 }}>{sig}{v.note && <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>{v.note}</Typography>}</TableCell>
                            <TableCell align="right">{f(v.p10.at(-1))}</TableCell><TableCell align="right">{f(v.median.at(-1))}</TableCell><TableCell align="right">{f(v.p90.at(-1))}</TableCell>
                            <TableCell align="right" sx={{ pr: 0 }}>+{v.horizon_minutes.at(-1)} min</TableCell>
                          </TableRow>
                        ) : (
                          <TableRow key={sig}><TableCell sx={{ pl: 0 }}>{sig}</TableCell><TableCell colSpan={4} sx={{ pr: 0, color: 'text.secondary' }}>{v.reason}</TableCell></TableRow>
                        )))}
                      </TableBody>
                    </Table>
                  </ScrollX>
                ) : <Typography variant="body2" sx={{ color: 'text.secondary' }}>Chronos unavailable: {c.reason}</Typography>)}
              </Source>
            </Box>
          </SectionCard>
        </Stack>
      </Box>

      <Box sx={{ mt: 4 }}>
        <SectionCard title="Explanation" subtitle="A Groq LLM explains the decision JSON; without one you get a deterministic offline summary." testId="ai-explain">
          <Stack direction="row" sx={{ gap: 2, flexWrap: 'wrap', mb: 3 }}>
            {QUESTIONS.map((q) => <Button key={q.id} variant="outlined" size="small" disabled={asking} onClick={() => ask(q.id)}>{q.label}</Button>)}
            <Button variant="outlined" size="small" startIcon={<MicNoneOutlined />} onClick={startVoice} disabled={asking || listening} aria-pressed={listening}>
              {listening ? 'Listening…' : 'Voice'}
            </Button>
          </Stack>
          <Stack component="form" direction="row" sx={{ gap: 2 }} onSubmit={(e) => { e.preventDefault(); if (freeText.trim()) ask('free', freeText.trim()); }}>
            <TextField size="small" fullWidth value={freeText} onChange={(e) => setFreeText(e.target.value)} label="Ask about this station"
              placeholder="e.g. why is the risk high?" slotProps={{ htmlInput: { maxLength: 500 } }} />
            <Button type="submit" variant="contained" disabled={asking || !freeText.trim()}>{asking ? 'Asking…' : 'Ask'}</Button>
          </Stack>
          {answer && (
            <Box data-testid="ai-answer" aria-live="polite" sx={{ mt: 4, p: 4, borderRadius: '10px', bgcolor: 'aurora.surfaceRaised' }}>
              <Stack direction="row" sx={{ gap: 2, alignItems: 'center', flexWrap: 'wrap', mb: 2 }}>
                {answer.mode === 'llm' ? <ProvenanceChip kind="MODEL-DERIVED" subject="LLM (Groq)" detail="Generated text grounded in the decision JSON. Check it against the figures above." />
                  : answer.mode === 'error' ? <StatusChip status="warning" label="Error" />
                    : <ProvenanceChip kind="MODEL-DERIVED" subject="Offline summary" detail="Deterministic summary of the decision JSON; no LLM was used." />}
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>Q: {answer.asked}</Typography>
              </Stack>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{answer.explanation}</Typography>
            </Box>
          )}
        </SectionCard>
      </Box>
    </Box>
  );
}
