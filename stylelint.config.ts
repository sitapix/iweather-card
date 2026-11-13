import type { Config } from 'stylelint';

// `pnpm compat`, with the built card: that the styles use only what the browsers in package.json's
// `browserslist` can draw, by the browsers' own compatibility tables. Biome lints the styles as
// written; this asks only what each browser has. Each feature allowed below is one a browser that
// lacks it can do without, and says what that browser shows instead.
export default {
  plugins: ['stylelint-browser-compat'],
  rules: {
    'plugin/browser-compat': [
      true,
      {
        allow: {
          features: [
            // Scrollbars are hidden or tinted by one or the other; a browser with neither draws its own.
            'properties.scrollbar-color',
            'properties.scrollbar-width',
            'selectors.-webkit-scrollbar',
            // Written as a pair in each rule, and each browser reads the one it has.
            'properties.mask-composite',
            'properties.-webkit-mask-composite',
            // Firefox before 126 draws the page layout a fifth larger, and its tile headers smaller.
            'properties.zoom',
            // Safari before 17.4 draws the gauge's mark with square ends.
            'properties.rx',
            // Turns off scroll anchoring, which the browsers without it never do anyway.
            'properties.overflow-anchor',
            // The bottom sheet appears in place, without rising into it.
            'at-rules.starting-style',
            // Turn off the grey flash on a tap and the long-press menu, which the browsers without them
            // never show.
            'properties.-webkit-tap-highlight-color',
            'properties.-webkit-touch-callout',
          ],
        },
      },
    ],
  },
} satisfies Config;
