import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';
import type { Plugin } from 'vite';

// The site's documentation: the repository's own Markdown, set as pages beside the demo, so what a
// visitor reads there is what the repository says. A page is a whole file, or one section of one.
// Links between the files become links between the pages; a link to anything that is no page goes
// to the repository.

const REPOSITORY = 'https://github.com/sitapix/iweather-card';
const ROOT = fileURLToPath(new URL('../', import.meta.url));

export interface DocPage {
  // Its folder under docs/ on the site.
  slug: string;
  // What the site's list of pages calls it.
  title: string;
  description: string;
  // The file it is read from, from the repository's root.
  source: string;
  // The one second-level section of that file it holds, by its heading.
  section?: string;
}
export const DOCS: readonly DocPage[] = [
  {
    slug: 'examples',
    title: 'Dashboard examples',
    description: 'Copy the YAML for a city tile, a wall tablet, or a dashboard with your own weather sensors.',
    source: 'docs/examples.md',
  },
  {
    slug: 'configuration',
    title: 'Configuration',
    description: 'Find a setting by name, check its default, and see which layouts use it.',
    source: 'docs/configuration.md',
  },
  {
    slug: 'tiles',
    title: 'Detail tiles',
    description: 'See what each Full page tile shows and which reading it needs to appear.',
    source: 'README.md',
    section: 'Detail tiles',
  },
  {
    slug: 'privacy',
    title: 'Privacy',
    description: 'See which services receive your forecast location and how to keep requests on your network.',
    source: 'README.md',
    section: 'What leaves your browser',
  },
];
// The README's sections the setup page tells in its own words, and where.
const SETUP: Readonly<Record<string, string>> = {
  install: 'install',
  hacs: 'hacs',
  manual: 'by-hand',
  use: 'add',
  layouts: 'layouts',
};

// A heading's anchor, as the repository's own pages give it.
export const anchorOf = (heading: string): string =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replaceAll(' ', '-');

const SECTION = /^## +(.+?)\s*$/u;
// A page's Markdown: its file, or the one section of it under a first-level heading.
export function markdownOf(page: DocPage, read: (source: string) => string = readSource): string {
  const text = read(page.source);
  if (page.section === undefined) return text;
  const lines = text.split('\n'),
    start = lines.findIndex(line => SECTION.exec(line)?.[1] === page.section);
  if (start < 0) throw new Error(`${page.source} has no section “${page.section}”.`);
  const length = lines.slice(start + 1).findIndex(line => SECTION.test(line));
  return [`# ${page.section}`, ...lines.slice(start + 1, length < 0 ? undefined : start + 1 + length)].join('\n');
}
const readSource = (source: string) => readFileSync(posix.join(ROOT, source), 'utf8');

const HEADING = /^(#{1,6}) +(.+?)\s*$/u;
const FENCE = /^(`{3,}|~{3,})/u;
// The anchors a page's headings give, in order, with each heading's depth and words.
export function headingsOf(markdown: string): { depth: number; text: string; anchor: string }[] {
  let fenced = false;
  return markdown.split('\n').flatMap(line => {
    if (FENCE.test(line)) fenced = !fenced;
    const [, marks, words] = fenced ? [] : (HEADING.exec(line) ?? []);
    if (marks === undefined || words === undefined) return [];
    const text = words.replace(/[`*_]/gu, '').replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1');
    return [{ depth: marks.length, text, anchor: anchorOf(text) }];
  });
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/iu;
// Where a link written in `page`'s file leads on the site.
export function linkFrom(page: DocPage, href: string, read: (source: string) => string = readSource): string {
  if (SCHEME.test(href) || href.startsWith('//')) return href;
  const [path = '', anchor = ''] = href.split('#'),
    file = path === '' ? page.source : posix.normalize(posix.join(posix.dirname(page.source), path)),
    hash = anchor === '' ? '' : `#${anchor}`;
  // Above the repository's root: its issues and discussions, written from the README.
  if (file.startsWith('..')) return `${REPOSITORY}/${file.replace(/^(\.\.\/)+/u, '')}${hash}`;
  const pages = DOCS.filter(each => each.source === file),
    whole = pages.find(each => each.section === undefined),
    part = pages.find(each => headingsOf(markdownOf(each, read)).some(heading => heading.anchor === anchor)),
    to = path === '' && part === undefined && page.section === undefined ? page : (part ?? whole);
  if (to !== undefined) {
    // A section's own heading is the top of its page.
    const top = to.section !== undefined && anchor === anchorOf(to.section);
    return `${to === page ? '' : `../${to.slug}/`}${top ? (to === page ? '#' : '') : hash}`;
  }
  const setup = file === 'README.md' ? SETUP[anchor] : undefined;
  if (setup !== undefined) return `../../setup/#${setup}`;
  return file === 'README.md' ? `${REPOSITORY}${hash}` : `${REPOSITORY}/blob/main/${file}${hash}`;
}

const TAGS = /<[^>]+>/gu;
const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};
const plain = (html: string) =>
  html.replace(TAGS, '').replace(/&(?:amp|lt|gt|quot|#39);/gu, entity => ENTITIES[entity] ?? entity);

const escaped = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

const settingSearch = `<form class="setting-search" role="search" aria-label="Configuration settings" hidden>
  <label for="setting-query">Find a setting</label>
  <input id="setting-query" name="setting" type="search" placeholder="Try forecast_days or radar" autocomplete="off" spellcheck="false">
  <p role="status"></p>
  <ul></ul>
</form>`;

// Keep the repository's table of contents on GitHub. On the site every guide gets the same outline.
const CONTENTS_LINK = /^\[[^\]]+\]\(#[^)]+\)$/u;

export function htmlOf(page: DocPage, read: (source: string) => string = readSource): string {
  const markdown = markdownOf(page, read),
    sections = headingsOf(markdown).filter(heading => heading.depth === 2);
  let section = '';
  const marked = new Marked({
    gfm: true,
    walkTokens: token => {
      if (token.type === 'link' && typeof token['href'] === 'string')
        token['href'] = linkFrom(page, token['href'], read);
    },
    renderer: {
      heading({ depth, tokens }) {
        const inner = this.parser.parseInline(tokens),
          name = plain(inner),
          id = anchorOf(name);
        if (depth === 1) return `<h1>${inner}</h1>\n`;
        if (depth === 2) section = name;
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}">${inner}</a></h${depth}>\n`;
      },
      list({ items }) {
        return page.slug === 'configuration' && !section && items.every(item => CONTENTS_LINK.test(item.text))
          ? ''
          : false;
      },
      table({ header, rows }) {
        const heads = header.map(cell => this.parser.parseInline(cell.tokens)),
          options = heads[0] === 'Option' && heads[1] === 'Default',
          titles = heads.map(head => `<th scope="col" role="columnheader">${head}</th>`).join('');
        const body = rows.map(row => {
          const cells = row.map((cell, i) => {
            let value = this.parser.parseInline(cell.tokens);
            if (options && i === 0)
              value = value.replace(
                /<code>([a-z_]+)<\/code>/gu,
                (_, key: string) =>
                  `<code class="setting-key" tabindex="-1" id="${anchorOf(section)}-${key}">${key}</code>`,
              );
            const label =
              i > 0 && heads[i] !== 'Description'
                ? `<span class="cell-label" aria-hidden="true">${heads[i] ?? ''}</span>`
                : '';
            return `<td role="cell">${label}${value}</td>`;
          });
          return `<tr role="row">${cells.join('')}</tr>`;
        });
        return `<table class="reference-table" role="table" data-section="${escaped(section)}"><thead role="rowgroup"><tr role="row">${titles}</tr></thead><tbody role="rowgroup">${body.join('')}</tbody></table>\n`;
      },
    },
  });
  const html = marked.parse(markdown, { async: false });
  if (!sections.length) return html;
  const links = sections.map(heading => `<li><a href="#${heading.anchor}">${escaped(heading.text)}</a></li>`),
    outline = `<details class="doc-outline"><summary>On this page</summary><ul>${links.join('')}</ul></details>`;
  return html.replace('<h2 ', `${page.slug === 'configuration' ? settingSearch : ''}${outline}<h2 `);
}

export function navOf(page: DocPage | 'setup'): string {
  const setup = page === 'setup',
    docs = setup ? '../docs/' : '../',
    link = (title: string, href: string, active: boolean) =>
      `<li><a href="${href}"${active ? ' aria-current="page"' : ''}>${escaped(title)}</a></li>`;
  return `<details class="guide-menu"><summary>Browse guides</summary><ul>${[
    link('Docs overview', docs, false),
    link('Setup guide', setup ? './' : '../../setup/', setup),
    ...DOCS.map(each => link(each.title, `${docs}${each.slug}/`, each === page)),
  ].join('')}</ul></details>`;
}

function guideList(): string {
  return DOCS.map(
    page =>
      `<li><a href="./${page.slug}/" aria-labelledby="guide-${page.slug}" aria-describedby="about-${page.slug}"><strong id="guide-${page.slug}">${escaped(page.title)}</strong><span id="about-${page.slug}">${escaped(page.description)}</span></a></li>`,
  ).join('');
}

const PAGE = /\/docs\/([^/]+)\/index\.html$/u;
export function docPages(): Plugin {
  return {
    name: 'iweather-doc-pages',
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        const file = context.filename.replaceAll('\\', '/');
        if (file.endsWith('/docs/index.html')) return html.replace('<!--doc-guides-->', guideList());
        if (file.endsWith('/setup/index.html')) return html.replace('<!--doc-nav-->', navOf('setup'));
        const slug = PAGE.exec(file)?.[1],
          page = DOCS.find(each => each.slug === slug);
        if (!page) return html;
        return html
          .replaceAll('<!--doc-title-->', escaped(page.title))
          .replace('<!--doc-description-->', escaped(page.description))
          .replace('<!--doc-nav-->', navOf(page))
          .replace('<!--doc-body-->', htmlOf(page));
      },
    },
  };
}
