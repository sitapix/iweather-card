// NOAA HRRR simulated reflectivity, in real 15-minute forecast steps. IEM publishes the newest
// complete run in its metadata; every tile is pinned to that run, never to a moving "latest" URL.
// https://mesonet.agron.iastate.edu/GIS/model.phtml
import { HOUR, MINUTE } from '../lib/time.ts';
import { isRecord, text } from '../lib/values.ts';
import { type Fetcher, askJson } from '../lib/asking.ts';
import { RADAR_NONE, type Stop, scaleColour } from './field.ts';
import type { RadarFrame } from './sources.ts';

const HOST = 'https://mesonet.agron.iastate.edu',
  TILES = `${HOST}/cache/tile.py/1.0.0/hrrr::REFD-`,
  STEP = 15 * MINUTE,
  HORIZON = 18 * HOUR,
  // IEM normally completes a run about two hours after initialization. An old run or radar
  // observation must not silently become a current next-hour forecast.
  MAX_AGE = 6 * HOUR,
  RADAR_AGE = 30 * MINUTE,
  STAMP_LENGTH = 12,
  LEAD_DIGITS = 4;
export const HRRR_CREDIT = 'NOAA HRRR · Iowa Environmental Mesonet';
// Extent of IEM's 0.02-degree raster (its world file), within HRRR's native model domain.
export const HRRR_BOUNDS = { north: 50, south: 23.2, west: -126, east: -65 } as const;
export interface RadarForecast {
  run: number;
  frames: RadarFrame[];
}
export const isForecastTile = (url: string) => url.startsWith(TILES);
export const radarTemplate = ({ url }: RadarFrame) => (isForecastTile(url) ? url : `${url}/512/{z}/{x}/{y}/2/1_1.png`);

export async function radarForecast(now: number, fetcher: Fetcher = fetch): Promise<RadarForecast | null> {
  const data = await askJson(fetcher, `${HOST}/data/gis/images/4326/hrrr/refd_1080.json`, 'HRRR metadata:');
  if (!isRecord(data) || !text(data['model_init_utc']) || !text(data['model_forecast_utc'])) return null;
  const run = Date.parse(data['model_init_utc']),
    end = Date.parse(data['model_forecast_utc']);
  if (
    !Number.isFinite(run) ||
    run > now ||
    now - run > MAX_AGE ||
    run % HOUR !== 0 ||
    end !== run + HORIZON ||
    data['forecast_minute'] !== HORIZON / MINUTE
  )
    return null;
  const stamp = new Date(run).toISOString().replace(/\D/g, '').slice(0, STAMP_LENGTH);
  return {
    run,
    frames: Array.from({ length: HORIZON / STEP + 1 }, (_, i) => ({
      time: run + i * STEP,
      url: `${TILES}F${String((i * STEP) / MINUTE).padStart(LEAD_DIGITS, '0')}-${stamp}/{z}/{x}/{y}.png`,
    })),
  };
}
// Append only real future frames from a fresh run, up to an hour ahead. No fabricated timestamps
// or copies of the last observation. The irregular join (10-minute radar / 15-minute model) is
// interpolated using each frame's actual valid time.
export function nextRadarFrames(
  forecast: RadarForecast | null | undefined,
  observed: readonly RadarFrame[],
  now: number,
): RadarFrame[] {
  const last = observed.at(-1)?.time;
  if (
    !forecast ||
    forecast.run > now ||
    now - forecast.run > MAX_AGE ||
    last === undefined ||
    last > now ||
    now - last > RADAR_AGE
  )
    return [];
  return forecast.frames.filter(frame => frame.time > last && frame.time <= now + HOUR);
}

// IEM N0Q palette, also used by HRRR REFD. Index 0 is missing; index 1 is -32 dBZ,
// then 0.5 dBZ per index. Decode before interpolating or applying the card's colors.
// https://mesonet.agron.iastate.edu/GIS/rasters.php?rid=2
const PALETTE = `
  000000 85718f 85728f 86738d 87758b 87768b 887789 897987 897a87 8a7b85 8b7d84 8b7e84
  8c7f82 8d8180 8d8280 8e837e 8f847c 8f857c 90877b 918879 918979 928b77 938d75 969153
  989457 9b975b 9d9a60 a09d64 a3a068 a5a36d a8a671 aaa976 adac7a b0af7e b2b283 b7b88c
  babb90 bdbe94 bfc199 c2c49d c4c7a2 c7caa6 cacdaa ccd0af d2d4b4 cfd2b4 c9ccb4 c6c9b4
  c3c7b4 c0c4b4 bdc1b4 b9beb4 b6bbb4 b3b9b4 b0b6b4 adb3b4 aab0b4 a4abb4 a0a8b4 9da5b4
  9aa2b4 97a0b4 949db4 919ab4 949bb5 9098b4 8c95b3 8892b2 808cb0 7c89af 7886ae 7483ac
  7080ab 6c7daa 6779a9 6376a8 5f73a7 5b70a6 576da4 4f67a2 4b64a1 4761a0 435e9f 415b9e
  4361a2 4568a6 486faa 4a76ae 4d7db2 4f84b6 518bbb 5699c3 599fc7 5ba6cb 5eadcf 60b4d4
  62bbd8 65c2dc 67c9e0 6ad0e4 6fd6e8 68d6d7 59d6b3 52d6a2 4bd690 43d67e 3cd66d 35d65b
  11d518 11d117 10cd17 10c816 10c416 0fbc15 0fb714 0eb314 0eaf13 0eab13 0da612 0da212
  0d9e11 0c9911 0c9510 0c9110 0b880f 0b840e 0a800e 0a7c0d 0a770d 09730c 096f0c 096b0b
  08660b 08620a 095e09 327308 467d08 5b8807 6f9207 849d06 98a806 adb205 c1bd05 d6c704
  ead204 ffe200 ffd800 ffd300 ffce00 ffc900 ffc400 ffc000 ffbb00 ffb600 ffb100 ffac00
  ffa700 ffa200 ff9900 ff9400 ff8f00 ff8a00 ff8500 ff8000 ff0000 f80000 f10000 ea0000
  e30000 d50000 cd0000 c60000 bf0000 b80000 b10000 aa0000 a30000 9b0000 940000 8d0000
  7f0000 780000 710000 ffffff fff5ff ffeaff ffdfff ffd4ff ffc9ff ffbeff ffb3ff ff9dff
  ff92ff ff75ff fc6bfd f960fa f656f7 f34bf4 f040f1 ed36ef ea2bec e720e9 e10be3 b200ff
  ac00fc a400f7 9b00f4 9300ef 8800ea 8300e8 7900e2 7200dd 6900db 05ecf0 05ebf0 05eaf0
  05dde0 05dce0 05dbe0 05cdd0 05ccd0 04bdc0 04bcc0 04bbc0 04aeb0 04adb0 049ea0 049da0
  049ca0 038e90 038d90 038c90 037e80 037d80 036f70 036e70 036d70 025f60 025e60 024f50
  024e50 024d50 023f40 023e40 023d40 013030 012f30 012020 011f20 011e20 3a67b5 3a66b5
  3a65b5 3a64b5 3a63b5 3a62b5
`
  .trim()
  .split(/\s+/u);
const HEX = 16,
  RGB = 256,
  CHANNELS = 4,
  ALPHA = 3,
  FIRST_DBZ = -32;
const LEVELS = new Map(
  PALETTE.map((colour, index) => [
    Number.parseInt(colour, HEX),
    index === 0 ? 0 : Math.max(0, Math.round(FIRST_DBZ + (index - 1) / 2 - RADAR_NONE)),
  ]),
);
// A forecast tile's pixels (RGBA, in place) in `stops`, each read as the dBZ of its own palette;
// below the faintest stop, clear.
export function forecastRecolour(stops: readonly Stop[]): (pixels: Uint8ClampedArray) => void {
  const colours = new Map<number, readonly number[]>();
  return pixels => {
    const levels = forecastLevels(pixels);
    for (const [i, level] of levels.entries()) {
      let colour = colours.get(level);
      if (!colour) {
        const scaled = scaleColour(stops, level + RADAR_NONE).map(Math.round);
        colour = level > 0 && (scaled[ALPHA] ?? 0) > 0 ? scaled : [0, 0, 0, 0];
        colours.set(level, colour);
      }
      pixels.set(colour, i * CHANNELS);
    }
  };
}
export function forecastLevels(pixels: Uint8ClampedArray): Uint8Array {
  const levels = new Uint8Array(pixels.length / CHANNELS);
  for (let i = 0; i < levels.length; i++) {
    const at = i * CHANNELS;
    if ((pixels[at + ALPHA] ?? 0) === 0) continue;
    const colour = ((pixels[at] ?? 0) * RGB + (pixels[at + 1] ?? 0)) * RGB + (pixels[at + 2] ?? 0),
      level = LEVELS.get(colour);
    if (level === undefined) throw new Error('Unknown HRRR reflectivity palette');
    levels[i] = level;
  }
  return levels;
}
