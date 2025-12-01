import _generate from '@babel/generator';
import { parse } from '@babel/parser';
import type { File } from '@babel/types';
import { minify as terserMinify } from 'terser';
import { constsToLets } from './transforms/constsToLets.js';
import { hoistDuplicateLiterals } from './transforms/hoistDuplicateLiterals.js';
import { hoistGlobals } from './transforms/hoistGlobals.js';
import { mangleIdentifiers } from './transforms/mangleIdentifiers.js';
import type { MinifyOptions, MinifyResult } from './types.js';

const generate = (_generate as unknown as { default: typeof _generate.default }).default;

const PARSER_OPTIONS = {
  sourceType: 'unambiguous' as const,
  plugins: [
    'jsx' as const,
    'typescript' as const,
    'classProperties' as const,
    'classPrivateProperties' as const,
  ],
};

export async function minify(code: string, options: MinifyOptions = {}): Promise<MinifyResult> {
  const {
    terserOptions,
    hoistDuplicateLiterals: doHoist,
    hoistGlobals: doHoistGlobals,
    constsToLets: doConstsToLets,
  } = options;

  let inputCode = code;
  if (terserOptions !== undefined) {
    const terserResult = await terserMinify(code, terserOptions);
    if (terserResult.code !== undefined) {
      inputCode = terserResult.code;
    }
  }

  let ast: File = parse(inputCode, PARSER_OPTIONS);

  if (doHoistGlobals === true) {
    const result = hoistGlobals(ast);
    ast = result.ast;
  }

  if (doHoist === true) {
    const result = hoistDuplicateLiterals(ast, options);
    ast = result.ast;
  }

  // Re-parse to rebuild scopes for mangling (Babel caches scope data on AST nodes)
  const intermediate = generate(ast, { compact: true });
  ast = parse(intermediate.code, PARSER_OPTIONS);

  const mangleResult = mangleIdentifiers(ast);
  ast = mangleResult.ast;

  if (doConstsToLets === true) {
    const result = constsToLets(ast);
    ast = result.ast;
  }

  const output = generate(ast, {
    compact: true,
    minified: true,
    comments: false,
  });

  return { code: output.code };
}

export interface NiuPluginOptions extends MinifyOptions {
  include?: RegExp[];
  exclude?: RegExp[];
}

interface NiuPlugin {
  name: string;
  enforce: 'post';
  apply: 'build';
  renderChunk: (
    code: string,
    chunk: { fileName: string }
  ) => Promise<{ code: string; map: null } | null>;
}

export function niuPlugin(options: NiuPluginOptions = {}): NiuPlugin {
  const { include = [/\.[cm]?js$/], exclude = [], ...minifyOptions } = options;
  return {
    name: 'niu',
    enforce: 'post',
    apply: 'build',
    async renderChunk(
      code: string,
      chunk: { fileName: string }
    ): Promise<{ code: string; map: null } | null> {
      if (exclude.some((re) => re.test(chunk.fileName))) {
        return null;
      }
      if (!include.some((re) => re.test(chunk.fileName))) {
        return null;
      }
      const result = await minify(code, minifyOptions);
      return { code: result.code, map: null };
    },
  };
}

export { constsToLets } from './transforms/constsToLets.js';
export { hoistDuplicateLiterals } from './transforms/hoistDuplicateLiterals.js';
export { hoistGlobals } from './transforms/hoistGlobals.js';
export { mangleIdentifiers } from './transforms/mangleIdentifiers.js';
export type { MinifyOptions, MinifyResult } from './types.js';
