# Firefox glass-copy follow-up — 3 November 2026

Dense rain now rasterizes its original strokes in small tiles before the glass samples the sky. This reduces the measured Firefox upload bottleneck without reducing particle counts, resolution, opacity bands, lighting, refraction or the animation setting. The strongest matched improvement is freezing rain: **33.7 → 41.7 draws/s**, using the medians of three twelve-second desktop/day pairs. Ordinary rain was already fast in these matched baselines and remained around 40 draws/s; this pass does not establish another average-FPS gain for ordinary rain.

This follows the [rain-layer optimization](firefox-rain-performance-2026-11-03.md). The baseline here includes both earlier performance passes. All changes remain local; Home Assistant has not been updated.

## Implementation and scope

Fine-grained timing located the wait at the **sky texture upload into WebGL**. The final WebGL-to-2D copy and panel copies generally took 0–1 ms. Moving work to another canvas or an asynchronous callback merely moved the wait, so those variants were rejected.

`RainPath` partitions each opacity band's unchanged line segments into 256 × 256 device-pixel regions. A reusable 258 × 258 canvas includes a one-pixel gutter. Intersecting streaks remain together in each native path; integer-pixel copies assemble the complete rain layer. The extra RGBA surface is about **266 KB**, independent of card size, and is released for hidden, dry, still and untiled scenes. The existing full-resolution far-rain layer is retained.

The tiled path is enabled only for **Firefox's rain, heavyRain and freezingRain presets**. Chromium and WebKit retain their original paths. So do other weather presets: a broader prototype increased Chrome's work and slowed hurricane rain, so it was rejected. The final hurricane checks return approximately 41 draws/s on desktop, phone and tablet layouts. No weather appearance or quality setting is reduced to select the faster renderer.

## Matched measurements

Normal-window Firefox 157, Chrome 156 and WebKit 27.2 on the development laptop. These are viewport profiles, not physical phone or tablet measurements. Native animation callbacks and `performance.now()` are used. Tests, builds and pixel comparisons ran separately from performance measurements.

| Firefox case | Draws/s before → after | p95 draw spacing before → after | p95 sky upload before → after |
| --- | ---: | ---: | ---: |
| Desktop/day freezing rain, repeat 1 | 34.2 → 42.1 | 34 → 26 ms | 19 → 9 ms |
| Desktop/day freezing rain, repeat 2 | 33.7 → 41.7 | 34 → 26 ms | 20 → 8 ms |
| Desktop/day freezing rain, repeat 3 | 33.7 → 39.9 | 34 → 28 ms | 20 → 12 ms |
| Desktop/night freezing rain | 33.8 → 41.1 | 35 → 26 ms | 20 → 8 ms |
| Desktop/night heavy rain | 38.8 → 41.8 | 31 → 26 ms | 16 → 5 ms |
| Desktop/night ordinary rain | 40.7 → 40.9 | 26 → 26 ms | 4 → 7 ms |
| Larger 1728 × 1117 viewport, ordinary rain | 41.2 → 40.9 | 27 → 28 ms | 9 → 11 ms |

The three ordinary-rain desktop/day repeats measured 42.6 → 42.2, 41.2 → 40.9 and 42.3 → 38.7 draws/s. The final phone and tablet samples stayed around 40–41 draws/s. Their small canvases were already fast, so these results do not support claiming a speedup on every layout.

A **40-second freezing-rain run** completed at **40.3 draws/s**, with **27 ms p95 / 36 ms maximum** draw spacing. Its sky upload was **10 ms p95 / 16 ms maximum**, and its entire glass call stayed at or below 20 ms. This sustained run is recorded separately from the shorter matched pairs.

All 37 matched comparisons are in [firefox-glass-stall.csv](performance/firefox-glass-stall.csv). The longer measurement is in [firefox-glass-sustained.json](performance/firefox-glass-sustained.json). Chrome and WebKit retain their previous paint cost and cadence; no CPU or battery saving is claimed for them.

## Visual fidelity

All drop positions, widths, streak sections, alpha bands, cloud ordering and glass shaders are retained. Thirty-seven fixed-frame screenshot pairs were compared. Sixteen match exactly; the largest mean absolute RGB difference is **0.168 on a 0–255 scale**, with a largest single-channel difference of **30** in the night freezing-rain image. The images are therefore not bit-for-bit identical: shorter native path bounds and the extra surface copy affect edge antialiasing and rounding.

[Per-image results](performance/firefox-glass-stall-visuals.csv) include the original screenshot folder names under ignored `perf-results/`. The regressions independently check original versus tiled transparent streak coverage across weather, phases and DPRs; tile-boundary crossings, overlapping and duplicate streaks, clipping, line caps, opacity, canvas reuse and release are also covered. Axis-aligned seam checks allow at most one coverage level of rounding; diagonal intersections have a separate small, bounded rasterization tolerance.

## Validation

Type checking, both linters, formatting, the production build and browser compatibility checks pass. The complete unit/browser suite passed **1,439/1,439** across 62 files with file parallelism disabled. The focused rain, tile, glass and lifecycle checks also passed **77/77**. Built-card and touch end-to-end checks passed **74/74** across Chromium, Firefox, WebKit and the phone profile. No tests were weakened to permit a timing failure.

## Measurement limits

### Optional glass refraction

`glass_refraction: false` now offers a separate choice from low-power mode. It retains the sky's resolution and rain density, and keeps moving droplets, highlights and shadows on the panels. Their refracted sky image is omitted. The default is `true`; the visual editor exposes the setting under **Look → Glass refraction**.

The off mode uses the same procedural drop shapes and motion in a shader compiled without sky samplers. It releases that card's cached sky textures and skips all sky staging copies and uploads. Other cards can keep refraction enabled in the shared context. Turning it back on immediately uploads the current sky. The canvas fallback also honors the flag.

The toggle's built-card checks passed in Chromium, Firefox, WebKit and the phone layout: droplets remain visible, change with time, return to the same pixels when toggled back, and issue zero sky texture uploads while off. The complete unit/browser suite passed **1,444/1,444**; the built-card suite passed **244 tests**, with **64 platform/layout skips**. Type checking, linting, formatting, the build and browser compatibility checks also passed. An attempted normal-window Firefox timing comparison encountered another **4,005 ms** animation-callback gap with refraction enabled and was stopped before a paired comparison completed. No FPS improvement is claimed for the toggle from that recording. This option does not implement the proposed shared GPU sky-and-glass pipeline.

The benchmark accepts `PERF_GLASS_REFRACTION=0` for an off-mode comparison and records the chosen flag as `glassRefraction` in each result.

### Remaining timing limitations

The final short repeats still contain isolated **74 ms and 93 ms** frame gaps, despite sky uploads staying at or below 16 ms. Their cause is not established. The successful longer freezing-rain sample was smoother, but the available evidence does **not** justify promising that all occasional hitches have disappeared.

Native Firefox callbacks sometimes stopped even while the page reported visible and focused, including on the unchanged baseline. Both forty-second ordinary-rain attempts were invalidated by callback pauses, so sustained ordinary-rain smoothness remains unverified. A separate twenty-second control page containing only a changing text counter also paused for **4,005 ms** and stopped delivering frames for the final 2.6 seconds; it contained no weather-card code. Those recordings are incomplete and are not counted as smooth runs. The runner now waits for a native callback before sampling and after the requested interval, so a stalled final interval cannot disappear from the statistics. It also retains the existing callback-coverage check. A window resize refreshes the native test window before timing.

The paired Firefox runs used `MOZ_WINDOW_OCCLUSION=0` for the isolated benchmark process. This is a test-harness setting, not a card change or an instruction to change the user's Firefox preferences. Mozilla's Cocoa window implementation documents it as a way for test harnesses to disable unreliable native occlusion tracking. It did not eliminate all callback pauses here. [Mozilla window-occlusion implementation](https://raw.githubusercontent.com/mozilla-firefox/firefox/main/widget/cocoa/nsCocoaWindow.mm).

The existing rain scheduler still requests 48 Hz and commonly yields around 40 draws/s on this display. These results do not establish 60 FPS, mobile battery usage, or performance on physical phones.

## Reproduction

Run a development server and keep the normal benchmark window visible. Use separate frozen-source and candidate servers for before/after measurements, and alternate their order:

```sh
MOZ_WINDOW_OCCLUSION=0 PERF_BROWSER=firefox PERF_HEADED=1 PERF_PROFILES=desktop-day PERF_KINDS=rain,freezingRain PERF_WARMUP=2500 PERF_SAMPLE=40000 pnpm perf sustained-rain
```

`PERF_URL` selects the server. The runner saves frame spacing, callback coverage, synchronous paint timing and fixed-frame images. The diagnostic comparisons additionally wrapped native sky copies and texture uploads to locate the wait; those diagnostic wrappers are not shipped in the card. Keep invalid runs and isolated slow frames visible in the assessment rather than selecting only the fastest samples.
