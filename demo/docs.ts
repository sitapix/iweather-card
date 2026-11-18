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
  // The file it is read from, from the repository's root.
  source: string;
  // The one second-level section of that file it holds, by its heading.
  section?: string;
}
export const DOCS: readonly DocPage[] = [
  { slug: 'examples', title: 'Examples', source: 'docs/examples.md' },
  { slug: 'configuration', title: 'All options', source: 'docs/configuration.md' },
  { slug: 'tiles', title: 'Detail tiles', source: 'README.md', section: 'Detail tiles' },
  { slug: 'privacy', title: 'Privacy', source: 'README.md', section: 'What leaves your browser' },
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

// A page's Markdown as the site sets it: its links led to the site's pages, its headings given
// their anchors, and each table in a box that scrolls across by itself.
export function htmlOf(page: DocPage, read: (source: string) => string = readSource): string {
  const marked = new Marked({
    gfm: true,
    walkTokens: token => {
      if (token.type === 'link' && typeof token['href'] === 'string')
        token['href'] = linkFrom(page, token['href'], read);
    },
  });
  const html = marked.parse(markdownOf(page, read), { async: false });
  return html
    .replace(/<h([1-6])>(.*?)<\/h\1>/gsu, (_, depth: string, inner: string) => {
      const id = anchorOf(plain(inner));
      return depth === '1'
        ? `<h1>${inner}</h1>`
        : `<h${depth} id="${id}"><a class="anchor" href="#${id}">${inner}</a></h${depth}>`;
    })
    .replaceAll('<table>', '<div class="table"><table>')
    .replaceAll('</table>', '</table></div>');
}

const escaped = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
// The list of pages beside a page, with the page's own sections under its name.
export function navOf(page: DocPage, read: (source: string) => string = readSource): string {
  const sections = headingsOf(markdownOf(page, read)).filter(heading => heading.depth === 2),
    own = sections.length
      ? `<ul>${sections.map(heading => `<li><a href="#${heading.anchor}">${escaped(heading.text)}</a></li>`).join('')}</ul>`
      : '';
  return [
    '<ul>',
    '<li><a href="../../setup/">Setup guide</a></li>',
    ...DOCS.map(each =>
      each === page
        ? `<li><a href="./" aria-current="page">${escaped(each.title)}</a>${own}</li>`
        : `<li><a href="../${each.slug}/">${escaped(each.title)}</a></li>`,
    ),
    '</ul>',
  ].join('');
}

const PAGE = /\/docs\/([^/]+)\/index\.html$/u;
// Fills each documentation page's shell (docs/<slug>/index.html) from its Markdown, as the page is
// served and as it is built.
export function docPages(): Plugin {
  return {
    name: 'iweather-doc-pages',
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        const slug = PAGE.exec(context.filename.replaceAll('\\', '/'))?.[1],
          page = DOCS.find(each => each.slug === slug);
        if (!page) return html;
        return html
          .replaceAll('<!--doc-title-->', escaped(page.title))
          .replace('<!--doc-nav-->', navOf(page))
          .replace('<!--doc-body-->', htmlOf(page));
      },
    },
  };
}
