import { context2d } from '../lib/canvas.ts';
import { FULL_TURN, HALF_TURN } from '../lib/compass.ts';
import { SECOND } from '../lib/time.ts';
import {
  covers,
  tilePlace,
  tilePoint,
  windPoints,
  windStep,
  type Bounds,
  type WindGrid,
  type WindHours,
  type WindPoints,
} from './sources.ts';
import { windAt } from './sources.ts';
import { rainPlan } from './rain-grids.ts';
import { UNITS, convertUnit } from '../weather/units.ts';

// Wind on a map view: streaks drifting with the wind where each one is, every streak a moving
// point whose short trail fades behind it, so stronger wind draws longer and quicker ones while
// calm leaves little more than flecks. One streak for every 230 px² of map. Each moves, every
// second, 0.0125 of the map's width across and of its height down for each m/s of wind, in
// proportion to the wind: on a map 340 px wide, 2 m/s carries one 8.5 px a second and 15 m/s 64,
// and draws a streak of about 4 px and 30 px. Each lasts 1.5 to 3.5 s. The streaks move every
// frame the screen draws, and their trails keep three quarters of what is left 15 times a second,
// however often that is, so a trail is gone in about half a second; a smaller share each time
// would leave a haze the canvas can't fade away. The view is sampled every 8 px. Before it shows,
// a map is run 45 fifteenths of a second so that it opens full; held still, it stops there.
const STREAKS = {
  area: 230,
  share: 0.0125,
  fade: 0.25,
  life: 1.5,
  lifeSpread: 2,
  sample: 8,
  settle: 45,
} as const;
// How fast a streak drifts, in px a second, on a map `width` by `height` px in a wind pushing
// `east` and `north` m/s.
export const streakPace = (width: number, height: number, east: number, north: number): [x: number, y: number] => [
  east * STREAKS.share * width,
  -north * STREAKS.share * height,
];
const FADES = 15,
  LONGEST_STEP = 0.1,
  TILE = 256;
// Streaks by the wind in m/s: from, grey and width in the screen's own pixels, so a streak is as
// fine on a sharp screen as its pixels allow. They are drawn in grey, added to the map's blue (see
// the styles), so their heads show a pale cyan and their fading trails sink back into the blue; a
// little lighter and finer in stronger wind. A streak's head adds 0.65 of its grey to the blue, so
// even the brightest stays a soft cyan.
const HEAD = 0.65;
const SHADES = [
  [0, '#919191', 1.7],
  [3.1, '#919191', 1.7],
  [5.5, '#919191', 1.6],
  [8, '#9a9a9a', 1.5],
  [17.7, '#9a9a9a', 1.5],
  [24.5, '#a1a1a1', 1.5],
  [30, '#a1a1a1', 1.5],
] as const;
// The wind map's key covers calm to 70 knots in marks at a round step that fits three, its bar
// running from calm to the highest of them.
const KEY_KNOTS = 70;
const KEY_STEPS = [5, 10, 20, 25, 40, 50, 100];
const KEY_MARKS = 3;
export interface WindKey {
  top: number;
  marks: number[];
}
export function windKey(unit: string | undefined): WindKey | null {
  const top = convertUnit('wind_speed_unit', KEY_KNOTS, UNITS.knots, unit);
  if (top === KEY_KNOTS && unit !== UNITS.knots) return null;
  const step = KEY_STEPS.find(each => Math.floor(top / each) <= KEY_MARKS) ?? top,
    steps = Math.floor(top / step);
  return { top: steps * step, marks: Array.from({ length: steps + 1 }, (_, i) => i * step) };
}

// Where a map looks: the place at its centre and its zoom.
export interface MapCentre {
  latitude: number;
  longitude: number;
  zoom: number;
}
// A place's point in a `width` by `height` view of `centre` (px from its top left), and back.
// Across the date line, the place is the copy of it nearer the middle.
export function pointOf(centre: MapCentre, width: number, height: number, latitude: number, longitude: number) {
  const middle = tilePoint(centre.latitude, centre.longitude, centre.zoom),
    place = tilePoint(latitude, longitude, centre.zoom),
    turn = 2 ** centre.zoom,
    across = place.x - middle.x;
  return {
    x: (across - Math.round(across / turn) * turn) * TILE + width / 2,
    y: (place.y - middle.y) * TILE + height / 2,
  };
}
export function placeAt(centre: MapCentre, width: number, height: number, x: number, y: number) {
  const middle = tilePoint(centre.latitude, centre.longitude, centre.zoom);
  return tilePlace(middle.x + (x - width / 2) / TILE, middle.y + (y - height / 2) / TILE, centre.zoom);
}
// The degrees a view of `centre` spans.
export function viewBounds(centre: MapCentre, width: number, height: number): Bounds {
  const corner = placeAt(centre, width, height, 0, 0),
    opposite = placeAt(centre, width, height, width, height);
  return { north: corner.latitude, south: opposite.latitude, west: corner.longitude, east: opposite.longitude };
}
// The points to ask the wind at for a view: its own spacing apart (see windStep), over what it
// shows. With room to move in, for the large map, they reach a quarter of its size further
// each way, half as far apart again, so it can move that far before it needs more.
const ROOM = { around: 1 / 4, apart: 1.5 } as const;
export function windPointsFor(centre: MapCentre, width: number, height: number, room: boolean): WindPoints {
  const shown = viewBounds(centre, width, height),
    across = room ? (shown.east - shown.west) * ROOM.around : 0,
    down = room ? (shown.north - shown.south) * ROOM.around : 0;
  return windPoints(
    { north: shown.north + down, south: shown.south - down, west: shown.west - across, east: shown.east + across },
    windStep(centre.zoom) * (room ? ROOM.apart : 1),
  );
}
// The forecast's precipitation over the large map comes on its own grid (see rainPlan), over the
// view and an eighth of it further each way, so it can move a little before it needs more. One as
// much as half as far apart again as the view would ask for still fits, so the map can zoom a
// little way in before it asks for a finer one.
const RAIN = { room: 1 / 8 } as const,
  RAIN_COARSEST = 1.5;
export const rainBounds = (centre: MapCentre, width: number, height: number): Bounds => {
  const shown = viewBounds(centre, width, height),
    across = (shown.east - shown.west) * RAIN.room,
    down = (shown.north - shown.south) * RAIN.room;
  return { north: shown.north + down, south: shown.south - down, west: shown.west - across, east: shown.east + across };
};
// Whether a grid fits a view: it covers it, a wind grid's points no more than three times as far
// apart as the view's own spacing (see windStep), so a grid with room to move in still fits a
// step deeper; a precipitation grid's, from the model the view would ask, half as far again as
// the grid it would make.
const COARSEST = 3;
export function fitsWind(grid: WindGrid, centre: MapCentre, width: number, height: number): boolean {
  const shown = viewBounds(centre, width, height);
  if (grid.source !== 'rain') return grid.step <= COARSEST * windStep(centre.zoom) && covers(grid.bounds, shown);
  const plan = rainPlan(rainBounds(centre, width, height));
  return (
    plan !== undefined &&
    grid.model === plan.model.id &&
    grid.step <= RAIN_COARSEST * plan.points.step &&
    covers(grid.bounds, shown)
  );
}
// The large map zooms from 3 (a continent) to 13 (a town's streets), opening between them (see
// mapOpening); the small map looks no closer than 9; the radar's frames come no deeper than 7,
// stretched past it. Its middle stays off the poles, where the map ends, and within a turn of
// longitude.
export const MAP_ZOOMS = { least: 3, most: 13, small: 9, radar: 7 } as const;
const POLE = 85;
const settled = ({ latitude, longitude }: { latitude: number; longitude: number }, zoom: number): MapCentre => ({
  zoom,
  latitude: Math.max(-POLE, Math.min(POLE, latitude)),
  longitude: ((((longitude + HALF_TURN) % FULL_TURN) + FULL_TURN) % FULL_TURN) - HALF_TURN,
});
// The view dragged `dx`, `dy` px: the place that comes to its middle.
export function panMap(centre: MapCentre, width: number, height: number, dx: number, dy: number): MapCentre {
  return settled(placeAt(centre, width, height, width / 2 - dx, height / 2 - dy), centre.zoom);
}
// The view zoomed to `zoom` about (x, y) px, the place there staying where it is.
export function zoomMap(
  centre: MapCentre,
  width: number,
  height: number,
  zoom: number,
  x = width / 2,
  y = height / 2,
): MapCentre {
  const place = placeAt(centre, width, height, x, y),
    point = tilePoint(place.latitude, place.longitude, zoom);
  return settled(tilePlace(point.x - (x - width / 2) / TILE, point.y - (y - height / 2) / TILE, zoom), zoom);
}
// The large map's motion since it was drawn: moved `dx`, `dy` px and scaled `scale` times
// about its middle, as one transform on its layer until it is drawn again where it came to.
export interface Motion {
  dx: number;
  dy: number;
  scale: number;
}
export const STILL: Motion = { dx: 0, dy: 0, scale: 1 };
// The motion further zoomed `factor` times about (x, y) px, the point there staying put.
export function zoomMotion(motion: Motion, factor: number, x: number, y: number, width: number, height: number) {
  const middleX = width / 2,
    middleY = height / 2;
  return {
    dx: x + factor * (middleX + motion.dx - x) - middleX,
    dy: y + factor * (middleY + motion.dy - y) - middleY,
    scale: motion.scale * factor,
  };
}
// Where a motion leaves the view: the place at its middle moved with it, and the zoom as many
// steps deeper as the scale doubles, between `least` and `most`, not rounded.
export function movedMap(
  centre: MapCentre,
  width: number,
  height: number,
  { dx, dy, scale }: Motion,
  least: number,
  most: number,
): MapCentre {
  const moved = panMap(centre, width, height, dx, dy),
    zoom = Math.min(most, Math.max(least, centre.zoom + Math.log2(scale)));
  return zoom === centre.zoom ? moved : zoomMap(moved, width, height, zoom, width / 2 + dx, height / 2 + dy);
}
export interface WindMapView {
  latitude: number;
  longitude: number;
  zoom: number;
  // In CSS pixels, and the device pixels to each.
  width: number;
  height: number;
  scale: number;
  // Streaks only this far from home (px), where only home's wind is known, and where home is.
  reach?: number | undefined;
  home?: { x: number; y: number } | undefined;
}
export interface WindMapOptions {
  // Whether the streaks move; while they don't, they hold still.
  moving: () => boolean;
  // Whether the map is on screen; its loop stops while it isn't and update() resumes it.
  active: () => boolean;
  // Which hour to show, as a fractional index into the hours (see windHour).
  hour: () => number;
  // Moving, start with no trails and let them grow, as after the map has moved; else it opens
  // full (see STREAKS).
  fresh?: boolean;
}
// A drawn map, brought up to date when it is to move or its hour changes: moving, it starts;
// held still, it is drawn again for a new hour, and left as it is for the same one. New hours
// of wind for the same view carry on from the streaks as they are.
export interface WindMap {
  update: () => void;
  retarget: (hours: WindHours) => void;
}

// Draws the streaks on `canvas`, moving them until it is taken off the page; between two hours,
// the wind is blended from both.
export function drawWindMap(
  canvas: HTMLCanvasElement,
  hours: WindHours,
  view: WindMapView,
  options: WindMapOptions,
): WindMap {
  const { width: W, height: H, scale, reach } = view,
    homeX = view.home?.x ?? W / 2,
    homeY = view.home?.y ?? H / 2;
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const ctx = context2d(canvas);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.lineCap = 'round';
  // Each hour's wind across the view, in px a second, every `sample` px, made when first shown.
  const centre = tilePoint(view.latitude, view.longitude, view.zoom),
    left = centre.x * TILE - W / 2,
    top = centre.y * TILE - H / 2,
    columns = Math.ceil(W / STREAKS.sample) + 1,
    rows = Math.ceil(H / STREAKS.sample) + 1,
    places = Array.from({ length: columns * rows }, (_, i) =>
      tilePlace(
        (left + (i % columns) * STREAKS.sample) / TILE,
        (top + Math.floor(i / columns) * STREAKS.sample) / TILE,
        view.zoom,
      ),
    );
  interface Flow {
    x: Float32Array;
    y: Float32Array;
    shade: Uint8Array;
  }
  let wind = hours;
  const flows: (Flow | undefined)[] = [];
  const flow = (hour: number): Flow => {
    const made = flows[hour];
    if (made) return made;
    const field = wind.fields[hour] ?? wind.fields[0],
      x = new Float32Array(places.length),
      y = new Float32Array(places.length),
      shade = new Uint8Array(places.length);
    places.forEach((place, i) => {
      const [east, north] = field ? windAt(field, place.latitude, place.longitude) : [0, 0],
        speed = Math.hypot(east, north);
      [x[i], y[i]] = streakPace(W, H, east, north);
      shade[i] = SHADES.findLastIndex(([least]) => speed >= least);
    });
    flows[hour] = { x, y, shade };
    return flows[hour];
  };
  const count = Math.max(1, Math.round((reach === undefined ? W * H : Math.PI * reach * reach) / STREAKS.area)),
    xs = new Float32Array(count),
    ys = new Float32Array(count),
    ages = new Float32Array(count),
    lives = new Float32Array(count);
  const place = (i: number) => {
    if (reach !== undefined) {
      const angle = Math.random() * 2 * Math.PI,
        distance = reach * Math.sqrt(Math.random());
      xs[i] = homeX + Math.cos(angle) * distance;
      ys[i] = homeY + Math.sin(angle) * distance;
    } else {
      xs[i] = Math.random() * W;
      ys[i] = Math.random() * H;
    }
    ages[i] = 0;
    lives[i] = STREAKS.life + Math.random() * STREAKS.lifeSpread;
  };
  for (let i = 0; i < count; i++) {
    place(i);
    // Spread out in age, so they don't all go at once.
    ages[i] = Math.random() * (lives[i] ?? 0);
  }
  const shown = () => Math.min(wind.fields.length - 1, Math.max(0, options.hour()));
  // The hour last drawn, and the time since the trails last faded.
  let drawn = Number.NaN,
    fading = 0;
  const step = (seconds: number) => {
    fading += seconds;
    const at = shown(),
      early = Math.floor(at),
      blend = at - early,
      from = flow(early),
      to = blend > 0 ? flow(early + 1) : from,
      shades = blend < 1 / 2 ? from.shade : to.shade,
      fades = Math.floor(fading * FADES);
    drawn = at;
    if (fades) {
      fading -= fades / FADES;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0,0,0,${1 - (1 - STREAKS.fade) ** fades})`;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
    }
    const paths = SHADES.map(() => new Path2D());
    for (let i = 0; i < count; i++) {
      const x = xs[i] ?? 0,
        y = ys[i] ?? 0,
        cell =
          Math.min(rows - 1, Math.max(0, Math.round(y / STREAKS.sample))) * columns +
          Math.min(columns - 1, Math.max(0, Math.round(x / STREAKS.sample))),
        moveX = (from.x[cell] ?? 0) * (1 - blend) + (to.x[cell] ?? 0) * blend,
        moveY = (from.y[cell] ?? 0) * (1 - blend) + (to.y[cell] ?? 0) * blend,
        nx = x + moveX * seconds,
        ny = y + moveY * seconds,
        age = (ages[i] ?? 0) + seconds;
      const path = paths[shades[cell] ?? 0];
      path?.moveTo(x, y);
      path?.lineTo(nx, ny);
      const gone =
        age > (lives[i] ?? 0) ||
        nx < 0 ||
        ny < 0 ||
        nx > W ||
        ny > H ||
        (reach !== undefined && Math.hypot(nx - homeX, ny - homeY) > reach);
      if (gone) place(i);
      else {
        xs[i] = nx;
        ys[i] = ny;
        ages[i] = age;
      }
    }
    ctx.globalAlpha = HEAD;
    paths.forEach((path, i) => {
      const [, grey = '#919191', width = 1.5] = SHADES[i] ?? [];
      ctx.strokeStyle = grey;
      ctx.lineWidth = width / scale;
      ctx.stroke(path);
    });
    ctx.globalAlpha = 1;
  };
  const settle = () => {
    ctx.clearRect(0, 0, W, H);
    fading = 0;
    for (let i = 0; i < STREAKS.settle; i++) step(1 / FADES);
  };
  // Moving, a step every frame until the map is taken off the page or held still.
  let running = false,
    last = 0;
  const frame = (now: number) => {
    if (!canvas.isConnected || !options.moving() || !options.active()) {
      running = false;
      return;
    }
    requestAnimationFrame(frame);
    step(last ? Math.min(LONGEST_STEP, (now - last) / SECOND) : 1 / FADES);
    last = now;
  };
  const update = () => {
    if (!canvas.isConnected || !options.active()) return;
    if (!options.moving()) {
      if (shown() !== drawn) settle();
    } else if (!running) {
      running = true;
      last = 0;
      requestAnimationFrame(frame);
    }
  };
  if (options.fresh && options.moving()) drawn = shown();
  else settle();
  update();
  return {
    update,
    retarget: next => {
      wind = next;
      flows.length = 0;
      if (!options.moving()) settle();
    },
  };
}
