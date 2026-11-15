import compat from 'eslint-plugin-compat';
import { defineConfig } from 'eslint/config';

// One check, on the card as built: that it uses only what the browsers in package.json's
// `browserslist` have, as far as this plugin's tables go (they hold some newer methods and many web
// APIs, not every one). Biome and oxlint lint the sources; this reads only dist/. MapLibre's file is
// its own project's.
export default defineConfig([
  {
    files: ['dist/iweather-card.js'],
    plugins: { compat },
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    rules: { 'compat/compat': 'error' },
  },
]);
