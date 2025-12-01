import type { NodePath } from '@babel/traverse';
import _traverse from '@babel/traverse';
import type { File, VariableDeclaration } from '@babel/types';
import type { ConstsToLetsResult } from '../types.js';

const traverse = (_traverse as unknown as { default: typeof _traverse.default }).default;

/**
 * Converts all `const` declarations to `let`.
 *
 * Saves 2 bytes per declaration ("const" -> "let").
 */
export function constsToLets(ast: File): ConstsToLetsResult {
  traverse(ast, {
    VariableDeclaration(path: NodePath<VariableDeclaration>): void {
      if (path.node.kind === 'const') {
        path.node.kind = 'let';
      }
    },
  });

  return { ast };
}
