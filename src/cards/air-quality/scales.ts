import type { AirScaleId } from '../../card/config.ts';
import { phrase } from '../../weather/words.ts';
// Air quality scales, each as its publisher sets it out: what the scale is called, whether its
// level reads as a number, its range, its bands, and the colours along it. `top` is a band's
// highest reading. `tier` says how serious a band is, whatever the scale calls it: 0 clean air, 1
// tolerable, 2 and up a concern, to 5 the worst (see airTiers), so that advice stays the same
// from scale to scale. The names are in English, and said where they show.
export interface AirBand {
  readonly top: number;
  readonly name: string;
  readonly tier: number;
}
export interface AirScale {
  readonly name: string;
  readonly short: string;
  readonly title: string;
  readonly numeric: boolean;
  readonly range: readonly [low: number, high: number];
  readonly bands: readonly AirBand[];
  readonly stops: readonly string[];
  // Shown first and in full, whatever the reading.
  readonly prominent?: true;
  // Past its levels, a reading is on the continuous index behind them, in steps of this.
  readonly steps?: number;
}
export const AIR_SCALES: Readonly<Record<AirScaleId, AirScale>> = {
  us: {
    name: phrase('United States (AQI)'),
    short: phrase('AQI (US)'),
    title: phrase('Air Quality'),
    numeric: true,
    range: [0, 500],
    bands: [
      { top: 50, name: phrase('Good'), tier: 0 },
      { top: 100, name: phrase('Moderate'), tier: 1 },
      { top: 150, name: phrase('Unhealthy for Sensitive Groups'), tier: 2 },
      { top: 200, name: phrase('Unhealthy'), tier: 3 },
      { top: 300, name: phrase('Very Unhealthy'), tier: 4 },
      { top: 500, name: phrase('Hazardous'), tier: 5 },
    ],
    stops: [
      '#04de71 0',
      '#04de71 5%',
      '#ffe620 15%',
      '#ff9500 25%',
      '#fa114f 35%',
      '#aa00ff 50%',
      '#80172b 70%',
      '#80172b 100%',
    ],
  },
  at: {
    name: phrase('Austria (AQI)'),
    short: phrase('AQI (AT)'),
    title: phrase('Air Quality'),
    numeric: true,
    range: [1, 5],
    bands: [
      { top: 1, name: phrase('Good'), tier: 0 },
      { top: 2, name: phrase('Fair'), tier: 0 },
      { top: 3, name: phrase('Moderate'), tier: 1 },
      { top: 4, name: phrase('Bad'), tier: 1 },
      { top: 5, name: phrase('Extremely Bad'), tier: 5 },
    ],
    stops: ['#04de71 0', '#ccff66 25%', '#ffe620 50%', '#ff9500 75%', '#fa114f 100%'],
  },
  ca: {
    name: phrase('Canada (AQHI)'),
    short: phrase('AQHI (CA)'),
    title: phrase('Air Quality'),
    numeric: true,
    range: [1, 11],
    bands: [
      { top: 3, name: phrase('Low Health Risk'), tier: 0 },
      { top: 6, name: phrase('Moderate Health Risk'), tier: 1 },
      { top: 10, name: phrase('High Health Risk'), tier: 3 },
      { top: 11, name: phrase('Very High Health Risk'), tier: 5 },
    ],
    stops: ['#2094fa 0', '#2094fa 15%', '#ffe620 30%', '#ff9500 50%', '#fa114f 70%', '#80172b 85%'],
  },
  cn: {
    name: phrase('China (AQI)'),
    short: phrase('AQI (CN)'),
    title: phrase('Air Quality'),
    numeric: true,
    range: [0, 500],
    bands: [
      { top: 50, name: phrase('Excellent'), tier: 0 },
      { top: 100, name: phrase('Good'), tier: 0 },
      { top: 150, name: phrase('Lightly Polluted'), tier: 1 },
      { top: 200, name: phrase('Moderately Polluted'), tier: 1 },
      { top: 300, name: phrase('Heavily Polluted'), tier: 4 },
      { top: 500, name: phrase('Severely Polluted'), tier: 5 },
    ],
    stops: [
      '#04de71 0',
      '#04de71 5%',
      '#ffe620 15%',
      '#ff9500 25%',
      '#fa114f 35%',
      '#aa00ff 50%',
      '#80172b 70%',
      '#80172b 100%',
    ],
    prominent: true,
  },
  de: {
    name: phrase('Germany (LQI)'),
    short: phrase('LQI (DE)'),
    title: phrase('Air Quality'),
    numeric: false,
    range: [1, 5],
    bands: [
      { top: 1, name: phrase('Very Good'), tier: 0 },
      { top: 2, name: phrase('Good'), tier: 0 },
      { top: 3, name: phrase('Moderate'), tier: 1 },
      { top: 4, name: phrase('Poor'), tier: 3 },
      { top: 5, name: phrase('Very Poor'), tier: 4 },
    ],
    stops: ['#2094fa -25%', '#2094fa 0', '#04de71 25%', '#ffe620 50%', '#fa114f 75%', '#80172b 100%'],
  },
  es: {
    name: phrase('Spain (ICA)'),
    short: phrase('ICA (ES)'),
    title: phrase('Air Quality'),
    numeric: false,
    range: [1, 7],
    bands: [
      { top: 1, name: phrase('Good'), tier: 0 },
      { top: 2, name: phrase('Fair'), tier: 0 },
      { top: 3, name: phrase('Moderate'), tier: 1 },
      { top: 4, name: phrase('Unhealthy'), tier: 3 },
      { top: 5, name: phrase('Very Unhealthy'), tier: 4 },
      { top: 7, name: phrase('Hazardous'), tier: 5 },
    ],
    stops: [
      '#2094fa 0',
      '#04de71 16.67%',
      '#ffe620 33.33%',
      '#fa114f 50%',
      '#80172b 66.67%',
      '#aa00ff 83.33%',
      '#aa00ff 100%',
    ],
  },
  eu: {
    name: phrase('European Union (EAQI)'),
    short: phrase('EAQI (EU)'),
    title: phrase('Air Quality'),
    numeric: false,
    steps: 20,
    range: [1, 6],
    bands: [
      { top: 1, name: phrase('Good'), tier: 0 },
      { top: 2, name: phrase('Fair'), tier: 0 },
      { top: 3, name: phrase('Moderate'), tier: 1 },
      { top: 4, name: phrase('Poor'), tier: 3 },
      { top: 5, name: phrase('Very Poor'), tier: 4 },
      { top: 6, name: phrase('Extremely Poor'), tier: 5 },
    ],
    stops: [
      '#2094fa 0',
      '#2094fa 8.33%',
      '#04de71 25%',
      '#ffe620 41.67%',
      '#fa114f 58.33%',
      '#80172b 75%',
      '#aa00ff 91.67%',
      '#aa00ff 100%',
    ],
  },
  fr: {
    name: phrase('France (IQA)'),
    short: phrase('IQA (FR)'),
    title: phrase('Air Quality'),
    numeric: false,
    range: [1, 6],
    bands: [
      { top: 1, name: phrase('Good'), tier: 0 },
      { top: 2, name: phrase('Moderate'), tier: 1 },
      { top: 3, name: phrase('Deteriorated'), tier: 2 },
      { top: 4, name: phrase('Poor'), tier: 3 },
      { top: 5, name: phrase('Very Poor'), tier: 4 },
      { top: 6, name: phrase('Extremely Poor'), tier: 5 },
    ],
    stops: ['#2094fa 0', '#04de71 20%', '#ffe620 40%', '#fa114f 60%', '#80172b 80%', '#aa00ff 100%'],
  },
  ie: {
    name: phrase('Ireland (AQIH)'),
    short: phrase('AQIH (IE)'),
    title: phrase('Air Quality'),
    numeric: true,
    range: [1, 10],
    bands: [
      { top: 3, name: phrase('Good'), tier: 0 },
      { top: 4, name: phrase('Fair'), tier: 1 },
      { top: 6, name: phrase('Fair'), tier: 2 },
      { top: 9, name: phrase('Poor'), tier: 3 },
      { top: 10, name: phrase('Very Poor'), tier: 4 },
    ],
    stops: [
      '#04de71 0',
      '#2dc95a 11.11%',
      '#289944 22.22%',
      '#ffe620 33.33%',
      '#ff9500 44.44%',
      '#ff612b 55.56%',
      '#fa114f 66.67%',
      '#c12240 77.78%',
      '#80172b 88.89%',
      '#aa00ff 100%',
    ],
  },
  in: {
    name: phrase('India (NAQI)'),
    short: phrase('NAQI (IN)'),
    title: phrase('Air Quality'),
    numeric: true,
    range: [0, 500],
    bands: [
      { top: 50, name: phrase('Good'), tier: 0 },
      { top: 100, name: phrase('Satisfactory'), tier: 0 },
      { top: 200, name: phrase('Moderately Polluted'), tier: 1 },
      { top: 300, name: phrase('Poor'), tier: 3 },
      { top: 400, name: phrase('Very Poor'), tier: 4 },
      { top: 500, name: phrase('Severe'), tier: 5 },
    ],
    stops: ['#04de71 0', '#04de71 15%', '#ffe620 30%', '#ff9500 50%', '#fa114f 70%', '#80172b 85%', '#80172b 100%'],
  },
  kr: {
    name: phrase('South Korea (CAI)'),
    short: phrase('CAI (KR)'),
    title: phrase('Air Quality'),
    numeric: true,
    range: [0, 500],
    bands: [
      { top: 50, name: phrase('Good'), tier: 0 },
      { top: 100, name: phrase('Moderate'), tier: 1 },
      { top: 250, name: phrase('Unhealthy'), tier: 3 },
      { top: 500, name: phrase('Very Unhealthy'), tier: 4 },
    ],
    stops: ['#2094fa 0', '#2094fa 5%', '#04de71 15%', '#ffe620 35%', '#fa114f 60%', '#80172b 85%', '#80172b 100%'],
  },
  mx: {
    name: phrase('Mexico (ICARS)'),
    short: phrase('ICARS (MX)'),
    title: phrase('Air Quality'),
    numeric: false,
    range: [0, 201],
    bands: [
      { top: 50, name: phrase('Good'), tier: 0 },
      { top: 100, name: phrase('Acceptable'), tier: 1 },
      { top: 150, name: phrase('Poor'), tier: 3 },
      { top: 200, name: phrase('Very Poor'), tier: 4 },
      { top: 201, name: phrase('Extremely Poor'), tier: 5 },
    ],
    stops: ['#04de71 0', '#04de71 12.44%', '#ffe620 37.31%', '#ff9500 62.19%', '#fa114f 87.06%', '#aa00ff 100%'],
  },
  sg: {
    name: phrase('Singapore (PSI)'),
    short: phrase('PSI (SG)'),
    title: phrase('Air Quality'),
    numeric: true,
    range: [0, 500],
    bands: [
      { top: 50, name: phrase('Good'), tier: 0 },
      { top: 100, name: phrase('Moderate'), tier: 1 },
      { top: 200, name: phrase('Unhealthy'), tier: 3 },
      { top: 300, name: phrase('Very Unhealthy'), tier: 4 },
      { top: 500, name: phrase('Hazardous'), tier: 5 },
    ],
    stops: ['#04de71 0', '#04de71 5%', '#2094fa 12%', '#ffc240 25%', '#ff9500 45%', '#80172b 65%', '#80172b 100%'],
  },
  uk: {
    name: phrase('United Kingdom (DAQI)'),
    short: phrase('DAQI (UK)'),
    title: phrase('Air Pollution'),
    numeric: true,
    range: [1, 10],
    bands: [
      { top: 3, name: phrase('Low'), tier: 0 },
      { top: 6, name: phrase('Moderate'), tier: 1 },
      { top: 9, name: phrase('High'), tier: 3 },
      { top: 10, name: phrase('Very High'), tier: 4 },
    ],
    stops: ['#04de71 0', '#04de71 16.67%', '#ff9500 50%', '#fa114f 83.33%', '#aa00ff 100%'],
  },
};
