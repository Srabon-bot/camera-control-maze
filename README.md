# Ritual Corridor — hand-sign maze wander

A top-down "camera room": a token wanders a cursed labyrinth, controlled
entirely by hand signs read from your webcam. Same pipeline as every other
room in the gallery — **noisy signal → threshold → cooldown → feedback** —
wearing a game costume.

The maze is a proper generated labyrinth (randomized-DFS "perfect maze" —
exactly one path between any two points, real dead ends, real branches), a
sizeable 15×15 grid drawn in full on a 2D canvas so the whole layout is
visible at once. Your token slides cell to cell as you hold the walk sign,
turning at junctions when you sign a direction. Reverse course any time you
like: dead ends auto-turn you around, and you can also turn around
voluntarily wherever you are. There's no fail state, but there is a clock:
it starts the moment you enter, and reaching the exit faster is worth more
points — a live timer runs in the HUD, and your score (weighted toward
speed) is revealed on the win screen.

## Controls (all discrete hand signs, no keyboard)

| Sign | Pose | Effect |
|---|---|---|
| **Walk** | open palm, all 4 fingers extended, facing camera | sustain — token advances cell-to-cell while held |
| **Stop** | close the hand (fist) | releases walk — token pauses at the current cell |
| **Left** | one hand, index finger up, others curled | momentary — immediately turns onto the left path from the current cell, if one's open |
| **Right** | one hand, V-sign (index + middle up, others curled) | momentary — immediately turns onto the right path from the current cell, if one's open |
| **Back** | one hand, three fingers up (index + middle + ring, pinky curled) | reverses your heading and steps back into the cell you just came from — works anywhere, not just at dead ends. Useful for regretting a branch. |

Left/right/back all act the instant you sign them — you don't need to be
holding walk at the same time (in fact you can't: they're all single-hand
poses, so briefly drop the walk pose to sign one, then resume walking). If a
junction only opens left/right (no way straight), the token just waits there
until you pick one — no penalty. Reach the exit and Gemini writes a short
closing "escape" line.

The Sign Lab panel (right side) is always visible and live: signal graph,
per-finger ratios, Teach Mode (hold a sign 3s to calibrate it to *your*
hand/webcam/lighting), and sliders for sensitivity/confirm-frames/cooldown/
smoothing. Tune it the deck's way: push both extremes, binary-search the
middle, leave the sliders live.

## Run it locally

No bundler needed for the frontend (plain ES modules + import maps), but the
Gemini bonus feature needs the `/api/gemini` serverless function, which only
runs under Vercel's dev server:

```
npm i -g vercel      # once
vercel dev
```

Then open the printed local URL and click "enter the maze" (grants camera
access).

If you just want to test the frontend without the Gemini bonus, `npx serve .`
works too — the escape line will still work, just falls back to a canned
line instead of a live Gemini one.

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

- `assets/audio/` is empty. Drop in `drone.mp3` (ambient loop), `thrum.mp3`
  (loops while a sign is being held), and `whoosh.mp3` (back-turn cast) —
  `audio.js` picks them up automatically. Until then, everything is
  synthesized on the fly so the room still has sound.
- `assets/mediapipe/hand_landmarker.task` is self-hosted (not fetched from
  Google's CDN at runtime) so a flaky network can't kill the room mid-demo.

## Deploy

Push to GitHub, then `vercel` (or "deploy this to Vercel through GitHub" via
Vercel's dashboard import). Don't forget step 3 above — the deployed link
won't get an escape line without the env var set in Vercel itself.
