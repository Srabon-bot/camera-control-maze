# Ritual Corridor — hand-sign mage runner

A third-person 3D "camera room": a mage advances through a spooky corridor,
controlled entirely by hand signs read from your webcam. Same pipeline as
every other room in the gallery — **noisy signal → threshold → cooldown →
feedback** — wearing a game costume.

## Controls (all discrete hand signs, no keyboard)

| Sign | Pose | Effect |
|---|---|---|
| **Run** | open palm, all 4 fingers extended, facing camera | sustain — mage runs while held, eases to idle on release |
| **Left** | index finger only, pointing left | momentary — one lane-shift, short cooldown |
| **Right** | index finger only, pointing right | momentary — one lane-shift, short cooldown |
| **Turn / banish** | both hands clasped together | rare, longer cooldown — mage whirls, bursts a banishing spell. If a shadow-wisp is currently stalking you from behind (watch for the warning), this banishes it and Gemini writes a one-line incantation on screen. If nothing's stalking you, it's just the flourish. |

Dodge obstacle gates by being in the open lane when they reach you. Get
caught by the stalker 3 times (or hit 3 gates) and the run ends — Gemini
writes a short closing "verdict" line.

The Sign Lab panel (right side) is always visible and live: signal graph,
per-finger ratios, Teach Mode (hold a sign 3s to calibrate it to *your*
hand/webcam/lighting), and sliders for sensitivity/confirm-frames/cooldown/
smoothing/deadzone/particle density. Tune it the deck's way: push both
extremes, binary-search the middle, leave the sliders live.

## Run it locally

No bundler needed for the frontend (plain ES modules + import maps), but the
Gemini bonus feature needs the `/api/gemini` serverless function, which only
runs under Vercel's dev server:

```
npm i -g vercel      # once
vercel dev
```

Then open the printed local URL and click "enter the corridor" (grants
camera access).

If you just want to test the frontend without the Gemini bonus, `npx serve .`
works too — turn-around will still work, just falls back to a canned
incantation line instead of a live Gemini one.

## Gemini API key

1. Get a free key at **aistudio.google.com** → left sidebar "Get API key" →
   "Create API key" → copy it.
2. Locally: put it in a `.env` file (copy `.env.example`) —
   `GEMINI_API_KEY=your-key-here`. This file is gitignored; it never gets
   committed and never reaches the frontend.
3. On Vercel (for the deployed link): Project Settings → Environment
   Variables → add `GEMINI_API_KEY` there too — `.env` does **not**
   auto-deploy.

## Assets

- `assets/models/mage.glb` is currently three.js's own **Soldier.glb** demo
  rig (idle/run/walk animations, MIT-licensed example asset) — a stand-in so
  the room runs end to end today. Swap in a real animated mage: export a
  GLTF with clips literally named `Idle` and `Run` (that's all `mage.js`
  looks for) and drop it in at the same path.
- `assets/audio/` is empty. Drop in `drone.mp3` (ambient loop),
  `thrum.mp3` (loops while a sign is being held), `whoosh.mp3` (turn-around
  cast), and `hit.mp3` (caught by the stalker) — `audio.js` picks them up
  automatically. Until then, everything is synthesized on the fly so the
  room still has sound.
- `assets/mediapipe/hand_landmarker.task` is self-hosted (not fetched from
  Google's CDN at runtime) so a flaky network can't kill the room mid-demo.

## Deploy

Push to GitHub, then `vercel` (or "deploy this to Vercel through GitHub" via
Vercel's dashboard import). Don't forget step 3 above — the deployed link
won't get incantations without the env var set in Vercel itself.
