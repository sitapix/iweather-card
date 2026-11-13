import { defineConfig } from 'oxlint';

// What may only be used where a page exists. The update and each card's rules are plain logic
// that Node tests run, so they reach for none of these.
const PAGE_GLOBALS = [
  'CSS',
  'IntersectionObserver',
  'ResizeObserver',
  'cancelAnimationFrame',
  'customElements',
  'document',
  'getComputedStyle',
  'localStorage',
  'location',
  'matchMedia',
  'navigator',
  'requestAnimationFrame',
  'sessionStorage',
  'window',
];

// Type-aware linting on TypeScript 7's own checker (tsgolint). Four whole categories are on, so a
// rule an upgrade brings starts out on, and each one turned off says why. On top of those come the
// rules of the other categories that catch faults or hold one of the project's rules: no type
// assertions at all (`as const` aside), type-only imports kept apart, exhaustive switches, imports
// that carry their extension. Together with `tsc` this bans `any` and every way of silencing the
// checker; `pnpm lint` also fails on any inline lint-disable comment. This is the one config:
// `pnpm lint` reads no other, so a worktree's copy inside .claude can't stand in for it.
export default defineConfig({
  plugins: ['typescript', 'unicorn', 'oxc', 'import', 'promise', 'vitest', 'node'],
  options: { typeAware: true, typeCheck: true },
  ignorePatterns: ['dist/**', '.claude/**'],
  jsPlugins: ['./scripts/oxlint-rules.ts'],
  categories: { correctness: 'error', suspicious: 'error', perf: 'error', pedantic: 'error' },
  rules: {
    // Rules from the categories above, with their options.
    'no-empty': ['error', { allowEmptyCatch: true }],
    'typescript/ban-ts-comment': [
      'error',
      { 'ts-expect-error': true, 'ts-ignore': true, 'ts-nocheck': true, 'ts-check': false },
    ],
    'typescript/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
    'typescript/no-floating-promises': [
      'error',
      {
        allowForKnownSafeCalls: [{ from: 'package', package: 'vitest', name: ['test', 'describe', 'it', 'suite'] }],
      },
    ],
    // 0 is a reading, so a nullable number is never a condition: `if (temperature)` hides 0° only on
    // the day it is 0°. An empty string is as good as none, and a nullable boolean means what it says.
    'typescript/strict-boolean-expressions': [
      'error',
      { allowNullableBoolean: true, allowNullableString: true, allowNullableNumber: false, allowAny: false },
    ],
    'typescript/prefer-nullish-coalescing': ['error', { ignorePrimitives: { boolean: true, string: true } }],
    'typescript/restrict-plus-operands': [
      'error',
      { allowNumberAndString: true, allowAny: false, allowBoolean: false, allowNullish: false, allowRegExp: false },
    ],
    'typescript/restrict-template-expressions': [
      'error',
      {
        allowNumber: true,
        allowBoolean: true,
        allowAny: false,
        allowNullish: false,
        allowRegExp: false,
        allowNever: false,
      },
    ],
    'typescript/return-await': ['error', 'error-handling-correctness-only'],
    'typescript/switch-exhaustiveness-check': ['error', { considerDefaultExhaustiveForUnions: true }],
    // `expect(value, message)` is how a failing check says which case it was, and these helpers assert.
    'vitest/valid-expect': ['error', { maxArgs: 2 }],
    'vitest/expect-expect': [
      'error',
      { assertFunctionNames: ['expect', 'assert', 'assert.*', 'expectInk', 'has', 'same', 'each'] },
    ],

    // Rules from the other categories.
    'default-case-last': 'error',
    // A glob Vitest would cache with its list of files (see scripts/oxlint-rules.ts).
    'iweather/uncached-glob': 'error',
    'default-param-last': 'error',
    'guard-for-in': 'error',
    'no-alert': 'error',
    'no-label-var': 'error',
    'no-labels': 'error',
    'no-lone-blocks': 'error',
    'no-multi-str': 'error',
    'no-new-func': 'error',
    'no-proto': 'error',
    'no-regex-spaces': 'error',
    'no-return-assign': 'error',
    'no-sequences': 'error',
    'no-template-curly-in-string': 'error',
    'no-unreachable-loop': 'error',
    'no-var': 'error',
    'prefer-const': 'error',
    'prefer-exponentiation-operator': 'error',
    'prefer-object-has-own': 'error',
    'prefer-rest-params': 'error',
    'prefer-spread': 'error',

    'import/extensions': ['error', 'always', { ignorePackages: true }],
    'import/first': 'error',
    'import/no-amd': 'error',
    'import/no-commonjs': 'error',
    'import/no-cycle': 'error',
    'import/no-mutable-exports': 'error',

    'oxc/bad-bitwise-operator': 'error',
    'promise/catch-or-return': 'error',
    'promise/no-nesting': 'error',
    'promise/no-return-in-finally': 'error',
    'promise/no-return-wrap': 'error',
    'promise/prefer-catch': 'error',

    'typescript/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
    'typescript/consistent-type-exports': 'error',
    'typescript/consistent-type-imports': 'error',
    'typescript/no-dynamic-delete': 'error',
    'typescript/no-empty-object-type': 'error',
    'typescript/no-explicit-any': 'error',
    'typescript/no-import-type-side-effects': 'error',
    'typescript/no-invalid-void-type': 'error',
    'typescript/no-non-null-asserted-nullish-coalescing': 'error',
    'typescript/no-non-null-assertion': 'error',
    'typescript/no-require-imports': 'error',
    'typescript/no-unnecessary-condition': 'error',
    'typescript/prefer-as-const': 'error',
    'typescript/prefer-find': 'error',
    'typescript/prefer-for-of': 'error',
    'typescript/prefer-literal-enum-member': 'error',
    'typescript/prefer-namespace-keyword': 'error',
    'typescript/prefer-readonly': 'error',
    'typescript/prefer-reduce-type-parameter': 'error',
    'typescript/prefer-return-this-type': 'error',
    'typescript/prefer-string-starts-ends-with': 'error',
    'typescript/triple-slash-reference': 'error',
    'typescript/unified-signatures': 'error',
    'typescript/use-unknown-in-catch-callback-variable': 'error',

    'unicorn/no-document-cookie': 'error',
    'unicorn/no-length-as-slice-end': 'error',
    'unicorn/no-magic-array-flat-depth': 'error',
    'unicorn/prefer-modern-math-apis': 'error',
    'unicorn/prefer-node-protocol': 'error',

    // Off. `_` marks what is private on the card's classes, and a setter alone is how `hass` arrives.
    'accessor-pairs': 'off',
    'no-underscore-dangle': 'off',
    // How long a file or function may be is a judgement, and the sky's are long on purpose.
    'import/max-dependencies': 'off',
    'max-classes-per-file': 'off',
    'max-depth': 'off',
    'max-lines': 'off',
    'max-lines-per-function': 'off',
    // Declarations and statements read in the order that explains them.
    'sort-vars': 'off',
    'eslint/no-negated-condition': 'off',
    'no-inline-comments': 'off',
    'unicorn/no-negated-condition': 'off',
    // A local name repeating an outer one, and a helper kept beside its one caller, read fine here.
    'no-shadow': 'off',
    'unicorn/consistent-function-scoping': 'off',
    // Frames, map turns and steps of a test happen one after another on purpose.
    'no-await-in-loop': 'off',
    // `new Promise(done => setTimeout(done, ms))` and a `.then` that ends in a statement are fine.
    'no-promise-executor-return': 'off',
    'promise/always-return': 'off',
    'typescript/strict-void-return': 'off',
    // Listeners set up in a loop read shared state on purpose, an abort signal changes from outside
    // the loop that reads it, and a new image has no other handler to overwrite.
    'no-loop-func': 'off',
    'no-unmodified-loop-condition': 'off',
    'unicorn/prefer-add-event-listener': 'off',
    // The characters of a decoded `atob` string are bytes, so `charCodeAt` says what it means.
    'unicorn/prefer-code-point': 'off',
    // Types and `tsc` decide these better, and none of these allocations is on a frame's path.
    'oxc/no-map-spread': 'off',
    'typescript/prefer-readonly-parameter-types': 'off',
    'unicorn/no-useless-undefined': 'off',
    // Taste, where the rule's way is no safer: `.length` as a condition, regular expression flags,
    // `getAttribute` next to `dataset`, passing a function by name, and how values are coerced.
    'import/no-unassigned-import': 'off',
    'require-unicode-regexp': 'off',
    'unicorn/explicit-length-check': 'off',
    'unicorn/no-array-callback-reference': 'off',
    'unicorn/prefer-dom-node-dataset': 'off',
    'unicorn/prefer-number-coercion': 'off',
    'unicorn/prefer-string-replace-all': 'off',
    // A check in a loop may skip the cases it doesn't cover, and a mock's implementation types it.
    'vitest/no-conditional-expect': 'off',
    'vitest/no-conditional-in-test': 'off',
    'vitest/require-mock-type-parameters': 'off',
  },
  overrides: [
    {
      // The card's logic keeps its numbers in named constants (see scripts/oxlint-rules.ts). Every dashboard
      // loads this code, so it logs only the line naming its build, and a warning when a second copy of
      // it loads from another address. And only the entry file names the
      // card: a module that needs something of it declares a small host of its own. Older browsers
      // have no toSorted or toReversed, so the card sorts and reverses arrays of its own making.
      files: ['src/**/*.ts'],
      rules: {
        'iweather/named-numbers': 'error',
        'no-console': ['error', { allow: ['info', 'warn'] }],
        'unicorn/no-array-reverse': 'off',
        'unicorn/no-array-sort': 'off',
        'no-restricted-properties': [
          'error',
          { property: 'toSorted', message: 'Older browsers lack it: sort a copy.' },
          { property: 'toReversed', message: 'Older browsers lack it: reverse a copy.' },
        ],
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/iweather-card.ts'],
                message: 'Declare a small host interface in this module instead of naming the card.',
              },
            ],
          },
        ],
      },
    },
    {
      // Except the sky: the renderer's hand-tuned drawing values, and the published series of
      // the sun's and moon's astronomy, read best beside the code that uses them.
      files: [
        'src/sky/scene.ts',
        'src/sky/clouds.ts',
        'src/sky/cloud-decks.ts',
        'src/sky/clouds-gl.ts',
        'src/sky/droplets.ts',
        'src/sky/glass-gl.ts',
        'src/sky/rain-gpu.ts',
        'src/sky/moon.ts',
        'src/sky/sky.ts',
        'src/sky/sun.ts',
      ],
      rules: { 'iweather/named-numbers': 'off' },
    },
    {
      // The test rules know Vitest's `test`, not Playwright's, and CI runs these only by hand, so
      // a focused test here would pass with the rest unseen.
      files: ['e2e/**/*.ts'],
      rules: {
        'no-restricted-properties': [
          'error',
          { property: 'only', message: 'A focused test hides the rest of the run.' },
        ],
      },
    },
    {
      files: ['src/sheets/**/*.ts'],
      rules: { 'iweather/card-branch': 'error' },
    },
    {
      files: ['src/card/update.ts', 'src/cards/*/rules.ts'],
      rules: { 'no-restricted-globals': ['error', ...PAGE_GLOBALS] },
    },
  ],
});
