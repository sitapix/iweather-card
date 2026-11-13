// The project's own lint rules, loaded by oxlint as a JS plugin (see oxlint.config.ts).
//
// iweather/named-numbers: a number in the card's logic is named. It lives in a module-level
// constant (`const STALE = 3 * HOUR`, a table of thresholds) or is one of the few that name
// themselves: 0, 1, 2 and -1, a default parameter, or a literal type. Anything else, inside a
// function, is a value someone has to guess the meaning of.
//
// iweather/card-branch: shared sheet code doesn't ask which card it is drawing. A chart takes a
// look, a day a series and a reading sheet a spec, so comparing a card's id with a name means
// something belongs in that card. Only the map's lifecycle and the averages sheet's normal range
// are named there.
//
// iweather/uncached-glob: `import.meta.glob` takes no type argument. Vitest keeps each module's
// transform on disk between runs unless its source holds the text `import.meta.glob(`, and a glob's
// list of files is part of that transform, so with a type argument a file added since is left out
// of every run without a word.

// The little of oxlint's ESTree nodes the rule reads.
interface Node {
  type: string;
  parent: Node | null;
  // VariableDeclaration
  kind?: string;
  // Literal
  value?: unknown;
  // UnaryExpression, BinaryExpression
  operator?: string;
  // AssignmentPattern, Property, BinaryExpression
  left?: Node;
  // BinaryExpression
  right?: Node;
  // Identifier
  name?: string;
  // MemberExpression
  computed?: boolean;
  property?: Node;
  // ChainExpression
  expression?: Node;
  // SwitchStatement
  discriminant?: Node;
  // CallExpression
  callee?: Node;
  typeArguments?: Node | null;
  // MemberExpression
  object?: Node;
}
interface Context {
  report(diagnostic: { node: Node; message: string }): void;
}

const ALLOWED: ReadonlySet<number> = new Set([-1, 0, 1, 2]);
const FUNCTIONS: ReadonlySet<string> = new Set([
  'ArrowFunctionExpression',
  'FunctionExpression',
  'FunctionDeclaration',
  'MethodDefinition',
  'PropertyDefinition',
]);
const MODULE_LEVEL: ReadonlySet<string> = new Set(['Program', 'ExportNamedDeclaration']);

// Whether `node` sits in a module-level `const` declaration's value, outside any function.
function inModuleConstant(node: Node): boolean {
  for (let at: Node | null = node.parent; at; at = at.parent) {
    if (FUNCTIONS.has(at.type)) return false;
    if (at.type === 'VariableDeclaration')
      return at.kind === 'const' && at.parent !== null && MODULE_LEVEL.has(at.parent.type);
  }
  return false;
}
// Whether `node` is a parameter's default value, which the parameter's name explains.
const isDefault = (node: Node): boolean => node.parent?.type === 'AssignmentPattern' && node.parent.left !== node;

const namedNumbers = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Numbers in the card’s logic live in named module-level constants.' },
  },
  create(context: Context) {
    return {
      Literal(node: Node) {
        if (typeof node.value !== 'number') return;
        const negated = node.parent?.type === 'UnaryExpression' && node.parent.operator === '-',
          value = negated ? -node.value : node.value,
          at = negated && node.parent ? node.parent : node;
        if (ALLOWED.has(value) || at.parent?.type === 'TSLiteralType' || isDefault(at) || inModuleConstant(at)) return;
        context.report({
          node: at,
          message: `Name ${value} in a module-level constant: what it is, and why it is ${value}.`,
        });
      },
    };
  },
};

const NAMED_CARDS: ReadonlySet<string> = new Set(['averages', 'map']);

// Whether `node` reads an id: `id`, `card.id` or `card?.id`.
function readsId(node: Node | undefined): boolean {
  const read = node?.type === 'ChainExpression' ? node.expression : node;
  if (read?.type === 'Identifier') return read.name === 'id';
  return read?.type === 'MemberExpression' && read.computed !== true && read.property?.name === 'id';
}

const cardBranch = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Shared sheet code doesn’t branch on a card’s id.' },
  },
  create(context: Context) {
    const message = 'Shared sheet code doesn’t branch on a card’s id: put this in the card, as a look, series or spec.';
    return {
      BinaryExpression(node: Node) {
        if (node.operator !== '===' && node.operator !== '!==') return;
        const other = readsId(node.left) ? node.right : readsId(node.right) ? node.left : undefined;
        if (other?.type !== 'Literal' || typeof other.value !== 'string' || NAMED_CARDS.has(other.value)) return;
        context.report({ node, message });
      },
      SwitchStatement(node: Node) {
        if (readsId(node.discriminant)) context.report({ node, message });
      },
    };
  },
};

const uncachedGlob = {
  meta: {
    type: 'problem',
    docs: { description: '`import.meta.glob` takes no type argument, so Vitest never caches its file list.' },
  },
  create(context: Context) {
    return {
      CallExpression(node: Node) {
        const { callee } = node;
        if (
          callee?.type === 'MemberExpression' &&
          callee.object?.type === 'MetaProperty' &&
          callee.property?.name === 'glob' &&
          node.typeArguments
        )
          context.report({
            node,
            message: 'Drop the type argument and check the values: Vitest caches a glob written this way.',
          });
      },
    };
  },
};

export default {
  meta: { name: 'iweather' },
  rules: { 'named-numbers': namedNumbers, 'card-branch': cardBranch, 'uncached-glob': uncachedGlob },
};
