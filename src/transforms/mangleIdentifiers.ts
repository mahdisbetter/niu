import type { NodePath, Scope } from '@babel/traverse';
import _traverse from '@babel/traverse';
import type { File } from '@babel/types';
import * as t from '@babel/types';
import type { BabelBinding, BabelScope, BindingInfo, MangleResult, ScopeInfo } from '../types.js';

const traverse = (_traverse as unknown as { default: typeof _traverse.default }).default;

const RESERVED_WORDS = new Set([
  'break',
  'case',
  'catch',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'finally',
  'for',
  'function',
  'if',
  'in',
  'instanceof',
  'new',
  'return',
  'switch',
  'this',
  'throw',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'class',
  'const',
  'enum',
  'export',
  'extends',
  'import',
  'super',
  'implements',
  'interface',
  'let',
  'package',
  'private',
  'protected',
  'public',
  'static',
  'yield',
  'null',
  'true',
  'false',
  'undefined',
  'NaN',
  'Infinity',
  'eval',
  'arguments',
]);

const CHARS = 'etaonirshldcumfpgwybvkxjqzETAONIRSHLDCUMFPGWYBVKXJQZ$_';

/**
 * Converts an index to a valid identifier name.
 *
 * 0-53 -> a-z, A-Z, $, _
 *
 * 54+ -> aa, ab, etc.
 */
function indexToName(index: number): string {
  const base = CHARS.length;

  if (index < base) {
    return CHARS[index] ?? '';
  }

  let result = '';
  let remaining = index - base;

  result = CHARS[remaining % base] ?? '';
  remaining = Math.floor(remaining / base);

  while (remaining >= 0) {
    if (remaining < base) {
      result = (CHARS[remaining] ?? '') + result;
      break;
    }
    result = (CHARS[remaining % base] ?? '') + result;
    remaining = Math.floor(remaining / base) - 1;
  }

  return result;
}

/**
 * Creates a generator that produces unique short identifiers.
 * Skips reserved words and names already in use in the scope.
 */
function createScopedNameGenerator(reserved: ReadonlySet<string>): () => string {
  let index = 0;

  return function next(): string {
    let name: string;
    do {
      name = indexToName(index++);
    } while (RESERVED_WORDS.has(name) || reserved.has(name));
    return name;
  };
}

/** Checks if a node path is inside the given scope or any of its children. */
function isInsideScope(path: NodePath, targetScope: BabelScope): boolean {
  let currentScope: Scope | undefined = path.scope as Scope | undefined;
  while (currentScope !== undefined) {
    if (currentScope === (targetScope as unknown as Scope)) {
      return true;
    }
    currentScope = currentScope.parent;
  }
  return false;
}

/**
 * Collects names that must be reserved when mangling a scope.
 *
 * A name is reserved if it's used by an outer scope binding that's
 * referenced inside this scope.
 */
function getReservedNamesForScope(
  scope: BabelScope,
  renameMap: ReadonlyMap<BabelBinding, string>
): Set<string> {
  const reserved = new Set<string>();

  // Walk up the scope chain
  let currentScope: BabelScope | undefined = scope.parent;
  while (currentScope !== undefined) {
    for (const binding of Object.values(currentScope.bindings)) {
      const newName = renameMap.get(binding);
      if (newName === undefined) {
        continue;
      }

      // Reserve name if any reference to this binding is inside our scope
      const isReferencedInScope =
        binding.referencePaths.some((refPath) => isInsideScope(refPath, scope)) ||
        binding.constantViolations.some((violationPath) => isInsideScope(violationPath, scope));

      if (isReferencedInScope) {
        reserved.add(newName);
      }
    }
    currentScope = currentScope.parent;
  }

  return reserved;
}

/**
 * Renames all local identifiers to short names for byte savings.
 *
 * Assigns shortest names to most-referenced bindings.
 *
 * Handles scope correctly: inner scopes can reuse names from outer scopes
 *
 * unless they reference those outer bindings.
 *
 * Also renames `__niu_*` placeholder identifiers from hoisting transforms.
 */
export function mangleIdentifiers(ast: File): MangleResult {
  const renameMap = new Map<BabelBinding, string>();
  const scopeInfos: ScopeInfo[] = [];

  // Collect all scopes and their bindings
  traverse(ast, {
    Scope: {
      enter(path: NodePath): void {
        const babelScope = path.scope as unknown as BabelScope;
        const bindings: BindingInfo[] = Object.entries(babelScope.bindings)
          .filter(([_, binding]) => binding.scope === babelScope)
          .map(([name, binding]) => ({
            name,
            binding,
            // Total references: declaration + reads + writes
            references: 1 + binding.referencePaths.length + binding.constantViolations.length,
          }));

        if (bindings.length > 0) {
          scopeInfos.push({
            scope: babelScope,
            path,
            bindings,
          });
        }
      },
    },
  });

  // Assign new names per scope
  for (const scopeInfo of scopeInfos) {
    const { scope, bindings } = scopeInfo;

    // Get names that can't be reused in this scope
    const reserved = getReservedNamesForScope(scope, renameMap);

    // Sort by reference count descending (most-used get shortest names)
    const sortedBindings = [...bindings].sort((a, b) => b.references - a.references);

    const nextName = createScopedNameGenerator(reserved);

    for (const { binding } of sortedBindings) {
      const newName = nextName();
      renameMap.set(binding, newName);
    }
  }

  // Collect __niu_ placeholder renames for a single batch traversal
  const placeholderRenames = new Map<string, string>();

  // Apply renames to all identifier nodes
  for (const [binding, newName] of renameMap) {
    const oldName = binding.identifier.name;
    binding.identifier.name = newName;

    for (const refPath of binding.referencePaths) {
      if (t.isIdentifier(refPath.node)) {
        refPath.node.name = newName;
      }
    }

    for (const violationPath of binding.constantViolations) {
      if (t.isIdentifier(violationPath.node)) {
        violationPath.node.name = newName;
      } else if (t.isAssignmentExpression(violationPath.node)) {
        if (t.isIdentifier(violationPath.node.left)) {
          violationPath.node.left.name = newName;
        }
      }
    }

    // Collect __niu_ placeholders for batch rename
    if (oldName.startsWith('__niu_')) {
      placeholderRenames.set(oldName, newName);
    }
  }

  // Single traversal for all placeholder renames
  if (placeholderRenames.size > 0) {
    traverse(ast, {
      Identifier(path: NodePath): void {
        const node = path.node as t.Identifier;
        const newName = placeholderRenames.get(node.name);
        if (newName !== undefined) {
          node.name = newName;
        }
      },
      noScope: true,
    });
  }

  return { ast, renameMap };
}
