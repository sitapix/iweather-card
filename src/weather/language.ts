// Resolve the card's language aliases without loading its translation tables.
export function languageOf(tag: string): string {
  const [base = '', ...subtags] = tag.toLowerCase().split(/[-_]/u);
  if (base === 'no' || base === 'nn') return 'nb';
  if (base !== 'zh') return base;
  const [first = '', second = ''] = subtags;
  if (first === 'hant' || first === 'hans') return first === 'hant' ? 'zh-Hant' : 'zh-Hans';
  const region = /^[a-z]{4}$/u.test(first) ? second : first;
  return ['tw', 'hk', 'mo'].includes(region) ? 'zh-Hant' : 'zh-Hans';
}
