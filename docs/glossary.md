# Glossary

The words this codebase uses for its own parts.

**Card**: the whole Lovelace element, `iweather-card`. Its entry file is `src/iweather-card.ts`.

**Inner card**: one thing on the page that a reader sees as a card of its own: a tile or panel, and the sheet it opens. Each has a folder under `src/cards/`, and the map has `src/map/`. Don't call an inner card a "card" on its own.

**Tile**: an inner card's small square on the full page. A tile is declared by a `TileCard`.

**Panel**: an inner card at the head of the page or in its main column: the alerts, the next hour, the hourly forecast and the daily list.

**Sheet**: the popover an inner card opens, with its charts and sentences. A sheet is declared by a `SheetCard`; `src/sheets/` holds what sheets share.

**Page**: one day's charts in a sheet, a sheet wide, in the strip that slides from day to day (`chartPages`, `src/sheets/pages.ts`). The title, the headline and what stands between two charts stay put; the sections below change with the day.

**Reading sheet**: the shared sheet for a single reading over a day: UV, wind, humidity, pressure and visibility. A card fills it in with a `ReadingSpec`.

**Card list**: `src/cards/index.ts`, where every inner card appears once. Nothing else lists them.

**Update**: everything one pass of the card works out before drawing, as plain data (`src/card/update.ts`). Panels and sheets draw from the update and nothing else.

**Supplement**: the forecast Open-Meteo adds to the weather entity's, on the full page, when that leaves something out. The entity's own values always win (`supplementForecast`).

**Look**: what sets one chart apart from another (`ChartLook`). The chart module knows no inner card by name.

**Series**: which reading a chart plots, and where that reading comes from (`Series`).

**Reach**: how low and how high a series goes over everything a sheet can show, every day of it and history too. A chart's scale is worked out from it, and it is held while the sheet is open (`Reach`).

**Host**: what a module needs from the card, declared by that module as an interface of its own.

**Map inputs**: what a map view draws from (`MapInputs`), asked for rather than read back from the DOM.

**Reading**: a value of the weather, such as the wind speed. A sensor configured for a reading stands in for the weather entity's own.
