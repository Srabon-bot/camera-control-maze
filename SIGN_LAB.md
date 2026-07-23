# Sign Lab — the debug/tuning panel

This describes the `<aside id="sign-lab">` panel (`index.html:68-119`) that sits
docked to the right side of the screen at all times during play, plus the
webcam thumbnail + manual pose buttons next to it (`index.html:56-65`), which
are really the same debug system's "manual override" half. Together they
exist so you (or anyone demoing the room) can see exactly what the hand
tracker is reading, in real time, instead of the gesture recognition being an
opaque black box.

Everything in this document is driven by four files:

- `js/handTracking.js` — MediaPipe hand landmarks → per-hand numeric features
- `js/signPipeline.js` — features → pose scores → debounced sign events
- `js/signLabPanel.js` — wires all of the above to the DOM elements below
- `js/teachMode.js` — the calibration ("Teach Mode") logic

## 1. Webcam thumbnail + skeleton overlay (`#cam-thumb`)

A small 220×165 canvas (`#cam-overlay`) in the bottom-left corner. Every time
new hand-tracking results come in, `SignLabPanel._drawCamOverlay()`
(`js/signLabPanel.js:120`) draws:

- the current webcam frame, mirrored horizontally (so raising your right
  hand shows on the right side of the thumbnail, matching what you feel like
  you're doing rather than a true camera mirror image)
- a teal skeleton over each detected hand: 21 MediaPipe landmark points
  connected by the standard hand "bones" (`HAND_CONNECTIONS` at the top of
  `signLabPanel.js`) — knuckles, finger segments, and the palm

If you see no skeleton, MediaPipe isn't detecting a hand at all (lighting,
framing, or distance problem) — that's a tracking issue, upstream of
everything else in this document.

## 2. Manual pose buttons (`.pose-buttons`, under the thumbnail)

Four buttons: 🖐️ run, ☝️ left, ✌️ right, 3️⃣ back. These are a **QA override**,
not a display — holding one down (`mousedown`/`touchstart`) calls
`pipeline.setManualPose(pose, true)` (`js/signLabPanel.js:77-93`), which
forces the sign pipeline to report that pose as the dominant one at a
confidence of 1.0, regardless of what the camera actually sees. Releasing
the button clears it. This lets you test or demo the maze (turning, walking,
backing up) with mouse clicks alone, with no hand or camera involved —
useful for confirming the *game* logic is fine when you're not sure the
*gesture* is being read correctly, or vice versa.

## 3. SIGNAL block — dominant channel + live graph

```
SIGNAL: <dominant-channel>
[ scrolling line graph ]
```

- **`#dominant-channel`** — the name of whichever pose currently has the
  highest score (`run` / `left` / `right` / `back` / `neutral`).
- **`#signal-graph`** (`js/signLabPanel.js:156-194`) — a scrolling strip chart
  of that dominant pose's score over the last 150 frames (0.0 at the bottom,
  1.0 at the top), redrawn every animation frame regardless of whether new
  camera data arrived. A dashed red horizontal line marks that pose's current
  `enterThreshold` — the score has to rise above that line before the pose
  starts counting as "held." Watching this line is the fastest way to see
  *why* a sign isn't registering: if your peak barely reaches the dashed
  line, the pose is being read correctly but too weakly (bad angle, poor
  lighting, hand too far from camera) — turn up sensitivity or re-teach it,
  rather than assuming the code is broken.

## 4. TEACH MODE block — per-user calibration

```
🖐 TEACH MODE — perform the sign, we learn your hand
[run] [left] [right] [back]
hold the sign 3s to sample · run:0 · left:0 · right:0 · back:0
[💾 save profile]
```

Clicking one of the four teach buttons calls `teachMode.start(poseId)`
(`js/teachMode.js:26`), which samples that pose's raw score for 3 seconds
(`SAMPLE_MS`) while you hold the real gesture in front of the camera. When
the sample window ends, `TeachMode._finishSampling()` averages the collected
scores and calls `pipeline.applyTaughtThreshold(poseId, mean)`
(`js/signPipeline.js:257-263`), which sets that pose's `enterThreshold` to
**78% of your average held score** — low enough that your actual hand,
lighting, and camera angle reliably clear the bar, but not so low that other
poses start false-triggering it. The button glows red (`.sampling` class,
pulsing) while a sample is actively being collected.

- **`#teach-samples`** — a running count of how many times each pose has
  been (re-)calibrated this session (`run:N · left:N · right:N · back:N`).
- **`#teach-save`** (💾 save profile) — calls `teachMode.save()`
  (`js/teachMode.js:41-54`), which writes the full tuned profile (all
  per-pose thresholds/cooldowns plus the global smoothing value) to
  `localStorage` under the key `ritual-corridor.signProfile.v1`. This is
  what makes calibration persist across page reloads — without clicking
  save, a fresh Teach Mode session is lost the moment you refresh. On boot,
  `TeachMode._loadFromStorage()` (`js/teachMode.js:78-86`) silently restores
  whatever was last saved, if anything.

## 5. SIGN LAB block — live numeric read

```
✎ SIGN LAB — live read
T0.00  I0.00✗  M0.00✗  R0.00✗  P0.00✗
pinch 0.00 · angle 0° · hands 0
pose: neutral
🖐️ ☝️ ✌️ 3️⃣ ✊
```

All of this comes straight from `SignLabPanel._onFeatures()`
(`js/signLabPanel.js:102-118`), reading the first detected hand's raw
features as computed in `js/handTracking.js:19-66`:

- **`#finger-readout`** — one letter per digit (**T**humb, **I**ndex,
  **M**iddle, **R**ing, **P**inky) followed by its *extension ratio*:
  fingertip-to-wrist distance divided by knuckle-to-wrist distance. A curled
  finger scores close to 1.0 or below; a fully extended finger scores well
  above 1.2. Index/middle/ring/pinky each get a ✓/✗ against the 1.2 "is this
  finger extended" line every pose-scoring function in `signPipeline.js`
  actually uses — so this readout shows you, digit by digit, exactly what
  the classifier sees before it ever gets to naming a pose. Thumb has no
  ✓/✗ because no pose currently keys off thumb extension.
- **`#pinch-readout`** — three numbers:
  - `pinch` — thumb-tip-to-index-tip distance, normalized by palm width.
    Not currently used by any pose (no pinch gesture is defined), but left
    visible since it's a common gesture building block if you add one later.
  - `angle` — the direction the index finger points in screen space (0° =
    straight up, positive = toward the camera-right / your own right, since
    the read is already mirror-corrected). Also currently unused by scoring,
    shown for the same reason as pinch.
  - `hands` — how many hands MediaPipe currently sees (0, 1, or 2). Handy
    for confirming a second hand drifting into frame isn't the reason a
    one-hand pose (left/right/back) is misreading — see `bestHandScore()`
    in `signPipeline.js:126-133`, which deliberately scores every visible
    hand and keeps the best match specifically to guard against this.
- **`#pose-readout`** and the **pose-emoji row** — both mirror
  `pipeline.lastClassification.dominant`, i.e. whichever pose currently
  scores highest (see §6 below for exactly how "dominant" is decided). The
  matching emoji lights up gold and grows slightly; the rest stay dim. This
  is the single fastest glance to answer "what does the game currently think
  my hand is doing."

## 6. How a pose gets picked and turned into a game action

Not a DOM element, but the logic every readout above is a window into
(`js/signPipeline.js:185-201`, `205-282`):

1. **Scoring** — every frame, four scoring functions each look at the finger
   ratios and produce a 0–1 "how much does this look like my pose" score:
   `openPalmScore` (run — all four fingers extended), `indexUpScore` (left —
   only index extended), `vSignScore` (right — index + middle extended,
   ring/pinky curled), `threeUpScore` (back — index/middle/ring extended,
   pinky curled).
2. **Dominance** — whichever pose scores highest becomes `dominant`, but
   only if it clears a 0.15 floor; below that, `dominant` is `"neutral"` and
   *no* channel is allowed to progress that frame (`signPipeline.js:192-199`)
   — this is what stops a low-confidence flicker on one channel from
   competing with a low-confidence flicker on another.
3. **Smoothing** — the dominant channel's score gets exponentially smoothed
   frame to frame by `smoothingAlpha` (the ADVANCED panel's "smoothing α"
   slider) before anything else happens to it.
4. **Threshold → debounce → cooldown** — each pose is a `SignalChannel`
   (`js/signPipeline.js:12-116`) that only "fires" once the smoothed score
   clears `enterThreshold` for `confirmFrames` in a row. `run` is a
   *sustain*-mode channel (fires `sign:sustainstart`/`sign:sustainend` while
   held, with a separate lower `exitThreshold` so it doesn't chatter at the
   edge). `left`/`right`/`back` are *trigger*-mode channels (fire
   `sign:fire` once, then ignore input for `cooldownMs` so one hold can't
   machine-gun repeat actions).
5. **Game reaction** — `js/main.js` listens for those `sign:fire`/
   `sign:sustainstart`/`sign:sustainend` events and calls into `Maze`
   (`requestTurn("left"/"right")`, `requestTurnAround()`, or sets
   `maze.running`).

## 7. ADVANCED block — thresholds & feel

```
▶ ADVANCED — thresholds & feel
sensitivity     [——●———]  1.00
confirm frames  [———●——]  4
cooldown (ms)   [——●———]  450
smoothing α     [———●——]  0.35
```

A `<details>` element (open by default), four sliders, each wired in
`SignLabPanel._wireSliders()` (`js/signLabPanel.js:42-57`) to emit a
`tuning:update` event that `SignPipeline.applyTuning()`
(`js/signPipeline.js:225-251`) applies live — no page reload, no re-teach
needed to feel the effect:

| Slider | Range | What it actually changes |
|---|---|---|
| **sensitivity** | 0.5–1.5 | Scales every pose's `enterThreshold` *inversely*: above 1.0 makes every sign easier to trigger (lower bar), below 1.0 makes them all stricter. Applied on top of whatever Teach Mode already calibrated, clamped to 0.15–0.95 so it can't be tuned into "always on" or "never on." |
| **confirm frames** | 1–10 | How many consecutive above-threshold frames `left`/`right`/`back` need before firing. Lower = snappier but more prone to firing on a brief accidental shape; higher = more deliberate, slower to respond. (Doesn't affect `run`, which has its own separate hold/release confirm counts.) |
| **cooldown (ms)** | 100–2000 | How long `left`/`right`/`back` refuse to re-fire immediately after firing once — the "can't machine-gun the same turn" guard. |
| **smoothing α** | 0.05–1.0 | The exponential-smoothing weight applied to the dominant pose's score every frame (`smoothed += α * (raw - smoothed)`). Low α = heavily smoothed, laggy but very stable against jitter; high α (near 1.0) = reacts almost instantly to the raw per-frame score, but jitter passes straight through. |

The intended workflow (mentioned in the README) is: push a slider to both
extremes to see the effect clearly, then binary-search toward the middle for
whatever feels right for your camera/lighting, leaving the panel open the
whole time so you can watch the SIGNAL graph and pose readout react live.
