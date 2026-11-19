import { copyYaml } from './copy-yaml.ts';

const menu = document.querySelector<HTMLDetailsElement>('.guide-menu');
if (menu) {
  const narrow = matchMedia('(max-width: 820px)');
  menu.open = !narrow.matches;
  narrow.addEventListener('change', event => {
    menu.open = !event.matches;
  });
}

for (const code of document.querySelectorAll<HTMLElement>('pre > code.language-yaml')) {
  const pre = code.parentElement;
  if (!pre) continue;
  const block = document.createElement('div'),
    bar = document.createElement('div'),
    status = document.createElement('span'),
    button = document.createElement('button');
  block.className = 'doc-snippet';
  bar.className = 'snippet-actions';
  status.setAttribute('role', 'status');
  button.type = 'button';
  button.textContent = 'Copy YAML';
  button.addEventListener('click', () => {
    void copyYaml(code).then(message => {
      status.textContent = message;
    });
  });
  pre.before(block);
  bar.append(status, button);
  block.append(pre, bar);
}

const RESULT_LIMIT = 8;
const searchable = (value: string) =>
  value
    .toLowerCase()
    .replace(/[_\s]+/gu, ' ')
    .trim();

function enableSettingSearch(form: HTMLFormElement) {
  const input = form.querySelector('input'),
    status = form.querySelector('[role=status]'),
    list = form.querySelector('ul');
  if (!input || !status || !list) return;
  const settings = Array.from(document.querySelectorAll('.setting-key'), key => {
    const title = key.textContent,
      section = key.closest('table')?.dataset['section'] ?? '',
      description = key.closest('tr')?.lastElementChild?.textContent ?? '';
    return {
      id: key.id,
      title,
      section,
      name: searchable(title),
      text: searchable(`${title} ${section} ${description}`),
    };
  });
  const showMatches = () => {
    const query = searchable(input.value);
    list.replaceChildren();
    if (!query) {
      status.textContent = '';
      return;
    }
    const terms = query.split(/\s+/u),
      found = settings.filter(setting => terms.every(term => setting.text.includes(term))),
      matches = [
        ...found.filter(setting => setting.name === query),
        ...found.filter(setting => setting.name !== query && setting.name.includes(query)),
        ...found.filter(setting => !setting.name.includes(query)),
      ];
    for (const match of matches.slice(0, RESULT_LIMIT)) {
      const li = document.createElement('li'),
        link = document.createElement('a'),
        name = document.createElement('code'),
        group = document.createElement('span');
      link.href = `#${match.id}`;
      name.textContent = match.title;
      group.textContent = match.section;
      link.append(name, group);
      li.append(link);
      list.append(li);
    }
    if (!matches.length) status.textContent = 'No matching settings. Try a shorter name or a word like “map”.';
    else if (matches.length > RESULT_LIMIT)
      status.textContent = `Showing ${RESULT_LIMIT} of ${matches.length} matches. Type more to narrow the list.`;
    else status.textContent = matches.length === 1 ? '1 match' : `${matches.length} matches`;
  };
  form.hidden = false;
  input.addEventListener('input', showMatches);
  form.addEventListener('submit', event => {
    event.preventDefault();
    list.querySelector('a')?.focus();
  });
  showMatches();
}
const search = document.querySelector<HTMLFormElement>('.setting-search');
if (search) enableSettingSearch(search);
