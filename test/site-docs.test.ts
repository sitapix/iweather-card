import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import { DOCS, anchorOf, headingsOf, htmlOf, linkFrom, markdownOf, navOf } from '../demo/docs.ts';

const REPOSITORY = 'https://github.com/sitapix/iweather-card';
const page = (slug: string) => {
  const found = DOCS.find(each => each.slug === slug);
  assert.ok(found, slug);
  return found;
};
const ids = (html: string) => new Set([...html.matchAll(/ id="([^"]+)"/gu)].map(match => match[1]));
const links = (html: string) => [...html.matchAll(/ href="([^"]+)"/gu)].flatMap(match => match[1] ?? []);

test('a heading’s anchor is the one the repository’s own pages give it', () => {
  assert.equal(anchorOf('The full-page layout'), 'the-full-page-layout');
  assert.equal(anchorOf('Next-hour precipitation'), 'next-hour-precipitation');
  assert.equal(
    anchorOf('Your weather station, with a forecast provider'),
    'your-weather-station-with-a-forecast-provider',
  );
});

test('a page of one section holds that section alone, under a heading of its own', () => {
  const tiles = markdownOf(page('tiles'));
  assert.match(tiles, /^# Detail tiles\n/u);
  assert.match(tiles, /\| `air_quality` \|/u);
  assert.doesNotMatch(tiles, /^## /mu);
  assert.throws(() => markdownOf({ slug: 'none', title: 'None', source: 'README.md', section: 'No such section' }));
});

test('headings inside a code block are no headings', () => {
  assert.deepEqual(
    headingsOf('# One\n\n```yaml\n# a comment\n```\n\n## Two `code`\n').map(heading => heading.anchor),
    ['one', 'two-code'],
  );
});

test('links between the files lead between the pages, and anything else to the repository', () => {
  const options = page('configuration'),
    examples = page('examples'),
    tiles = page('tiles');
  assert.equal(linkFrom(options, '#the-map'), '#the-map');
  assert.equal(linkFrom(examples, 'configuration.md'), '../configuration/');
  assert.equal(linkFrom(examples, 'configuration.md#the-map'), '../configuration/#the-map');
  assert.equal(linkFrom(options, '../README.md#detail-tiles'), '../tiles/');
  assert.equal(linkFrom(options, '../README.md#what-leaves-your-browser'), '../privacy/');
  assert.equal(linkFrom(options, '../README.md#manual'), '../../setup/#by-hand');
  assert.equal(linkFrom(tiles, 'docs/configuration.md#tiles-and-sheets'), '../configuration/#tiles-and-sheets');
  assert.equal(linkFrom(tiles, '#detail-tiles'), '#');
  assert.equal(linkFrom(tiles, '#credits'), `${REPOSITORY}#credits`);
  assert.equal(linkFrom(tiles, '../../issues'), `${REPOSITORY}/issues`);
  assert.equal(linkFrom(options, 'adr/0003.md'), `${REPOSITORY}/blob/main/docs/adr/0003.md`);
  assert.equal(linkFrom(options, 'https://open-meteo.com/'), 'https://open-meteo.com/');
});

test('every link on every page leads somewhere that is there', () => {
  const pages = new Map(DOCS.map(each => [each.slug, ids(htmlOf(each))])),
    setup = ids(readFileSync(new URL('../demo/setup/index.html', import.meta.url), 'utf8'));
  for (const each of DOCS) {
    const html = htmlOf(each) + navOf(each);
    assert.match(html, /<h1>/u, each.slug);
    for (const href of links(html)) {
      if (/^[a-z][a-z0-9+.-]*:/iu.test(href)) continue;
      const [path = '', anchor = ''] = href.split('#'),
        to = /^\.\.\/([^/]+)\/$/u.exec(path)?.[1],
        there =
          path === '' || path === './' ? pages.get(each.slug) : path === '../../setup/' ? setup : pages.get(to ?? '');
      assert.ok(there, `${each.slug}: ${href}`);
      if (anchor) assert.ok(there.has(anchor), `${each.slug}: ${href}`);
    }
  }
});

test('each page has a shell on the site, and the setup page leads to each', () => {
  const setup = readFileSync(new URL('../demo/setup/index.html', import.meta.url), 'utf8');
  for (const each of DOCS) {
    const shell = readFileSync(new URL(`../demo/docs/${each.slug}/index.html`, import.meta.url), 'utf8');
    for (const mark of ['<!--doc-title-->', '<!--doc-nav-->', '<!--doc-body-->'])
      assert.ok(shell.includes(mark), each.slug);
    assert.ok(setup.includes(`href="../docs/${each.slug}/"`), each.slug);
  }
});
