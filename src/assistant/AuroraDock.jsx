/* ═══════════════════════════════════════════════════════════════
   Aurora assistant — the dock (replaces the chat side panel).

   No chat transcript. One floating column at the bottom right, top to bottom:
     1. Incident popup  — appears by itself when something happens: what happened,
                          what to do now (next steps), affected systems, risk, and
                          "Show me" / "Checklist" / snooze. Aurora also speaks it.
     2. Reply popup     — the answer to the LAST request only (replaced by the next
                          one, closes itself after 30 s unless hovered).
     3. Command bar     — mic + text box, shown when Aurora is opened (top-bar button,
                          hold V). One voice button: Stop while speaking, else mute.
   All three live in one flex column, so they can never overlap each other.
   Playbooks are example procedures, not official NCPOR procedures; it says so.
   ═══════════════════════════════════════════════════════════════ */
import { useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, Card, Chip, Collapse, FormControlLabel, IconButton, MenuItem, Paper, Slider, Stack, Switch, TextField, Tooltip, Typography,
} from '@mui/material';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import MicNoneOutlined from '@mui/icons-material/MicNoneOutlined';
import MicOffOutlined from '@mui/icons-material/MicOffOutlined';
import ReportProblemOutlined from '@mui/icons-material/ReportProblemOutlined';
import SendOutlined from '@mui/icons-material/SendOutlined';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import StopCircleOutlined from '@mui/icons-material/StopCircleOutlined';
import UndoOutlined from '@mui/icons-material/UndoOutlined';
import VolumeOffOutlined from '@mui/icons-material/VolumeOffOutlined';
import VolumeUpOutlined from '@mui/icons-material/VolumeUpOutlined';
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined';
import TipsAndUpdatesOutlined from '@mui/icons-material/TipsAndUpdatesOutlined';
import { stationMeta } from '../data/stationConfig';
import { StatusChip } from '../ui/Status';
import { ensureVoices, hasHindiVoice, listVoices } from './speech';
import { buildingName, suggestLabel } from './actions';
import { nextStep } from './briefing';
import { stepsFor } from './incidents';
import IncidentCard from './IncidentCard';
import CascadeChainMini from './CascadeChainMini';

const REPLY_AUTO_CLOSE_MS = 30000;
const EXAMPLES = ["What's wrong?", 'What should I do now?', "How's the fuel?", 'Show me what depends on the generator'];
const RISK_STATUS = { high: 'critical', critical: 'critical', moderate: 'warning', low: 'normal', nominal: 'normal' };
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function SectionLabel({ children }) {
  return (
    <Typography component="h4" sx={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'text.secondary', mt: 2, mb: 0.5 }}>
      {children}
    </Typography>
  );
}

/** Proactive AI Guidance: shows context-aware warnings before failures happen.
 *  Draws from the backend's decision engine context (ctx) — risk assessment,
 *  anomaly detection, fuel autonomy — to surface early warnings. */
function ProactiveGuidance({ ctx, stationId, stationName, onSend }) {
  const [dismissed, setDismissed] = useState(new Set());
  const tips = [];
  if (ctx?.decision?.risk?.level && ctx.decision.risk.level !== 'nominal' && ctx.decision.risk.level !== 'low') {
    tips.push({ id: 'risk', icon: '⚠️', label: `Risk: ${ctx.decision.risk.level}`, text: `The decision engine rates ${stationName} risk as ${ctx.decision.risk.level}. ${ctx.decision.risk.recommendedAction || 'Monitor closely.'}`, action: "What's the current risk and what should I do?" });
  }
  if (ctx?.anomaly?.isAnomaly && ctx.anomaly.maxResidualSigma > 2.5) {
    const sigma = ctx.anomaly.maxResidualSigma.toFixed(1);
    tips.push({ id: 'anomaly', icon: '🔍', label: `Anomaly detected (${sigma}σ)`, text: `Physics-residual anomaly at ${sigma} sigma. ${(ctx.anomaly.candidateCauses || []).slice(0, 2).map((c) => c.description).join('. ') || 'Cause not yet identified.'}`, action: 'Tell me about the anomaly' });
  }
  if (ctx?.derived?.fuelAutonomyDays?.value != null && ctx.derived.fuelAutonomyDays.value < 30) {
    const days = Math.round(ctx.derived.fuelAutonomyDays.value);
    tips.push({ id: 'fuel', icon: '⛽', label: `Fuel: ${days} days`, text: `Fuel autonomy is ${days} days, below the 30-day planning threshold. Consider conservation measures or schedule resupply.`, action: "How's the fuel situation?" });
  }
  const visible = tips.filter((t) => !dismissed.has(t.id));
  if (!visible.length) return null;
  return (
    <Card data-testid="proactive-guidance" sx={(t) => ({
      pointerEvents: 'auto', p: 3, borderLeft: `4px solid ${t.vars.palette.info.main}`,
      boxShadow: t.vars.palette.aurora.shadowFloat, animation: 'aurora-pop-in 260ms ease-out',
    })}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5, mb: 1.5 }}>
        <TipsAndUpdatesOutlined sx={{ color: 'info.main', fontSize: 20 }} />
        <Typography sx={{ fontWeight: 600, fontSize: 13, flex: 1 }}>Aurora Guidance</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>Proactive</Typography>
      </Stack>
      <Stack sx={{ gap: 1.5 }}>
        {visible.map((tip) => (
          <Box key={tip.id} sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
            <Typography component="span" sx={{ fontSize: 16, lineHeight: 1.4, flexShrink: 0 }}>{tip.icon}</Typography>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.25 }}>{tip.label}</Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: 13 }}>{tip.text}</Typography>
              <Stack direction="row" sx={{ gap: 1, mt: 1 }}>
                {tip.action && <Button size="small" variant="outlined" onClick={() => onSend(tip.action)} sx={{ fontSize: 12, py: 0.25, borderRadius: '8px' }}>Ask Aurora</Button>}
                <Button size="small" onClick={() => setDismissed((s) => new Set([...s, tip.id]))} sx={{ fontSize: 12, py: 0.25, color: 'text.secondary' }}>Dismiss</Button>
              </Stack>
            </Box>
          </Box>
        ))}
      </Stack>
    </Card>
  );
}

/** The incident popup: compact summary + "what to do", expands into the full checklist card. */
function IncidentPopup({ incident: inc, book, queued, ctx, latestUpdate, onShowMe, onToggleStep, onControl, onShowChain, onFocus, snoozedUntil, now }) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { setExpanded(false); }, [inc.key]);
  const resolved = inc.status === 'resolved';
  const sev = resolved ? 'normal' : inc.severity === 'critical' ? 'critical' : 'warning';
  const station = stationMeta(inc.station).name;
  const steps = stepsFor(book, inc);
  const todo = steps.map((s, i) => ({ s, i })).filter(({ i }) => !inc.done.includes(i)).slice(0, 3);
  const others = inc.affected.filter((b) => !inc.sources.includes(b));
  const next = nextStep(inc, book);

  return (
    <Card role="alert" aria-live="assertive" data-testid="incident-float" data-status={inc.status}
      sx={(t) => ({ pointerEvents: 'auto', p: 4, borderLeft: `4px solid ${t.vars.palette.status[sev]}`, boxShadow: t.vars.palette.aurora.shadowFloat,
        maxHeight: '58vh', overflowY: 'auto', animation: 'aurora-pop-in 260ms ease-out' })}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 2 }}>
        <ReportProblemOutlined sx={(t) => ({ color: t.vars.palette.status[sev], fontSize: 22 })} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600, fontSize: 15, lineHeight: 1.3 }}>{book.title}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{station} · {resolved ? 'Resolved' : cap(inc.severity)}{inc.scenario ? ' · Simulated' : ''}</Typography>
        </Box>
        {!resolved && inc.risk && <StatusChip status={RISK_STATUS[inc.risk] || 'warning'} label={`Risk: ${cap(inc.risk)}`} />}
        <IconButton size="small" aria-label={resolved ? 'Close' : 'Snooze this incident for 5 minutes'} data-testid="incident-float-close"
          onClick={() => onControl(resolved ? 'dismiss' : 'snooze')}>
          <CloseOutlined fontSize="small" />
        </IconButton>
      </Stack>

      {expanded ? (
        <Box sx={{ mt: 3 }}>
          <IncidentCard incident={inc} book={book} queue={queued} ctx={ctx} onToggleStep={onToggleStep}
            onControl={onControl} onShowChain={onShowChain} onFocus={onFocus} snoozedUntil={snoozedUntil} now={now} />
        </Box>
      ) : (
        <>
          <SectionLabel>What happened</SectionLabel>
          <Typography variant="body2">{resolved ? `Resolved. ${book.meaning}` : book.meaning}</Typography>
          {(inc.sources.length > 0 || others.length > 0) && (
            <>
              <SectionLabel>Cascade chain</SectionLabel>
              <CascadeChainMini stationId={inc.station} sources={inc.sources} affected={inc.affected}
                severity={inc.severity} resolved={resolved} />
            </>
          )}
          {!resolved && todo.length > 0 && (
            <>
              <SectionLabel>What to do now</SectionLabel>
              <Box component="ol" sx={{ m: 0, pl: 5 }} data-testid="incident-float-steps">
                {todo.map(({ s, i }) => (
                  <Typography component="li" variant="body2" key={s.do} value={i + 1} sx={{ fontWeight: next?.index === i ? 600 : 400, mb: 0.5 }}>{s.do}</Typography>
                ))}
              </Box>
            </>
          )}
          {latestUpdate && !resolved && (
            <Typography variant="body2" sx={{ mt: 2, color: 'text.secondary' }} data-testid="incident-float-update">Update: {latestUpdate}</Typography>
          )}
          <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 2 }}>Example procedure, not an official NCPOR procedure.</Typography>
        </>
      )}

      <Stack direction="row" sx={{ gap: 2, mt: 3, alignItems: 'center', flexWrap: 'wrap' }}>
        {!resolved && <Button variant="contained" size="small" onClick={onShowMe} data-testid="incident-float-show">Show me</Button>}
        <Button size="small" variant={resolved ? 'contained' : 'text'} onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} data-testid="incident-float-open">
          {expanded ? 'Less' : 'Full checklist'}
        </Button>
        {queued.length > 1 && <Typography variant="caption" sx={{ color: 'text.secondary' }}>+{queued.length - 1} more incident{queued.length > 2 ? 's' : ''}</Typography>}
      </Stack>
    </Card>
  );
}

/** The answer to the last request (no history). While a request runs it shows that question + "Thinking…". */
function ReplyPopup({ reply: last, pending, onClose, onUndo, onSuggestion, stationId, busy, interim, listening }) {
  const [more, setMore] = useState(false);
  const [hover, setHover] = useState(false);
  const thinking = Boolean(busy || (listening && interim));
  const reply = thinking ? null : last;
  useEffect(() => { setMore(false); }, [reply?.id]);
  useEffect(() => {
    if (!reply || hover || reply.kind === 'confirm') return undefined;
    const t = setTimeout(onClose, REPLY_AUTO_CLOSE_MS);
    return () => clearTimeout(t);
  }, [reply, hover, onClose]);

  if (!reply && !thinking) return null;
  const question = thinking ? (listening && interim ? null : pending) : reply;
  return (
    <Card data-testid="assistant-reply" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      sx={(t) => ({ pointerEvents: 'auto', p: 2.5, boxShadow: t.vars.palette.aurora.shadowFloat, maxHeight: '32vh', overflowY: 'auto',
        borderLeft: `4px solid ${reply?.error ? t.vars.palette.status.critical : t.vars.palette.primary.main}`, animation: 'aurora-pop-in 220ms ease-out' })}>
      <Stack direction="row" sx={{ alignItems: 'flex-start', gap: 1.5 }}>
        <AutoAwesomeOutlined sx={{ color: 'primary.main', fontSize: 18, mt: 0.25 }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {question?.question && (
            <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mb: 0.5 }} data-testid="msg-user">
              {question.via === 'voice' ? 'You said' : 'You asked'}: “{question.question}”
            </Typography>
          )}
          {thinking && (
            <Typography variant="body2" sx={{ color: 'text.secondary', fontStyle: 'italic' }} role="status" data-testid="assistant-caption">
              {listening && interim ? `“${interim}”` : 'Thinking…'}
            </Typography>
          )}
          {reply && (
            <Box data-testid="msg-aurora" data-kind={reply.kind || undefined} sx={{ fontSize: 13.5, lineHeight: 1.5 }}>
              {reply.text}
              {reply.resolved && <Typography component="span" variant="caption" sx={{ display: 'block', mt: 0.5, fontWeight: 600 }}>{reply.resolved}</Typography>}
            </Box>
          )}
        </Box>
        {reply && <IconButton size="small" onClick={onClose} aria-label="Close the reply" data-testid="assistant-reply-close"><CloseOutlined fontSize="small" /></IconButton>}
      </Stack>
      {reply?.chips?.length > 0 && (
        <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', mt: 1.5 }}>
          {reply.chips.map((c) => (
            <Chip key={c.id} size="small" variant="outlined" data-testid="action-chip" data-undone={c.undone || undefined}
              color={c.refused ? 'default' : 'primary'} label={c.undone ? `${c.label} (undone)` : c.label}
              onDelete={c.undo && !c.undone ? () => onUndo(reply.id, c.id) : undefined}
              deleteIcon={c.undo && !c.undone ? <UndoOutlined aria-label={`Undo: ${c.label}`} /> : undefined} />
          ))}
        </Stack>
      )}
      {reply?.suggestions?.length > 0 && (
        <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', mt: 1.5 }}>
          {reply.suggestions.map((a) => (
            <Button key={JSON.stringify(a)} size="small" variant="outlined" onClick={() => onSuggestion(reply.id, a)} data-testid="suggestion">
              {suggestLabel(a, stationId)}
            </Button>
          ))}
        </Stack>
      )}
      {reply?.detail?.length > 0 && (
        <>
          <Button size="small" sx={{ px: 0, minWidth: 0, mt: 0.5 }} onClick={() => setMore((v) => !v)} aria-expanded={more}>{more ? 'Less' : 'Details'}</Button>
          <Collapse in={more} unmountOnExit>
            <Box component="ul" sx={{ m: 0, pl: 3, fontSize: 12.5, color: 'text.secondary' }} data-testid="msg-detail">
              {reply.detail.map((d) => <li key={d}>{d}</li>)}
            </Box>
            {reply.sources?.length > 0 && <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>Sources: {reply.sources.join(', ').replace(/_/g, ' ')}</Typography>}
          </Collapse>
        </>
      )}
      {reply && (reply.notice || reply.mode === 'llm' || reply.grounding?.ok === false) && (
        <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 1 }} data-testid="msg-mode">
          {reply.notice || (reply.mode === 'llm' ? 'Phrased by the LLM from station data; numbers checked against it' : null)}
          {reply.grounding?.ok === false ? 'Answered from station data (the AI phrasing quoted numbers not in the data)' : null}
        </Typography>
      )}
    </Card>
  );
}

function Settings({ prefs, setPrefs, voiceIn, onTestVoice }) {
  const [voices, setVoices] = useState(() => listVoices(prefs.lang));
  useEffect(() => {
    let alive = true;
    ensureVoices().then(() => { if (alive) setVoices(listVoices(prefs.lang)); });
    return () => { alive = false; };
  }, [prefs.lang]);
  const hindi = hasHindiVoice();
  return (
    <Stack sx={{ pt: 1, pb: 2, gap: 0.5 }} data-testid="assistant-settings-panel">
      <FormControlLabel control={<Switch size="small" checked={prefs.voice} onChange={(e) => setPrefs({ voice: e.target.checked })} />} label="Speak to me" />
      <FormControlLabel control={<Switch size="small" checked={prefs.announceAll} onChange={(e) => setPrefs({ announceAll: e.target.checked })} data-testid="assistant-announce-all" />}
        label="Announce every incident" />
      <FormControlLabel control={<Switch size="small" checked={prefs.autoNavigate} onChange={(e) => setPrefs({ autoNavigate: e.target.checked })} />} label="Open pages automatically" />
      <FormControlLabel control={<Switch size="small" checked={prefs.conversation} disabled={!voiceIn} onChange={(e) => setPrefs({ conversation: e.target.checked })} />}
        label="Keep listening (conversation mode)" />
      <Stack direction="row" sx={{ alignItems: 'center', gap: 3, pr: 2 }}>
        <Typography variant="body2" id="aurora-rate" sx={{ whiteSpace: 'nowrap' }}>Speed</Typography>
        <Slider size="small" min={0.7} max={1.3} step={0.02} value={prefs.rate} onChange={(_, v) => setPrefs({ rate: v })}
          aria-labelledby="aurora-rate" valueLabelDisplay="auto" />
      </Stack>
      <Stack direction="row" sx={{ gap: 2, mt: 1, alignItems: 'flex-start' }}>
        <TextField select size="small" label="Voice" value={prefs.voiceName || ''} onChange={(e) => setPrefs({ voiceName: e.target.value || null })} sx={{ flex: 1 }}
          data-testid="assistant-voice-select">
          <MenuItem value="">Best available (automatic)</MenuItem>
          {voices.map((v) => <MenuItem key={v.name} value={v.name}>{v.name} · {v.lang}</MenuItem>)}
        </TextField>
        <Button size="small" variant="outlined" onClick={onTestVoice} sx={{ mt: 0.5 }}>Test</Button>
      </Stack>
      <TextField select size="small" label="Language" value={prefs.lang} onChange={(e) => setPrefs({ lang: e.target.value, voiceName: null })} sx={{ mt: 1.5, maxWidth: 220 }}
        helperText={hindi ? 'Hindi answers need the LLM; data-only answers stay in English.' : 'Hindi voice output is not available in this browser.'}>
        <MenuItem value="en">English</MenuItem>
        <MenuItem value="hi">हिन्दी (Hindi)</MenuItem>
      </TextField>
    </Stack>
  );
}

export default function AuroraDock({
  open, isPhone, onClose, reply, pending, onDismissReply, busy, listening, interim, speaking, support, prefs, setPrefs, status, micError,
  onSend, onMic, onUndo, onSuggestion, onStop, onTestVoice, pendingConfirm, incident, book, queued, latestUpdate, showIncident,
  onFocusIncident, onToggleStep, onIncidentControl, onShowChain, onShowMe, snoozedUntil, now, stationName, stationId, ctx, draft,
}) {
  const [text, setText] = useState(draft || '');
  const [settings, setSettings] = useState(false);
  const inputRef = useRef(null);
  useEffect(() => { if (draft) setText(draft); }, [draft]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50); }, [open]);

  const send = () => {
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setText('');
  };
  const voiceIn = support.recognition;
  const offline = status && status.llmAvailable === false;
  const anything = open || (showIncident && incident && book) || reply || busy;
  if (!anything) return null;

  return (
    <Box data-testid="aurora-dock" sx={{
      position: 'fixed', zIndex: 1250, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 1.5, pointerEvents: 'none',
      maxHeight: 'calc(100vh - 88px)',
      ...(isPhone ? { left: 8, right: 8, bottom: 8 } : { right: { xs: 8, sm: 16, md: 24 }, bottom: { xs: 8, sm: 16, md: 24 }, width: { xs: 'calc(100vw - 32px)', sm: 370, md: 390 }, maxWidth: 'calc(100vw - 32px)' }),
    }}>
      {showIncident && incident && book && (
        <IncidentPopup incident={incident} book={book} queued={queued} ctx={ctx} latestUpdate={latestUpdate} onShowMe={() => onShowMe(incident)}
          onToggleStep={onToggleStep} onControl={onIncidentControl} onShowChain={onShowChain} onFocus={onFocusIncident} snoozedUntil={snoozedUntil} now={now} />
      )}

      {open && ctx && !showIncident && !reply && !busy && (
        <ProactiveGuidance ctx={ctx} stationId={stationId} stationName={stationName} onSend={onSend} />
      )}

      <ReplyPopup reply={reply} pending={pending} onClose={onDismissReply} onUndo={onUndo} onSuggestion={onSuggestion} stationId={stationId}
        busy={busy} interim={interim} listening={listening} />

      {open && (
        <Paper role="dialog" aria-modal="false" aria-label={`Aurora, operator assistant for ${stationName}`} data-testid="assistant-panel" elevation={8}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
          sx={(t) => ({ pointerEvents: 'auto', px: 3, pt: 2, pb: 2, borderRadius: '14px', border: `1px solid ${t.vars.palette.divider}`,
            bgcolor: t.vars.palette.background.paper, animation: 'aurora-pop-in 200ms ease-out' })}>
          <Collapse in={settings} unmountOnExit>
            <Settings prefs={prefs} setPrefs={setPrefs} voiceIn={voiceIn} onTestVoice={onTestVoice} />
          </Collapse>
          {!reply && !busy && !listening && (
            <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', mb: 2 }} data-testid="assistant-empty">
              {EXAMPLES.map((x) => <Chip key={x} label={x} size="small" variant="outlined" clickable onClick={() => onSend(x)} />)}
            </Stack>
          )}
          {pendingConfirm && <Alert severity="info" icon={false} sx={{ mb: 2, py: 0 }}>Say “yes” or “no”, or use the dialog.</Alert>}
          {micError && <Alert severity="warning" icon={false} sx={{ mb: 2, py: 0 }}>{micError}</Alert>}
          {offline && <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mb: 1 }} data-testid="assistant-offline">Answering from station data only{status.reason ? ` (${status.reason})` : ''}.</Typography>}
          <Stack direction="row" sx={{ gap: 0.5, alignItems: 'center' }} component="form" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <IconButton onClick={onMic} disabled={!voiceIn} aria-pressed={listening} data-testid="assistant-mic"
              aria-label={!voiceIn ? 'Voice input is not supported in this browser' : listening ? 'Stop listening' : 'Speak to Aurora'}
              sx={(t) => (listening ? { bgcolor: t.vars.palette.status.criticalTint, color: t.vars.palette.status.critical, animation: 'aurora-pulse 1.4s ease-in-out infinite' } : {})}>
              {voiceIn ? <MicNoneOutlined /> : <MicOffOutlined />}
            </IconButton>
            <TextField inputRef={inputRef} fullWidth size="small" value={text} placeholder={listening ? 'Listening…' : 'Ask Aurora, e.g. “what’s wrong?”'}
              onChange={(e) => setText(e.target.value.slice(0, 500))}
              slotProps={{ htmlInput: { 'aria-label': 'Message to Aurora', 'data-testid': 'assistant-input', maxLength: 500 } }} />
            <IconButton type="submit" disabled={!text.trim() || busy} aria-label="Send" data-testid="assistant-send"><SendOutlined /></IconButton>
            {speaking && (
              <Tooltip title="Stop speaking">
                <IconButton onClick={onStop} aria-label="Stop speaking" data-testid="assistant-stop" color="primary">
                  <StopCircleOutlined />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title={prefs.voice ? 'Voice enabled (click to mute)' : 'Aurora voice is muted (click to unmute)'}>
              <IconButton onClick={() => setPrefs({ voice: !prefs.voice })} aria-pressed={!prefs.voice} data-testid="assistant-mute"
                color={prefs.voice ? 'default' : 'warning'}
                aria-label={prefs.voice ? 'Mute Aurora' : 'Unmute Aurora'}>
                {prefs.voice ? <VolumeUpOutlined /> : <VolumeOffOutlined />}
              </IconButton>
            </Tooltip>
            <IconButton onClick={() => setSettings((v) => !v)} aria-expanded={settings} aria-label="Assistant settings" data-testid="assistant-settings"><SettingsOutlined /></IconButton>
            <IconButton onClick={onClose} aria-label="Close Aurora" data-testid="assistant-close"><CloseOutlined /></IconButton>
          </Stack>
          <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 1 }} data-testid="assistant-privacy">
            {voiceIn
              ? <>{isPhone ? 'Tap the mic to talk.' : <>Hold <Box component="kbd" sx={{ fontFamily: 'inherit', fontWeight: 600 }}>V</Box> or tap the mic.</>} Browser speech recognition may send audio to the browser vendor.</>
              : 'Voice input is not supported in this browser, so type instead.'}
          </Typography>
        </Paper>
      )}
    </Box>
  );
}
