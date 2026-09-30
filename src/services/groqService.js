/* ═══════════════════════════════════════════════════════════════
   Aurora v3 — Groq LLM Service (Decision-Aware)
   Routes ALL Groq requests through the simulator backend.
   The API key lives ONLY on the server, never in the browser.
   
   Phase 6 Architecture:
     React → /api/aurora-explain → Decision JSON → Groq → Response
   ═══════════════════════════════════════════════════════════════ */

const AI_SERVICE_URL = 'http://localhost:8001';

/**
 * Ask Aurora to explain the current decision state.
 * Uses the new /api/aurora-explain endpoint which feeds validated
 * decision JSON to Groq. The LLM explains — it doesn't invent.
 *
 * @param {string} questionType - "status" | "why" | "action" | "detail"
 * @param {string} station - "maitri" | "bharati"
 * @param {string} freeText - Optional free-text question
 * @returns {Promise<object>} { explanation, sources, riskLevel, event, provenance }
 */
export async function askAurora(questionType = 'status', station = 'maitri', freeText = '') {
  try {
    const response = await fetch(`${AI_SERVICE_URL}/api/aurora-explain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: questionType, station, freeText }),
    });

    if (!response.ok) {
      console.warn('[Aurora] Backend returned', response.status);
      return { explanation: 'Unable to process request at this time.', sources: [] };
    }

    return await response.json();
  } catch (err) {
    console.warn('[Aurora] Backend request failed:', err.message);
    return { explanation: 'Connection to Aurora AI service failed.', sources: [] };
  }
}

/**
 * Legacy wrapper — ask the AI backend to explain structured station data.
 * Now sends station ID to avoid Bharati→Maitri mismatch.
 * @param {string} userQuery - The user's question
 * @param {object} context - Structured data to ground the response
 * @param {string} station - Station ID (maitri/bharati)
 * @returns {Promise<string>} Natural language response
 */
export async function askGroq(userQuery, context = {}, station = 'maitri') {
  try {
    const response = await fetch(`${AI_SERVICE_URL}/api/explain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: userQuery, context, station }),
    });

    if (!response.ok) {
      console.warn('[Groq] Backend returned', response.status);
      return 'Unable to process request at this time.';
    }

    const data = await response.json();
    return data.explanation || data.response || 'No response generated.';
  } catch (err) {
    console.warn('[Groq] Backend request failed:', err.message);
    return 'Connection to AI service failed.';
  }
}

/**
 * Generate an incident narrative from structured incident data.
 * @param {object} incident - Incident object from the decision engine
 * @param {string} station - Station ID
 * @returns {Promise<string>} Human-readable incident narrative
 */
export async function explainIncident(incident, station = 'maitri') {
  try {
    const response = await fetch(`${AI_SERVICE_URL}/api/explain/incident`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ incident, station }),
    });

    if (!response.ok) return 'Unable to generate incident narrative.';
    const data = await response.json();
    return data.explanation || 'No explanation available.';
  } catch (err) {
    return 'Connection to AI service failed.';
  }
}

/**
 * Generate a station status briefing.
 */
export async function getStatusBriefing(stationName, sensors, alerts, incidents = []) {
  const station = stationName.toLowerCase().includes('bharati') ? 'bharati' : 'maitri';
  return askGroq(
    `What is the current status of ${stationName}? Give a brief operational summary.`,
    {
      station: stationName,
      sensors,
      alerts,
      incidents: incidents.map(i => ({ title: i.title, risk: i.riskLevel, affected: i.affectedCount })),
    },
    station,
  );
}
