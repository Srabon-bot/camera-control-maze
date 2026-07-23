# Ritual Corridor — hand-sign maze wander

A third-person 3D "camera room": a mage is lost in a cursed labyrinth and
slowly finds their way out, controlled entirely by hand signs read from your
webcam. Same pipeline as every other room in the gallery — **noisy signal →
threshold → cooldown → feedback** — wearing a game costume.

The maze is a proper generated labyrinth (randomized-DFS "perfect maze" —
exactly one path between any two points, real dead ends, real branches).
Walk it one corridor-length at a time; at each junction the open paths
(left/right/straight) are shown as they come into view, and you steer with
hand signs. Take a wrong branch and you'll dead-end — the mage automatically
turns about-face there so you can walk back out and try another way. There's
no fail state, no clock: the only goal is finding the exit.

## Controls (all discrete hand signs, no keyboard)

| Sign | Pose | Effect |
|---|---|---|
| **Walk** | open palm, all 4 fingers extended, facing camera | sustain — mage walks while held |
| **Stop** | close the hand (fist) | releases walk — eases back to idle |
| **Left** | one hand, index finger up, others curled | momentary — turns onto the left path at the next junction, if one's open |
| **Right** | one hand, V-sign (index + middle up, others curled) | momentary — turns onto the right path at the next junction, if one's open |
| **Divine / hint** | both hands raised up | only works during a periodic "the way is unclear" window (watch for the glyph) — the mage performs a divination and Gemini writes a one-line hint toward the exit. Outside that window it's just the flourish. |

If a junction only opens left/right (no way straight), the mage pauses there
until you pick one — no penalty, just waits. Reach the exit and Gemini writes
a short closing "escape" line.

The Sign Lab panel (right side) is always visible and live: signal graph,
per-finger ratios, Teach Mode (hold a sign 3s to calibrate it to *your*
hand/webcam/lighting), and sliders for sensitivity/confirm-frames/cooldown/
smoothing/particle density. Tune it the deck's way: push both extremes,
binary-search the middle, leave the sliders live.

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
works too — the divination hint will still work, just falls back to a canned
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
- `assets/audio/` is empty. Drop in `drone.mp3` (ambient loop, rises in
  tension while a hint window is open), `thrum.mp3` (loops while a sign is
  being held), and `whoosh.mp3` (divination cast) — `audio.js` picks them up
  automatically. Until then, everything is synthesized on the fly so the
  room still has sound.
- `assets/mediapipe/hand_landmarker.task` is self-hosted (not fetched from
  Google's CDN at runtime) so a flaky network can't kill the room mid-demo.

## Deploy

Push to GitHub, then `vercel` (or "deploy this to Vercel through GitHub" via
Vercel's dashboard import). Don't forget step 3 above — the deployed link
won't get incantations without the env var set in Vercel itself.
