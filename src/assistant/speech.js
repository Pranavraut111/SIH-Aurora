/* ═══════════════════════════════════════════════════════════════
   Aurora assistant — Web Speech API wrappers.

   Recognition (SpeechRecognition / webkitSpeechRecognition) is missing in some
   browsers (Firefox): the panel then offers text only and says why. Browser speech
   recognition may send audio to the browser vendor; the panel says so too.
   Synthesis uses the browser's own voices. Nothing here runs without a user gesture:
   the panel calls these from a click / key press, or after one has happened.
   ═══════════════════════════════════════════════════════════════ */

export function speechSupport() {
  if (typeof window === 'undefined') return { recognition: false, synthesis: false };
  return {
    recognition: Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
    synthesis: Boolean(window.speechSynthesis && window.SpeechSynthesisUtterance),
  };
}

export const LANGS = { en: 'en-IN', hi: 'hi-IN' };

// Voices that sound natural and calm (OS "premium"/"enhanced" voices, Microsoft and Google
// neural voices, the better macOS voices). Earlier in the list = preferred.
// Voices that sound natural and calm (OS "premium"/"enhanced" voices, macOS Samantha/Karen/Daniel/Rishi,
// Microsoft and Google neural voices). Local offline system voices are preferred for 100% reliability.
const PREFERRED = [
  /Samantha/i, /Serena/i, /Karen/i, /Moira/i, /Tessa/i, /Veena/i, /Rishi/i, /Daniel/i,
  /natural/i, /neural/i, /premium/i, /enhanced/i,
  /Microsoft (Neerja|Sonia|Libby|Aria|Jenny|Ava|Emma)/i, /Google UK English Female/i, /Google US English/i,
  /Google हिन्दी/i, /Lekha/i,
];
// Robotic or novelty voices (macOS novelty set, eSpeak, compact voices): never chosen automatically.
const AVOID = /compact|espeak|eloquence|Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Deranged|Good News|Hysterical|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Fred|Junior|Ralph|Kathy|Grandma|Grandpa|Rocko|Shelley|Flo\b|Eddy|Reed|Sandy/i;

function allVoices() {
  return window.speechSynthesis?.getVoices?.() || [];
}

/** Higher = better for `lang`. Exported for tests. */
export function scoreVoice(v, lang = 'en') {
  if (!v?.lang) return -Infinity;
  const base = lang === 'hi' ? 'hi' : 'en';
  if (!v.lang.toLowerCase().startsWith(base)) return -Infinity;
  let s = 0;
  if (AVOID.test(v.name)) s -= 50; // deprioritize rather than completely eliminate
  const p = PREFERRED.findIndex((re) => re.test(v.name));
  if (p >= 0) s += 40 - p;
  const tag = v.lang.replace('_', '-').toLowerCase();
  if (base === 'en') s += { 'en-in': 6, 'en-gb': 5, 'en-us': 4, 'en-au': 3, 'en-ie': 3 }[tag] ?? 1;
  // Local offline system voices (e.g. macOS Samantha) play immediately through hardware CoreAudio with zero network latency
  if (v.localService === true) s += 15;
  return s;
}

/** The best voice for `lang` ('en' | 'hi'), the one named `name` if installed, or null. */
export function pickVoice(lang, name = null) {
  const voices = allVoices();
  if (name) {
    const chosen = voices.find((v) => v.name === name);
    if (chosen) return chosen;
  }
  let best = null;
  let bestScore = -Infinity;
  voices.forEach((v) => {
    const s = scoreVoice(v, lang);
    if (s > bestScore) { best = v; bestScore = s; }
  });
  if (best) return best;
  // Fallback: any voice matching base lang
  const base = lang === 'hi' ? 'hi' : 'en';
  const prefixMatch = voices.find((v) => v.lang?.toLowerCase().startsWith(base));
  if (prefixMatch) return prefixMatch;
  return voices.find((v) => v.default) || voices[0] || null;
}

/** Voices offered in settings for `lang`, best first (robotic ones left out). */
export function listVoices(lang) {
  return allVoices().map((v) => ({ v, s: scoreVoice(v, lang) })).filter((x) => x.s > -100)
    .sort((a, b) => b.s - a.s).map((x) => ({ name: x.v.name, lang: x.v.lang }));
}

/** Chrome loads voices asynchronously: poll and listen to voiceschanged. */
let voicesReady = null;
export function ensureVoices() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return Promise.resolve([]);
  if (allVoices().length) return Promise.resolve(allVoices());
  if (!voicesReady) {
    voicesReady = new Promise((resolve) => {
      let resolved = false;
      let pollTimer = null;
      const done = () => {
        if (resolved) return;
        resolved = true;
        if (pollTimer) clearTimeout(pollTimer);
        window.speechSynthesis.removeEventListener?.('voiceschanged', done);
        resolve(allVoices());
      };
      window.speechSynthesis.addEventListener?.('voiceschanged', done);
      const checkVoices = () => {
        if (resolved) return;
        if (allVoices().length > 0) {
          done();
        } else {
          pollTimer = setTimeout(checkVoices, 40);
        }
      };
      pollTimer = setTimeout(checkVoices, 40);
      setTimeout(done, 1200);
    }).then((v) => { if (!v.length) voicesReady = null; return v; });
  }
  return voicesReady;
}

export function hasHindiVoice() {
  return allVoices().some((v) => v.lang?.startsWith('hi'));
}

/** Split into sentence-sized chunks (≤ 250 chars) only when necessary. */
export function chunkSentences(text, max = 250) {
  const sentences = String(text || '').match(/[^.!?;]+[.!?;]*\s*/g) || [];
  const out = [];
  let cur = '';
  sentences.forEach((s) => {
    if ((cur + s).length > max && cur) { out.push(cur.trim()); cur = ''; }
    if (s.length > max) {
      s.split(/,\s*/).forEach((part) => {
        if ((cur + part).length > max && cur) { out.push(cur.trim()); cur = ''; }
        cur += `${part}, `;
      });
      cur = cur.replace(/,\s*$/, ' ');
    } else cur += s;
  });
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

let audioCtx = null;

/** Synchronously prime AudioContext and speech synthesis on user interaction */
export function initAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      audioCtx = audioCtx || new AC();
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch((e) => { void e; });
      }
    }
    if (window.speechSynthesis && window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
  } catch (err) {
    void err;
  }
}

/** A soft two-note chime before Aurora speaks (~0.4 s, quiet and pleasant). */
export function chime() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return Promise.resolve();
    audioCtx = audioCtx || new AC();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch((e) => { void e; });
    }
    const t0 = audioCtx.currentTime;
    [[659.25, 0], [880, 0.16]].forEach(([freq, at]) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + at);
      gain.gain.exponentialRampToValueAtTime(0.07, t0 + at + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.4);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + 0.45);
    });
    return new Promise((r) => setTimeout(r, 450));
  } catch (err) {
    console.warn('[Aurora] chime unavailable', err);
    return Promise.resolve();
  }
}

/** Plain text for speech: no markdown, symbols read as words. */
export function speakable(text) {
  return String(text || '').replace(/[*#_`]/g, '').replace(/CO₂/g, 'CO2').replace(/°C/g, ' degrees Celsius')
    .replace(/(\d)\s?kL\b/g, '$1 kilolitres').replace(/(\d)\s?L\/hr\b/g, '$1 litres per hour').replace(/(\d)\s?L\/h\b/g, '$1 litres per hour')
    .replace(/(\d)\s?kW\b/g, '$1 kilowatts').replace(/(\d)\s?km\/h\b/g, '$1 kilometres per hour').replace(/(\d)\s?hPa\b/g, '$1 hectopascals')
    .replace(/(\d)\s?ppm\b/g, '$1 parts per million').replace(/(\d)\s?dBm\b/g, '$1 dBm').replace(/σ/g, ' sigma').replace(/→/g, ' to ');
}

let currentAudio = null;
let currentSource = null;
let speakToken = 0;            // bumped by every speak()/stopSpeaking(): stale downloads never play
const TTS_TIMEOUT_MS = 9000;   // then fall back to the browser's own voices
const ttsCache = new Map();    // url → Promise<ArrayBuffer|null> (small, recent only)

function ttsUrl(said, lang, voiceName) {
  return `/api/assistant/tts?text=${encodeURIComponent(said)}&lang=${encodeURIComponent(lang)}&voice=${encodeURIComponent(voiceName || '')}`;
}

function fetchTts(url) {
  if (ttsCache.has(url)) return ttsCache.get(url);
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctrl?.abort(), TTS_TIMEOUT_MS);
  const p = fetch(url, { signal: ctrl?.signal })
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .catch((err) => { console.warn('[Aurora] server voice unavailable', err?.name || err); return null; })
    .finally(() => clearTimeout(timer));
  ttsCache.set(url, p);
  p.then((buf) => { if (!buf) ttsCache.delete(url); });
  if (ttsCache.size > 24) ttsCache.delete(ttsCache.keys().next().value);
  return p;
}

/** Start downloading the server voice for `text` now (e.g. while the chime plays). */
export function prefetchSpeech(text, { lang = 'en', voiceName = null } = {}) {
  const said = speakable(text);
  if (said.trim()) fetchTts(ttsUrl(said, lang, voiceName));
}

function playWithElement(buf, token, onStart) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    const a = new Audio(url);
    let done = false;
    const finish = (res) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      if (currentAudio === a) currentAudio = null;
      resolve(res);
    };
    a.onended = () => finish('ended');
    a.onerror = () => finish(null);
    a.onpause = () => { if (!a.ended) finish('cancelled'); };
    if (token !== speakToken) { finish('cancelled'); return; }
    currentAudio = a;
    a.play().then(() => onStart?.()).catch((err) => { console.warn('[Aurora] audio element blocked', err?.name || err); finish(null); });
  });
}

/**
 * Speak calmly and reliably.
 * 1. Uses Web Audio API with native server audio stream (/api/assistant/tts).
 *    This decodes raw PCM audio and plays directly through the browser's hardware output,
 *    guaranteeing 100% reliable sound with zero Chrome SpeechSynthesis freezes.
 *    (If the AudioContext cannot run, the same audio plays through an <audio> element.)
 * 2. Seamlessly falls back to browser Web Speech API with V8 GC protection.
 * Resolves when finished, cancelled, or timed out (never rejects).
 */
export async function speak(text, { rate = 0.92, pitch = 1, lang = 'en', voiceName = null, onStart } = {}) {
  stopSpeaking();
  const token = ++speakToken;

  const said = speakable(text);
  if (!said.trim()) return 'unsupported';

  // ── Step 1: Native server audio (High Quality) ──
  try {
    const raw = await fetchTts(ttsUrl(said, lang, voiceName));
    if (token !== speakToken) return 'cancelled';
    if (raw) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        audioCtx = audioCtx || new AC();
        if (audioCtx.state !== 'running') await audioCtx.resume().catch((e) => { void e; });
      }
      if (token !== speakToken) return 'cancelled';
      if (audioCtx && audioCtx.state === 'running') {
        const audioBuffer = await audioCtx.decodeAudioData(raw.slice(0));   // decode detaches its input
        if (token !== speakToken) return 'cancelled';
        return await new Promise((resolve) => {
          let resolved = false;
          const source = audioCtx.createBufferSource();
          const finishAudio = (res) => {
            if (resolved) return;
            resolved = true;
            if (currentSource === source) currentSource = null;
            resolve(res);
          };
          source.buffer = audioBuffer;
          source.connect(audioCtx.destination);
          currentSource = source;
          source.onended = () => finishAudio('ended');
          onStart?.();
          source.start(0);
          // Safety guard in case onended is delayed
          setTimeout(() => finishAudio('ended'), Math.round(audioBuffer.duration * 1000) + 500);
        });
      }
      // AudioContext suspended (no usable gesture yet): an <audio> element may still be allowed.
      const res = await playWithElement(raw, token, onStart);
      if (res) return res;
      if (token !== speakToken) return 'cancelled';
    }
  } catch (err) {
    console.warn('[Aurora] Native Web Audio TTS failed, falling back to Web Speech', err);
  }
  if (token !== speakToken) return 'cancelled';

  // ── Step 2: Fallback to Browser Web Speech API ──
  const synth = window.speechSynthesis;
  if (!synth) return 'unsupported';

  // Global window array to protect active utterances from Chromium V8 GC bugs (Chromium issue 679437)
  if (typeof window !== 'undefined') {
    window.__auroraUtterances = window.__auroraUtterances || [];
  }

  // Cancel any lingering queued/speaking utterances cleanly with a brief delay
  if (synth.speaking || synth.pending) {
    try {
      synth.cancel();
    } catch (e) { void e; }
    await new Promise((r) => setTimeout(r, 80));
  }

  await ensureVoices();

  const chunks = said.length <= 350 ? [said] : chunkSentences(said, 250);
  if (!chunks.length) return 'unsupported';

  const v = pickVoice(lang, voiceName);
  const targetLang = v?.lang || (lang === 'hi' ? 'hi-IN' : 'en-US');

  return new Promise((resolve) => {
    let resolved = false;
    let resumeTimer = null;
    let currentIndex = 0;

    const guardMs = Math.max(30000, 6000 + Math.round((said.length * 150) / (rate || 0.9)));
    const guard = setTimeout(() => {
      try { synth.cancel(); } catch (e) { void e; }
      finish('timeout');
    }, guardMs);

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(guard);
      if (resumeTimer) clearTimeout(resumeTimer);
      if (typeof window !== 'undefined' && window.__auroraUtterances) {
        window.__auroraUtterances.length = 0;
      }
      resolve(result);
    };

    const checkResume = () => {
      if (resolved) return;
      if (!synth.speaking && !synth.pending) {
        // finished or empty
      } else {
        if (synth.paused) {
          try { synth.resume(); } catch (e) { void e; }
        }
        resumeTimer = setTimeout(checkResume, 250);
      }
    };
    resumeTimer = setTimeout(checkResume, 250);

    const speakChunk = (idx) => {
      if (idx >= chunks.length) {
        finish('ended');
        return;
      }
      const chunkText = chunks[idx];
      const u = new window.SpeechSynthesisUtterance(chunkText);
      if (typeof window !== 'undefined' && window.__auroraUtterances) {
        window.__auroraUtterances.push(u);
      }

      if (v) {
        u.voice = v;
        u.lang = v.lang;
      } else {
        u.lang = targetLang;
      }
      u.rate = Math.max(0.7, Math.min(1.3, rate));
      u.pitch = pitch;
      u.volume = 1;

      if (idx === 0) {
        u.onstart = () => onStart?.();
      }

      u.onend = () => {
        if (typeof window !== 'undefined' && window.__auroraUtterances) {
          const pos = window.__auroraUtterances.indexOf(u);
          if (pos !== -1) window.__auroraUtterances.splice(pos, 1);
        }
        currentIndex++;
        speakChunk(currentIndex);
      };

      u.onerror = (e) => {
        if (e.error !== 'interrupted' && e.error !== 'canceled') {
          console.warn('[Aurora] speech synthesis error', e.error);
        }
        finish('error');
      };

      try {
        if (synth.paused) synth.resume();
        synth.speak(u);
      } catch (err) {
        console.warn('[Aurora] speak invocation error', err);
        finish('error');
      }
    };

    speakChunk(0);
  });
}

export function stopSpeaking() {
  try {
    if (currentSource) {
      try { currentSource.stop(); } catch (e) { void e; }
      currentSource = null;
    }
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }
    if (typeof window !== 'undefined' && window.__auroraUtterances) {
      window.__auroraUtterances.length = 0;
    }
    window.speechSynthesis?.cancel();
  } catch (err) {
    console.warn('[Aurora] could not stop speech', err);
  }
}

/**
 * A recogniser. `continuous` keeps listening across pauses (conversation mode / push-to-talk).
 * Callbacks: onInterim(text), onFinal(text), onEnd(), onError(code).
 */
export function createRecognizer({ lang = 'en', continuous = false, onInterim, onFinal, onEnd, onError }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = LANGS[lang] || 'en-IN';
  rec.interimResults = true;
  rec.continuous = continuous;
  rec.maxAlternatives = 1;
  rec.onresult = (ev) => {
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
      const r = ev.results[i];
      if (r.isFinal) onFinal?.(r[0].transcript.trim());
      else interim += r[0].transcript;
    }
    onInterim?.(interim.trim());
  };
  rec.onerror = (ev) => {
    if (ev.error !== 'no-speech' && ev.error !== 'aborted') console.warn('[Aurora] speech recognition error', ev.error);
    onError?.(ev.error);
  };
  rec.onend = () => onEnd?.();
  return rec;
}

/** Human text for a recognition error code. */
export function recognitionErrorText(code) {
  if (code === 'not-allowed' || code === 'service-not-allowed') return 'Microphone access was blocked. Allow it in the browser, or type instead.';
  if (code === 'audio-capture') return 'No microphone was found. Type your request instead.';
  if (code === 'network') return 'Speech recognition needs the browser vendor’s service, which is unreachable. Type instead.';
  if (code === 'language-not-supported') return 'This language is not supported for voice input here.';
  return null;
}
