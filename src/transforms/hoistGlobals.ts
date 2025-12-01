import type { NodePath } from '@babel/traverse';
import _traverse from '@babel/traverse';
import type { File, Identifier } from '@babel/types';
import * as t from '@babel/types';
import type { BabelScope, HoistGlobalsResult, HoistedGlobal } from '../types.js';
import { calculateGlobalProfit } from '../utils/profitCalculator.js';

const traverse = (_traverse as unknown as { default: typeof _traverse.default }).default;

/**
 * Reserved keywords that Babel may report as "globals" but cannot be hoisted.
 *
 * These are either reserved words or special identifiers with contextual meaning.
 */
const RESERVED_KEYWORDS = new Set([
  'arguments',
  'this',
  'super',
  'undefined',
  'NaN',
  'Infinity',
  'null',
  'true',
  'false',
]);

interface GlobalInfo {
  name: string;
  references: NodePath<Identifier>[];
}

/** Checks if this identifier is the object in a member expression (e.g., `Array` in `Array.isArray`). */
function isMemberExpressionObject(path: NodePath<Identifier>): boolean {
  const parent = path.parent;
  return t.isMemberExpression(parent) && parent.object === path.node;
}

/** Checks if this identifier is the argument of a typeof expression (e.g., `typeof foo`). */
function isTypeofArgument(path: NodePath<Identifier>): boolean {
  const parent = path.parent;
  return (
    t.isUnaryExpression(parent) && parent.operator === 'typeof' && parent.argument === path.node
  );
}

/**
 * Hoists frequently-used global identifiers to local variables.
 *
 * Transforms: `Array.isArray(x); Array.from(y);`
 *
 * Into: `const a=Array; a.isArray(x); a.from(y);`
 *
 * Only hoists globals used as member expression objects (e.g., `Array.method`).
 */
export function hoistGlobals(ast: File): HoistGlobalsResult {
  const globalUsage = new Map<string, GlobalInfo>();
  const trueGlobals = new Set<string>();
  const typeofGlobals = new Set<string>();
  const pendingRefs: { name: string; path: NodePath<Identifier> }[] = [];

  // Single traversal: collect globals, typeof usage, and member expression references
  traverse(ast, {
    Program(path: NodePath<t.Program>): void {
      const scope = path.scope as unknown as BabelScope;
      for (const name of Object.keys(scope.globals)) {
        trueGlobals.add(name);
      }
    },

    Identifier(path: NodePath<Identifier>): void {
      const name = path.node.name;

      // Collect typeof arguments first (we process these after to filter)
      if (isTypeofArgument(path)) {
        typeofGlobals.add(name);
      }

      // Collect potential member expression objects
      if (isMemberExpressionObject(path) && !RESERVED_KEYWORDS.has(name)) {
        pendingRefs.push({ name, path });
      }
    },
  });

  if (trueGlobals.size === 0) {
    return { ast, hoistedGlobals: [] };
  }

  // Process collected references - filter by true globals and typeof exclusions
  for (const { name, path } of pendingRefs) {
    if (!trueGlobals.has(name) || typeofGlobals.has(name)) {
      continue;
    }

    let info = globalUsage.get(name);
    if (info === undefined) {
      info = { name, references: [] };
      globalUsage.set(name, info);
    }
    info.references.push(path);
  }

  interface GlobalDecision {
    info: GlobalInfo;
    profit: number;
  }

  const decisions: GlobalDecision[] = [];

  // Calculate profit for each global
  for (const [_, info] of globalUsage) {
    if (info.references.length < 2) {
      continue;
    }

    const profit = calculateGlobalProfit(
      info.references.length,
      info.name.length,
      1,
      decisions.length === 0
    );

    if (profit > 0) {
      decisions.push({ info, profit });
    }
  }

  // Sort by occurrence count for consistent ordering
  decisions.sort((a, b) => b.info.references.length - a.info.references.length);

  const hoistedGlobals: HoistedGlobal[] = [];

  // Replace references with placeholder identifiers
  for (let i = 0; i < decisions.length; i++) {
    const decision = decisions[i];
    if (decision === undefined) {
      continue;
    }

    const placeholderName = `__niu_global_${String(i)}__`;
    const { info } = decision;

    hoistedGlobals.push({
      name: placeholderName,
      globalName: info.name,
      occurrences: info.references.length,
    });

    for (const refPath of info.references) {
      refPath.replaceWith(t.identifier(placeholderName));
    }
  }

  // Insert declaration at program start
  if (hoistedGlobals.length > 0) {
    const declarators = hoistedGlobals.map((hoisted) =>
      t.variableDeclarator(t.identifier(hoisted.name), t.identifier(hoisted.globalName))
    );

    const declaration = t.variableDeclaration('const', declarators);

    traverse(ast, {
      Program(path: NodePath<t.Program>): void {
        path.unshiftContainer('body', declaration);
        path.stop();
      },
    });
  }

  return {
    ast,
    hoistedGlobals,
  };
}
