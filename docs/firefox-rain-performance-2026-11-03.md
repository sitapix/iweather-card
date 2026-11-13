# Firefox rain follow-up — 3 November 2026

Separating distant rain from the main sky canvas improves Firefox rain without reducing drop counts, resolution, streak detail, lighting, glass effects or the animation rate setting. In four matched eight-second desktop/day samples, the median drawing rate increased **24.1 → 32.7 draws/s (36%)**. Three optimized samples ran at 32–42 draws/s; one suffered a substantial glass-copy stall and ran at 17.4. The change improves typical performance, but does **not** establish a consistently smooth frame rate.

This follows the [all-weather audit](weather-performance-2026-11-03.md). Its baseline already includes that audit's optimizations. These results measure only the additional distant-rain layer; they must not be interpreted as comparisons against the original unoptimized card. Changes remain local, without deployment to Home Assistant.

## What changed

The distant rain previously stroked twelve changing `Path2D` batches directly onto the sky. It now draws the **same paths at the sky's full device-pixel dimensions** onto a reusable transparent canvas, then composites that canvas between the same cloud decks. Near rain, clouds, splashes and glass retain their existing rendering. No rain shader, particle count, opacity band, motion trajectory or texture resolution was simplified.

Isolation experiments identified distant rain as the useful target: disabling only that layer reached 40.3 draws/s, whereas disabling only glass reached 25.7. Those diagnostic omissions are not present in the final implementation. Mozilla describes expensive software-mask uploads and fallback behavior for complex changing canvas paths; this is consistent with the experiment, but the measurements do not prove which internal Firefox heuristic fired. [Mozilla canvas performance investigation](https://bugzilla.mozilla.org/show_bug.cgi?id=2033361).

The cost is one additional full-resolution canvas during rain. Its raw RGBA pixel storage in this fixture is about **12.7 MB desktop, 6.1 MB phone and 10.2 MB tablet**; browser and GPU overhead is additional. It is reused, resized with the sky, and released for hidden, dry and completed still scenes, including the end of a rain fade. The implementation uses the default canvas backend, without browser detection or a forced software-rendering hint.

## Measurements, including the slow repeat

Normal-window Firefox 157 on the development laptop. Desktop/day samples use a two-second warmup and eight-second measurement. Animation phase begins at 8000 ms before warmup; calendar time is fixed, while animation callbacks and `performance.now()` remain native. The source before this follow-up is frozen on a separate server. Tests and builds were not run concurrently with these measurements.

| Desktop/day rain sample | Before draws/s | After draws/s | Before / after p95 synchronous paint |
| --- | ---: | ---: | ---: |
| First long pair | 32.5 | 42.5 | 23 / 10 ms |
| Repeat 1 | 23.7 | 17.4 | 34 / 78 ms |
| Repeat 2, reversed order | 24.4 | 33.2 | 32 / 21 ms |
| Repeat 3, reversed order | 23.8 | 32.2 | 33 / 21 ms |
| Median of all four | **24.1** | **32.7** | — |

The slow optimized repeat is retained, not dismissed as noise: its glass call reached 241 ms, and p95 spacing between card draws was 158 ms. Native callbacks covered 99.6% of the sample, with no detected focus loss or page errors. Its cause remains unresolved. Subsequent reversed-order pairs improved p95 draw spacing from 49 ms to 36 and 41 ms, respectively. The earlier four-second pilot measured 22.7 → 42.4 draws/s; it is recorded separately rather than used to promise a doubling.

Additional matched Firefox samples, four seconds after a 1.5-second warmup:

| Layout | Rain draws/s, before → after | Rain p95 draw spacing, before → after | Freezing rain draws/s, before → after |
| --- | ---: | ---: | ---: |
| Desktop/night | 23.7 → 32.5 | 50 → 41 ms | 22.2 → 24.1 |
| Phone/day | 40.7 → 40.5 | 26 → 26 ms | 40.7 → 40.5 |
| Tablet/day | 31.5 → 40.5 | 42 → 26 ms | 30.5 → 32.5 |

Desktop/day freezing rain measured 30.9 → 33.2 draws/s in the eight-second pair. Its shorter pilot improved 21.3 → 33.0. Hurricane was already near the existing scheduler's cadence and stayed approximately 42 draws/s.

Chrome 156 retained approximately 30 card draws/s in nine paired rain/freezing-rain/hurricane cases across desktop, phone and tablet layouts. Synchronous paint p95 remained 2.1–5.0 ms. The initial phone rain task measurement rose 96.2 → 120.6 ms/s, but a longer matched repeat measured **108.8 → 109.0 ms/s**, with identical 4.8 ms p95 paint. There is no supported Chrome CPU-saving claim from this follow-up.

WebKit 27.2 retained approximately 30 draws/s across six phone/day and tablet/night pairs. Rain p95 paint remained 5 ms on phone and 7 ms on tablet; the other two conditions were unchanged or slightly faster. No page errors or unexpected external requests occurred in the completed comparisons.

All 30 comparisons, including the slow Firefox repeat and both Chrome phone measurements, are in [firefox-rain-followup.csv](performance/firefox-rain-followup.csv). Native callback coverage is included. The runner now also records actual card-draw intervals and rejects samples whose animation callbacks covered less than 80% of the measurement window, even when the browser reports itself visible and focused.

## Visual fidelity and validation

Thirty fixed-frame image pairs retain the cloud depth, rain streaks and refracting glass. The largest whole-screenshot mean absolute RGB difference was **0.058 on a 0–255 scale**. The largest individual channel difference was 34, in a Firefox night image: full images are not pixel-identical because the extra transparent surface changes compositing and rasterization. Detailed per-image measurements are in [firefox-rain-visuals.csv](performance/firefox-rain-visuals.csv); original images remain in ignored `perf-results/` folders named by the CSV.

The rain regression compares the separate layer with the unchanged direct-stroke renderer on transparency at DPR 1, 1.5 and 3, across opacity changes, consecutive frames, resizes and five weather/wind combinations. Every channel must match exactly. This checks actual drop coverage independently of the rounding introduced when rain is blended over an opaque sky. Additional checks cover canvas reuse, full pixel dimensions, resizing and release for hidden, dry and still scenes.

Types, both linters, formatting, the production build and the browser compatibility check pass. All thirteen rain regressions pass, including exact transparent coverage and lifecycle checks. The full unit/browser batch passed **1,424 of 1,426** tests: an editor scroll timing assertion and a section-size timeout failed under concurrent load. Both affected files then passed **36/36** tests with file parallelism disabled, without changes to either test or production layout code. Thus all 1,426 cases have passed across the batch and focused rerun; the original full batch was not entirely green.

The built-card and touch end-to-end checks passed **74/74** across Chromium, Firefox, WebKit and the phone layout. This follow-up reran the shipped-card and touch specs; the broader interaction suite's earlier results remain in the first audit.

## Limits and reproduction

These are viewport profiles on the development laptop, not measurements on physical phones. The existing scheduler is unchanged: its rain setting requests 48 Hz but commonly draws around 30 times/s on a 60 Hz display and 40 times/s on a 120 Hz display. Synchronous paint duration excludes some browser/GPU work; neither it nor Chrome's task time establishes total CPU, GPU or battery consumption. The unresolved Firefox stall prevents a guarantee of sustained smoothness.

Start the development server, keep the normal Firefox window in front, and run:

```sh
PERF_BROWSER=firefox PERF_HEADED=1 PERF_PROFILES=desktop-day PERF_KINDS=rain PERF_WARMUP=2000 PERF_SAMPLE=8000 pnpm perf rain-repeat
```

Repeat several times, alternating before/after order. Keep every complete result, inspect draw spacing alongside average cadence, and run tests separately. The existing [all-weather audit](weather-performance-2026-11-03.md) describes the broader fixture, browser setup and coverage.
