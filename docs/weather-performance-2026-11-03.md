# Weather rendering performance — 3 November 2026

Follow-up: [Firefox distant-rain layer](firefox-rain-performance-2026-11-03.md) improves median desktop rain from about 24 to 33 draws/s in repeated measurements, with no detail or resolution reductions. It also records an unresolved slow repeat. The results below describe the first optimization pass, before that additional change.

This audit measures every one of the card's 33 weather presets and optimizes the expensive rain and fog paths without reducing particle counts, drawing resolution, texture quality or the configured animation frequency. Measurements use a local Home Assistant fixture; the live dashboard was not modified.

The clearest red flags were Firefox's sky-to-glass canvas copies and its repeated grain overlay. Both are improved. In the final desktop Firefox comparison, rain's 95th-percentile synchronous paint fell **71 → 33 ms**, freezing rain **74 → 37 ms**, and fog **39 → 31 ms**. Particle counts, textures and drawing resolution are unchanged. Large Firefox rain scenes still sustain only about 22–24 card draws/s; this work reduces stalls but does not eliminate that limitation.

Chrome already handles the tested scenes well. The matched five-second desktop/tablet rain and storm samples used roughly **5–19% less main-thread task time** at the same drawing cadence. Phone-sized plain rain/freezing rain was approximately neutral across repeats; hurricane improved. These are per-case lab results, not an overall CPU or battery-saving percentage.

## Coverage and method

- Before: a frozen copy of the source taken before these changes. After: the optimized source. Both use separate Vite servers and dependency caches, the same fixture, browser, GPU, inputs and calendar time.
- All 33 presets in Chrome 156, each at desktop 1280×900 / DPR 2, phone 390×844 / DPR 3, and tablet 820×1180 / DPR 2, in both daylight and darkness: 198 before/after pairs. These are viewport and pixel-density profiles on the development laptop, **not measurements from physical phones or tablets**.
- The fixture retains the card's default size/zoom with a host width of `min(1100px, 100vw)`. Actual rendered card width is therefore smaller than the viewport; raw results record the canvas dimensions. These profiles exercise responsive layouts, not full device emulation.
- Chrome uses its hardware ANGLE renderer, not Playwright's software-rendered Chromium headless shell. Firefox is measured in a normal browser window: its headless canvas performance on this machine differs greatly from normal use. Firefox 157 also covers all 33 presets at desktop/day, with longer rain checks across three layouts. WebKit 27.2 covers eight representative presets at phone/day and tablet/night (16 pairs). The final grain change was rechecked in all six Chrome profiles and desktop Firefox; the WebKit screening preceded that change.
- Matrix screening: 1 second warmup and 1.5 seconds sampling per case. Longer runs repeat rain, freezing rain and hurricane conditions for 5 seconds after a 1.5-second warmup. Treat small differences in short screening runs as noise; the repeated heavy-weather runs support the improvement claims.
- The broad matrix initially used native elapsed animation phase. Moving cloud/rain workloads varied enough to obscure some phone comparisons, so the final focused runs align the animation at 8000 ms before warmup (`PERF_PHASE_BASE`). That mapping changes only the scene time passed to paint, not the browser scheduler. Interrupted/background-throttled experiments are excluded; the runner now rejects hidden or unfocused headed samples.
- Calendar time is frozen with a Date proxy. `performance.now()` and `requestAnimationFrame` remain native. Playwright's simulated clock is deliberately avoided because it wraps animation scheduling.
- `Task ms/s` is Chrome's main-thread task duration normalized by elapsed time, not whole-process CPU, GPU utilization or battery use. Paint durations measure the synchronous card call, including any browser stalls it triggers; asynchronous GPU execution is not fully represented. Native frame intervals and card draws/s are recorded separately. The existing scheduler requests 48 Hz for falling/stormy weather, 30 Hz for clouds/fog and lower rates for quiet skies. Its current frame gate quantizes rain to about 30 draws/s at 60 Hz display refresh and 40 draws/s at 120 Hz; these changes preserve that scheduling behavior. A quiet clear daytime sky draws at 10 Hz.
- Every preset is checked against the expected kind. Three presets without an automatic provider mapping (`mostlyCloudyLowAltitude`, `partlyCloudyLowAltitude`, `sleet`) are selected by a benchmark-only module interception. The shipped code has no weather override.

## Results

Final foreground Firefox desktop/day comparison, with aligned scene time and a 2.2-second sample:

| Weather | Mean paint, before → after | p95 paint, before → after | Card draws/s, before → after |
| --- | ---: | ---: | ---: |
| Rain | 22.4 → 11.0 ms | 71 → 33 ms | 23.2 → 23.6 |
| Freezing rain | 26.3 → 13.6 ms | 74 → 37 ms | 21.2 → 22.2 |
| Hurricane | 5.0 → 4.0 ms | 14 → 10 ms | 41.7 → 41.7 |
| Fog | 37.5 → 29.5 ms | 39 → 31 ms | 26.6 → 30.0 |
| Haze | 41.7 → 34.4 ms | 43 → 36 ms | 23.9 → 28.9 |
| Smoke | 40.2 → 32.9 ms | 42 → 34 ms | 24.7 → 30.0 |

The independent five-second Firefox rain runs agree: rain p95 fell 69 → 34 ms on desktop, 50 → 22 ms on tablet and 6 → 4 ms on phone. The modest desktop cadence increase despite halved synchronous paint time means browser rendering remains a constraint beyond the measured call.

Final aligned Chrome samples, five seconds each; numbers are **main-thread task milliseconds per second**, lower is better:

| Layout | Rain, before → after | Freezing rain, before → after | Hurricane, before → after |
| --- | ---: | ---: | ---: |
| Desktop/day | 84.9 → 80.8 | 98.4 → 88.2 | 116.7 → 96.3 |
| Tablet/day | 77.4 → 72.3 | 89.1 → 78.0 | 97.8 → 79.0 |
| Phone/day | 119.4 → 123.4 | 137.5 → 139.9 | 142.0 → 125.5 |

All nine maintained about 30 card draws/s. The small phone rain increases in this final pass did not consistently repeat: two additional aligned pairs measured plain rain at 84.6 → 84.8 and 65.9 → 65.9 ms/s, and freezing rain at 88.5 → 87.3 and 104.8 → 90.0 ms/s. There is no supported claim of a plain-rain CPU improvement for Chrome phone layouts. Short Chrome fog samples also varied in task totals; their p95 synchronous paint remained 0.3–1.4 ms, so the fog optimization's clear measured benefit is in Firefox.

Across the 198-pair Chrome screen, the highest optimized p95 paint was 5.0 ms. WebKit's rain/hurricane checks retained about 30 draws/s: phone rain p95 improved 6 → 5 ms, tablet/night rain 10 → 7 ms, and tablet/night hurricane 17 → 12 ms. No browser errors or unexpected external requests occurred in the completed datasets.

The rain intermediate surface contains **54% fewer pixels on desktop, 67% fewer on phone and 39% fewer on tablet** in these layouts. This reduces shader/copy area without reducing its pixel density. These percentages are not CPU or total-memory savings.

The complete matrix is in [weather-matrix.csv](performance/weather-matrix.csv), with focused browser comparisons in [weather-focused.csv](performance/weather-focused.csv). The matrix replaces the 18 grain cases with the final grain implementation; its `phase` column distinguishes the original native-phase screen from the aligned replacements. It records each profile and preset separately, with before/after task duration, paint duration and drawing cadence. Raw results and screenshots remain in the ignored `perf-results/` directory. Do not interpret a lower task total caused by fewer animation frames as an optimization; compare the cadence and paint duration alongside it.

## Changes and visual fidelity

1. **Reuse each falling raindrop's launch data.** The old loop recomputed hashes, trigonometry, perspective, thickness and opacity for every drop on every frame. A drop now retains those values for its lifetime; each frame advances its age and position. Changing size, wind or rain preset invalidates the appropriate cache. Hiding the card or switching to dry weather releases it. Counts and trajectories are preserved, including rewinds and respawns.
2. **Crop the glass rain surface to the panels being drawn.** The old intermediate canvas covered the whole card, including large empty areas in tall phone layouts. Its replacement covers the union of visible panels, including the complete area of partially visible panels. Pixel-aligned shader offsets retain the original coordinate system, droplet seeds and sky sampling. The shared WebGL backing canvas can retain a previous larger allocation, so this is a reduction in rendered/copied area, not a claim of equivalent GPU memory savings.
3. **Sample a completed sky during animated rain.** Drawing the sky immediately before copying it for refraction makes Firefox wait for queued canvas work. Established rain now samples the previous completed sky before drawing the next sky. Droplet motion uses the current animation time. This adds at most one animation frame to the existing reflection sampling delay; first, resized, resumed and still frames use the fresh sky. Refraction quality and the existing sky upload limit are unchanged.
4. **Cache the grain used by fog, haze and smoke.** Firefox spends substantial time repeatedly drawing a canvas pattern with overlay blending. The same grain is now baked into a strip at most 512 device pixels wide and copied at the original pixel positions. This keeps the anti-banding effect intact while avoiding another full-size cached sky. The strip is rebuilt on size changes and released for hidden cards, other weather types and completed still frames. Its raw pixel storage is about 3.7 MB for the measured desktop sky (browser/GPU overhead is additional).

Compared 198 fixed-frame before/after image pairs: **133 were pixel-identical**. The largest mean absolute channel difference in any pair was **0.068 on a 0–255 scale**. Grain blending introduces tiny rounding differences in Chrome; in the final three Firefox fog/haze/smoke screenshots, every pixel matched. A few other pairs contain isolated larger rasterization differences, so whole-image equivalence is not claimed. The per-image counts and differences are in [visual-comparison.csv](performance/visual-comparison.csv).

The grain regression compares the old repeated pattern with the cached strip at multiple sizes and opacity levels, allowing at most one 8-bit channel step. Visual inspection of the resulting rain and smoke cards retained the original cloud depth, glass refraction, soft streaks and grain.

Automated fixed-frame images do not capture the intentional one-frame reflection timing difference during motion. Additional regressions verify painting order, resumed cards and pixel equivalence of cropped glass at multiple pixel densities. This is a timing change to the reflected scene, not a reduction in the visible rain detail.

## Loading, interaction and network

Three fresh Chrome contexts loaded the actual production bundle from a plain static localhost server. The first run also recorded a complete DevTools timeline. An earlier run through Vite was discarded for production conclusions because Vite rewrote the built bundle.

| Metric | Measured range | Assessment |
| --- | ---: | --- |
| LCP | 212–240 ms | Good in this local lab fixture |
| First contentful paint | 212–240 ms | Fast local startup |
| CLS | 0 | No observed layout shift |
| Wind-panel click event duration | 64–96 ms | Responsive scripted interaction; not field INP |
| Offscreen main-thread task time | 0.39–0.51 ms/s | Card becomes nearly idle |

The cold startup still contains a 119–133 ms main-thread task; the runs also recorded later 52–60 ms tasks. This is a remaining startup optimization opportunity, even though the local LCP is fast. These results are after-only load checks, not claimed improvements from this patch.

Each load requested the document, the **821,315-byte uncompressed card bundle**, and eight AVIF images totaling 791,026 bytes. All requests succeeded, and no external service was contacted. No MapLibre code, worker or source map was requested in this local-only fixture. The static test server sends uncompressed files and is not the deployment server, so its caching/compression headers cannot establish Home Assistant's actual delivery behavior.

Accessibility snapshots expose named forecast regions, labeled forecast-mode buttons and named detail buttons. The wind detail opened and Escape closed it during the interaction check. A tree snapshot does not measure color contrast or substitute for a full accessibility audit. A compact load summary is in [production-load.csv](performance/production-load.csv). The trace, request metadata, raw event timings and snapshots are saved in `perf-results/load-static/`.

The shipped card is a native custom element built with TypeScript and Vite/Rolldown. CSS is included in the card; cloud and moon images are separate AVIF assets. MapLibre and its worker are already separate, loaded when needed. Production JavaScript is minified. Source maps are external. No dependency or asset format was changed by this audit.

The fixture is served locally, without network throttling. Its load metrics do not describe Home Assistant's complete dashboard, remote server latency, cache policy or mobile network performance. Good Core Web Vitals thresholds are LCP ≤2.5 seconds, INP ≤200 ms and CLS ≤0.1, evaluated at the 75th percentile of field visits; a single scripted interaction is not a field INP measurement. [Web Vitals definitions](https://web.dev/articles/vitals).

## Validation and remaining limits

Regression coverage includes cached rain across respawns/rewinds, wind and size changes; cropped glass pixel equivalence at DPR 1, 1.5 and 2; grain pixel equivalence and cache release; and first/resumed/resized/still-frame painting order.

Types, both linters and formatting pass. All **1,420 tests across 61 files** pass, including the new rendering regressions. The production build and browser compatibility check pass.

The final end-to-end batch completed **239 passed, 64 intentionally skipped**, with one WebKit case unable to start because the native browser launcher segfaulted during `browser.newContext`, before the card loaded. That case then **passed all three separate reruns**. All 240 enabled cases have therefore passed across Chromium, Firefox, WebKit and the touch layout, but the full batch itself was not entirely green because of that launcher crash. The launcher failure is retained at `perf-results/webkit-launch-failure.md`.

The two corrected interaction assertions each passed nine focused repeats (three per engine), and both subsequently passed in the full batch. No production interaction code was changed to make these tests pass.

A radar-test fixture was also made independent of crossing a real ten-minute clock boundary during an assertion. Its supplied frame time now remains fixed for each test and advances only when the test asks for a later frame; production radar behavior is unchanged. A Firefox gesture assertion also now waits for the current snapped page and its selected day to agree, without saving an index while the wheel scroll is still settling. The retained failure trace showed the old assertion keeping day 1 while the card correctly settled on day 2; the application gesture code is unchanged. The conditions-chart hover test also waits for the sheet to position today’s page before hovering; its failure trace showed the opening scroll intercepting and clearing the reading.

CPU throttling alone cannot reproduce a phone's GPU, thermal behavior or memory constraints. The short preset screen does not establish worst-case behavior across every lightning strike, transition or long session. Measurements on physical phones are still needed before promising a device-wide frame rate or battery improvement. [Chrome performance measurement guidance](https://developer.chrome.com/docs/devtools/performance).

The initial Firefox screenshot's 22% `drawImage` self samples identify a hotspot in the sampled work. The nested 24%, 26% and 27% rows include that same work and must not be added together. Those percentages alone cannot establish overall CPU utilization or dropped-frame rate.

Audit checklist:

- [x] Runtime measurements and source inspection.
- [x] Production load trace and Web Vitals lab measurements.
- [x] Network requests and asset review.
- [x] Accessibility snapshots.
- [x] Before/after visual comparison.

## Repeat the measurements

Start `pnpm dev`, then run the performance command in another terminal. Do not run tests or other GPU-heavy workloads concurrently.

```sh
pnpm perf run

# Focused Chrome run; Chrome must be installed.
PERF_KINDS=rain,heavyRain,freezingRain,hurricane PERF_PROFILES=phone-day PERF_SAMPLE=5000 pnpm perf rain-phone

# Normal-window Firefox, matching the important canvas-copy path.
PERF_BROWSER=firefox PERF_HEADED=1 PERF_PROFILES=desktop-day pnpm perf firefox

# WebKit (install the Playwright browser first).
PERF_BROWSER=webkit PERF_PROFILES=phone-day,tablet-night pnpm perf webkit

# Optional Chrome CPU profile and slower CPU experiment.
PERF_TRACE=1 PERF_CPU_THROTTLE=4 PERF_KINDS=rain PERF_PROFILES=desktop-day pnpm perf rain-profile
```

`PERF_URL` selects another dev server. `PERF_PHASE_BASE` selects the initial animation time in milliseconds (default 8000). Keep a headed browser in front for the entire sample; the runner rejects lost-focus runs. `PERF_WARMUP` and `PERF_SAMPLE` are milliseconds; defaults are 1800 and 2200. `PERF_SCREENSHOTS=0` omits fixed-frame images. `PERF_SCROLL=800` exercises panels farther down the card. `PERF_TRACE=1` writes a Chrome `.cpuprofile`, not a full timeline trace. Browser errors and unexpected external requests fail the runner. The preset inventory check fails when a newly added preset has no benchmark inputs.
