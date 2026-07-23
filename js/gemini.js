// Frontend side of "sensor -> threshold -> AI call -> response on screen."
// The key never lives here — this just calls our own /api/gemini
// serverless function, which holds GEMINI_API_KEY server-side.

const FALLBACK_VERDICTS = [
  "the labyrinth opens its hand, and lets you go.",
  "the dark remembers your face, but the way out remembers it too.",
  "free — for now, and for whatever that's worth down here.",
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

export async function requestVerdict(context) {
  try {
    return await callGemini("verdict", context);
  } catch (e) {
    return fallback(FALLBACK_VERDICTS);
  }
}
