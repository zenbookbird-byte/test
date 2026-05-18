# Gameplay Integrity Analyzer

A heuristic, **video-only** screening tool for gameplay footage. It analyses a
clip and reports statistical anomalies associated with input automation and
aim assistance:

- **Recoil flatness** — recoil compensation that is unnaturally smooth and/or
  periodic, as produced by a "no-recoil" macro.
- **Aim snaps** — fast view movements, and whether they land immediately
  before a shot (**snap-to-fire**).
- **Reaction-time proxy** — the gap between the engaging flick and the first
  shot of a burst.

It produces an annotated figure, an HTML report, and machine-readable JSON.

## What this is — and what it is NOT

This is a **screening aid for human review**. It points a reviewer at moments
worth watching. It is **not** proof of cheating, and it does not claim to be.

Aim assist (controller rotational aim assist especially), genuinely skilled
play, recording/compression artifacts, streaming overlays, and miscalibrated
sensitivity settings can all mimic these signals. A clip can score "MODERATE"
or "HIGH" for entirely innocent reasons.

**Use it responsibly:**

- Treat the output as "moments to review by hand", never as a verdict.
- Do not publish named accusations based on this tool. That can constitute
  harassment or defamation — and it is the single most common way tools like
  this get misused.
- The defensible workflow is: analyse footage, review the flagged moments
  yourself, and if warranted, file a report through the game's **official**
  channels (in-game report, publisher support) with the raw clip attached.
- The strongest, lowest-risk use is analysing footage of **consenting**
  players — e.g. a tournament organiser or team coach screening their own
  roster or event entrants.

## Why video-only analysis is limited

Real anti-cheat sees memory, raw input, and server-side data. This tool sees
only pixels. Consequences:

- A view movement faster than roughly half the frame width per frame cannot
  be measured at all — it registers as a low-confidence frame.
- Controller aim assist legitimately produces snappy, sticky aiming.
- There is no ground truth: the score is a heuristic, not a calibrated
  probability.

Take these limits seriously before relying on, or charging for, any output.

## Install

```sh
pip install -r requirements.txt
```

Requires Python 3.9+, OpenCV, NumPy and Matplotlib.

## Usage

Analyse a video file:

```sh
python -m gianalyzer analyze path/to/clip.mp4 -o output/analysis
```

Useful options: `--fov` (horizontal field of view in degrees, game-dependent),
`--fire-roi X0 Y0 X1 Y1` (muzzle-flash region as frame fractions),
`--fire-threshold`, `--snap-threshold`, `--stride`, `--work-width`.

Run the built-in demo — it synthesises a "clean" clip and a "macro" clip, then
analyses both so you can see the tool discriminate without supplying footage:

```sh
python -m gianalyzer demo -o output/demo
```

Generate a single synthetic clip:

```sh
python -m gianalyzer synth --profile macro -o output/clip.mp4
```

## Output

Each analysis writes to its output directory:

- `figure.png` — angular-velocity timeline, aim-speed with snap events,
  per-burst recoil anomaly, and the reaction-time distribution.
- `report.html` — a self-contained report (embeds the figure).
- `report.json` — full metrics for downstream tooling.
- `report.txt` — a plain-text summary.

## How it works

1. **Motion** — each frame pair is reduced to a single global translation via
   FFT phase correlation on the non-HUD band; this is converted to view
   angular velocity (yaw/pitch in deg/s) using the configured field of view.
2. **Firing** — mean brightness inside the muzzle-flash ROI is compared to a
   rolling-median baseline; spikes are grouped into bursts.
3. **Metrics** — per burst, recoil smoothness (frame-to-frame jitter relative
   to amplitude) and periodicity (autocorrelation); per engagement, snap
   detection and snap-to-fire correlation; a reaction-time proxy.
4. **Score** — a weighted, clamped 0–100 heuristic. Weights are defined and
   documented in `gianalyzer/metrics.py` so they can be audited and tuned.

## Project layout

```
gianalyzer/
  config.py    tunable parameters
  video.py     video input
  signals.py   per-frame motion + firing-brightness extraction
  metrics.py   anomaly metrics and scoring
  report.py    figure / HTML / JSON / text rendering
  synth.py     synthetic clip generator (demo + tests)
  cli.py       command-line interface
```
