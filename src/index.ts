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

interface OutputAsset {
  type: 'asset';
  source: string | Uint8Array;
}

interface OutputChunk {
  type: 'chunk';
  code: string;
  fileName: string;
}

type OutputBundle = Record<string, OutputAsset | OutputChunk>;

interface NiuPlugin {
  name: string;
  enforce: 'post';
  apply: 'build';
  generateBundle: (options: unknown, bundle: OutputBundle) => Promise<void>;
}

export function niuPlugin(options: NiuPluginOptions = {}): NiuPlugin {
  const { include = [/\.[cm]?js$/], exclude = [], ...minifyOptions } = options;
  return {
    name: 'niu',
    enforce: 'post',
    apply: 'build',
    async generateBundle(_options: unknown, bundle: OutputBundle): Promise<void> {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk') {
          continue;
        }
        if (exclude.some((re) => re.test(fileName))) {
          continue;
        }
        if (!include.some((re) => re.test(fileName))) {
          continue;
        }
        const result = await minify(chunk.code, minifyOptions);
        chunk.code = result.code;
      }
    },
  };
}

export { constsToLets } from './transforms/constsToLets.js';
export { hoistDuplicateLiterals } from './transforms/hoistDuplicateLiterals.js';
export { hoistGlobals } from './transforms/hoistGlobals.js';
export { mangleIdentifiers } from './transforms/mangleIdentifiers.js';
export type { MinifyOptions, MinifyResult } from './types.js';
