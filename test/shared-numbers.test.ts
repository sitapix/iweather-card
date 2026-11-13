import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import { NARROW } from '../src/card/parts.ts';
import { SUN_PLOT } from '../src/cards/sun/sheet.ts';
import { MOTION } from '../src/map/moves.ts';
import { GROUNDS } from '../src/map/gl.ts';
import { CLEAR_BAND, PLOT } from '../src/sheets/chart.ts';
import { SHEET_TAIL } from '../src/sheets/popover.ts';
import { DOCK } from '../src/sheets/sheets.ts';

// A few numbers are the scripts' and the styles' both. Some sit in container queries, which custom
// properties can't reach, so these hold them to each other instead.
const styles = readFileSync(new URL('../src/iweather-card.css', import.meta.url), 'utf8');
const has = (text: string) => assert.ok(styles.includes(text), `the styles should have ${text}`);
const PERCENT = 100,
  MS_PER_SECOND = 1000;

test('the docked map takes the share the page gives up', () => {
  const page = PERCENT - DOCK.share * PERCENT;
  has(`.detail[data-docked]{position:absolute;inset:0 0 0 auto;width:${DOCK.share * PERCENT}%`);
  has(`:host([data-docked]) .frame{display:block;width:${page}%`);
  has(`:host([data-docked]) .weather{width:calc(100% / ${String(page / PERCENT).replace(/^0/, '')})}`);
});
test('the page beside the dock holds three columns from the width that gives it three', () => {
  has(`@container card (min-width:${DOCK.least}px){.weather[data-layout=page]{--cols:3}}`);
});
test('the glass and what is drawn round it reach past the sheet by its tail, all round', () => {
  for (const part of ['glass', 'edge']) has(`.detail .sheet-${part}{position:absolute;inset:-${SHEET_TAIL.depth}px`);
  has(`transform-origin:calc(var(--tip-x) + ${SHEET_TAIL.depth}px) calc(var(--tip-y) + ${SHEET_TAIL.depth}px)`);
  has(`transform-origin:50% calc(100% - ${SHEET_TAIL.depth}px)`);
});
test('the sheet and the band over it are rounded as the glass is', () => {
  has(`border:0;border-radius:${SHEET_TAIL.radius}px}`);
  has(`border-radius:${SHEET_TAIL.radius}px ${SHEET_TAIL.radius}px 0 0`);
});
test('the sun chart’s plot is as tall as its drawing’s scale takes it to be', () => {
  has(`grid-template-rows:${SUN_PLOT.height}px var(--hours)`);
});
test('the map eases for as long as the scripts wait for it', () => {
  has(`[data-eased]{transition:translate ${String(MOTION.ease / MS_PER_SECOND).replace(/^0/, '')}s`);
});
test('the drops on the glass take the panels’ own saturation', () => {
  const shader = readFileSync(new URL('../src/sky/glass-gl.ts', import.meta.url), 'utf8');
  has('--material:blur(15px) contrast(.8) brightness(.853) saturate(1.7);');
  assert.ok(shader.includes('.0722))), m, 1.7)'), 'the shader should saturate as the material does');
});
test('a card too narrow for the switch is one the styles lay out as narrow', () => {
  has(`@container card (width < ${NARROW}px)`);
});
test('a chart’s plot and clear band are as tall as the scripts place its scale in', () => {
  has(`.chart[data-size]{--plot:${PLOT.small}px;`);
  has(`--clear:${CLEAR_BAND}px;`);
  has(`.chart[data-size=tall]{--plot:${PLOT.tall}px;`);
});
test('on a dark theme, tiles come to the ground the live map draws', () => {
  const [, contrast, brightness] =
    /\[data-kind=wind\]\) \.radar-layer\.osm img\{filter:grayscale\(1\) invert\(1\) contrast\((.+?)\) brightness\((.+?)\)\}/.exec(
      styles,
    ) ?? [];
  // A tile's land and water, grey by their luminance, then as the filter goes.
  const shown = (red: number, green: number, blue: number) => {
    const grey = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    return (((255 - grey) / 255 - 0.5) * Number(contrast) + 0.5) * 255 * Number(brightness);
  };
  const level = (colour: string | undefined) => Number.parseInt(colour?.slice(3, 5) ?? '', 16);
  assert.ok(Math.abs(shown(242, 239, 233) - level(GROUNDS.night.land)) < 3, 'land');
  assert.ok(Math.abs(shown(170, 211, 223) - level(GROUNDS.night.water)) < 3, 'water');
});
