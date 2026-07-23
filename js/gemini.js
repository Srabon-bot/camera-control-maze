// Frontend side of "sensor -> threshold -> AI call -> response on screen."
// The key never lives here — this just calls our own /api/gemini
// serverless function, which holds GEMINI_API_KEY server-side.

const MIN_CALL_INTERVAL_MS = 4000; // cooldown on the AI call itself, same
// principle as the sign cooldowns: a confirmed event can still fire faster
// than we want to spend quota on.
let lastCallAt = 0;

const FALLBACK_INCANTATIONS = [
  "the dark folds back, if only for a breath.",
  "something unseen loses its grip.",
  "the corridor exhales.",
  "a name unsaid is enough to banish it.",
];
const FALLBACK_VERDICTS = [
  "the corridor keeps what it catches.",
  "not far enough, not fast enough.",
  "the dark remembers your face now.",
];

function fallback(list) {
  return list[Math.floor(Math.random() * list.length)];
}

async function callGemini(kind, context) {
  const res = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, context }),
  });
  if (!res.ok) throw new Error(`gemini proxy ${res.status}`);
  const data = await res.json();
  return data.text;
}

export async function requestIncantation(context) {
  const now = performance.now();
  if (now - lastCallAt < MIN_CALL_INTERVAL_MS) return null; // let the fallback flavor carry it
  lastCallAt = now;
  try {
    return await callGemini("incantation", context);
  } catch (e) {
    return fallback(FALLBACK_INCANTATIONS);
  }
}

export async function requestVerdict(context) {
  try {
    return await callGemini("verdict", context);
  } catch (e) {
    return fallback(FALLBACK_VERDICTS);
  }
}
