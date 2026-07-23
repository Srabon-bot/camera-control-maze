// Vercel serverless function — the ONLY place GEMINI_API_KEY is read.
// Frontend never sees the key; it just posts { kind, context } here.
//
// Local dev: `vercel dev` (plain `npx serve .` won't run this route).
// Deploy: set GEMINI_API_KEY in Vercel's Environment Variables — .env
// values do not auto-deploy, per the workshop's own warning.

const MODEL = "gemini-2.0-flash";

const PROMPTS = {
  verdict: (ctx) =>
    `You are the narrator of a short spooky maze-wandering game called "Ritual Corridor". ` +
    `The player just found their way out of the cursed labyrinth after wandering ${Math.round(ctx?.distance ?? 0)} cells. ` +
    `Write ONE short, eerie-but-triumphant closing line about their escape. ` +
    `Max 15 words. No quotation marks, no explanation, just the line.`,
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "GEMINI_API_KEY not configured on the server" });
    return;
  }

  const { kind, context } = req.body || {};
  const buildPrompt = PROMPTS[kind];
  if (!buildPrompt) {
    res.status(400).json({ error: `unknown kind: ${kind}` });
    return;
  }

  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(context) }] }],
          generationConfig: { maxOutputTokens: 40, temperature: 0.9 },
        }),
      }
    );

    if (!upstream.ok) {
      res.status(502).json({ error: `gemini upstream ${upstream.status}` });
      return;
    }

    const data = await upstream.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    res.status(200).json({ text });
  } catch (err) {
    res.status(502).json({ error: "gemini call failed" });
  }
}
