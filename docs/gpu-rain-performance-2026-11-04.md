# Rain rendering and frame cadence — 4 November 2026

The animation clock now maintains a deadline instead of restarting its interval after every draw. Falling and stormy weather target 60 Hz. Previously, the 48 Hz interval minus a 4 ms tolerance was just longer than a 60 Hz callback, so an otherwise fast sky often drew only every other callback. Calm skies and low-power mode retain their own frame rates. After a pause, the clock resumes without replaying missed frames.

In Chromium and Firefox, rain is drawn as instanced GPU geometry in the glass renderer's existing WebGL context. The launch positions, trajectories, counts, opacity bands, and foreground streak texture are retained. Each distant opacity band is combined before compositing, so overlapping streaks do not acquire extra opacity. The completed sky and its blurred counterpart remain in GPU textures that glass samples directly.

The Canvas background has its own surface at up to one pixel per CSS pixel. It no longer receives the completed GPU output before being uploaded on the next frame. Rain and the finished sky retain the existing device-pixel resolution, capped at two. This deliberately changes the rasterization of the background and other Canvas effects; it is not a pixel-identical renderer. Cloud ordering, lightning blending, scrolling, and rain-on-glass remain supported.

The final sky still copies to the visible 2D canvas, and cloud layers still cross rendering contexts. This is not a completely GPU-resident scene. Browser-specific costs at those boundaries can still limit the frame rate.

WebKit retains the native Canvas rain path because its layered Canvas-to-WebGL transfers cost more in the matched measurements. Other engines also retain that fallback for unsupported GPU capabilities, oversized surfaces, still frames, and grain-blended scenes. At most four cards retain GPU skies; additional cards use Canvas until a slot opens instead of evicting and reallocating each other's surfaces every frame. Hidden, disconnected, dry, and still scenes release their resident sky textures. Shader locations and device limits are looked up during initialization rather than during each frame.

## Measurement method

The baseline is a snapshot of the working tree before this change, including the earlier local rain optimizations. Measurements use `scripts/weather-performance.ts`, native animation callbacks, refraction enabled, and separate frozen preview servers. Tests and builds run separately from performance samples. Desktop and phone labels refer to viewport profiles on the same laptop, not physical mobile devices.

Raw recordings and fixed-frame screenshots are retained in ignored `perf-results/`. Normal-window Firefox sometimes stops delivering native callbacks even for a control page; the harness rejects incomplete recordings. Such attempts do not establish either smoothness or a rendering regression. No battery or CPU reduction is claimed from increasing the frame rate.

## Chrome measurements

Chrome 156, ANGLE on the development laptop’s integrated GPU. The baseline samples are five seconds and the final samples six seconds, after warmup. All use refraction and the same weather inputs. Sources are `gpu-before-chrome/results.json` and `gpu-final-chrome/results.json` under `perf-results/`.

| Layout and weather | Draws/s before → after | p95 draw spacing before → after |
| --- | ---: | ---: |
| Desktop rain | 29.9 → 60.0 | 33.9 → 17.5 ms |
| Desktop heavy rain | 30.1 → 60.0 | 33.9 → 17.5 ms |
| Desktop freezing rain | 30.1 → 60.0 | 34.1 → 17.4 ms |
| Phone rain | 30.1 → 57.6 | 34.0 → 17.3 ms |
| Phone heavy rain | 30.0 → 60.0 | 34.3 → 17.5 ms |
| Phone freezing rain | 30.1 → 60.0 | 34.0 → 17.5 ms |

The phone rain recording includes a 114.6 ms maximum gap despite card paint taking at most 7.2 ms. Its cause is not established, and the result is retained. These samples demonstrate improved cadence, not the elimination of every hitch. Total main-thread work increases because the card now draws roughly twice as many frames.

A separate 20-second phone rain run (`gpu-phone-sustained`) held 60.0 draws/s, with 17.5 ms p95 spacing and a 33 ms maximum. Card paint was 2.5 ms p95; main-thread task time was 125.8 ms/s. It does not erase the earlier isolated hitch.

## Firefox measurements

Normal-window Firefox 157 on the same laptop, with `MOZ_WINDOW_OCCLUSION=0` confined to the test process. The final heavy-rain recording includes diagnostic wrappers around canvas copies and GPU submissions. It measures 34.0 → 41.0 draws/s on desktop, while p95 draw spacing stays at 37 ms and the maximum gap increases from 93 to 122 ms. Uploads of the background still account for most of the synchronous sky work. This improves average throughput but does not establish consistently smooth desktop Firefox animation.

The phone heavy-rain pair measures 12.9 → 60.0 draws/s, with p95 spacing improving from 140 to 18 ms. The initial baseline was unusually slow relative to earlier Firefox recordings, so that ratio should not be generalized. The final sample's maximum spacing is 22 ms. Sources are `gpu-before-firefox` and `gpu-final-firefox-heavy`.

The earlier background-staging diagnostic measured desktop ordinary rain at 48.1 draws/s versus 31.7 in the initial baseline. It preceded the final resource-reuse and shader-location changes and is retained as diagnostic evidence, not a final-build result. Several subsequent ordinary- and freezing-rain attempts stopped receiving native callbacks and could not produce valid final measurements.

The accepted recordings are preserved in [the measurement data](performance/rain-gpu.json). Rejected attempts remain under their original labels in `perf-results/`.

## WebKit measurements

WebKit 27.2's automation supplied about 30 native callbacks per second in these samples. Baseline and final draws remained about 30/s, apart from one slower baseline phone rain run. This environment does not establish 60 FPS in Safari.

The GPU prototype increased desktop p95 paint time from 9 ms to 15–17 ms. The selected native fallback, including WebKit's original presentation-buffer behavior, measured 9–10 ms on desktop and 5 ms on the phone layout. The final maximum draw spacing was 34–35 ms. All three rain presets use the native fallback in WebKit; the frame-deadline correction applies in every engine. Both the rejected GPU measurements and final fallback measurements are retained in the data.

## Validation

Type checking, Biome and oxlint, formatting, the production build, and bundle browser-compatibility checks passed. Rain regressions cover frame cadence at 60/120/144 Hz, opacity and blending, full lit-cloud scenes, day/night/storm ordering, device-pixel ratios, rewinds, context loss, hidden/still/dry cleanup, resizing, and the limit on simultaneous resident skies.

The isolated built-card suite passed **292 tests**, with **64 platform/layout skips**, across Chromium, Firefox, WebKit and the phone profile. The full isolated unit/browser run passed **1,486 of 1,489 cases** while running alongside that suite. Three map timing cases failed under that load; their two files then passed **36/36**, unchanged, in a separate run. This is validation across full and focused runs, not a claim that the combined run was entirely green.

The isolation was necessary because another build/test process in the shared workspace removed bundle and trace files during the first attempt. The final snapshot, build, and test outputs are under `/private/tmp/weather-rain-validation`; the rain sources and regression files were compared with the working tree. No unrelated chart or map source was changed by this rain work.

These measurements and regression checks were collected from local builds before deployment to Home Assistant.
