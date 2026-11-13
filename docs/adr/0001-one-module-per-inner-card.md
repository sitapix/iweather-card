# 1. One module per inner card, in one list

The code was sorted by output: tiles in one file, sheets in another, charts in a third. Every inner card was cut across that sort, and 27 places named a card by its id, of which the compiler checked 5.

We sort by card instead. Each inner card has a folder holding its rules, tile and sheet, and declares itself once in `src/cards/index.ts`. The compiler checks that every tile and every sheet is listed.

What cards share is still shared: `src/sheets/` holds the chart, the reading sheet and the popover. A chart is drawn from a look and a reading's sheet from a `ReadingSpec`, so the shared modules never branch on a card's id. A new `id ===` in `src/sheets/` is a sign that something belongs in a card.

The map keeps its own folder, because it is a subsystem with a tile rather than a tile with a sheet. Hourly and daily are one module, sharing a mode and their rows, and the conditions sheet lives with them because it has no tile of its own.
