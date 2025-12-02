import type { NodePath } from '@babel/traverse';
import type { File, Identifier, Node, StringLiteral } from '@babel/types';
import type { MinifyOptions as TerserMinifyOptions } from 'terser';

export interface MinifyOptions {
  readonly terserOptions?: TerserMinifyOptions;
  readonly hoistDuplicateLiterals?: boolean;
  readonly hoistGlobals?: boolean;
  readonly constsToLets?: boolean;
  /** @internal Skip terser passes - for testing only */
  readonly __INTERNAL_disableTerser?: boolean;
}

/** Result of the minify function. */
export interface MinifyResult {
  readonly code: string;
}

/** A binding created by hoisting a literal value. */
export interface HoistedBinding {
  readonly name: string;
  readonly value: Node;
  readonly occurrences: number;
}

/** Result of the hoistDuplicateLiterals transform. */
export interface HoistResult {
  readonly ast: File;
  readonly hoistedLiteralBindings: readonly HoistedBinding[];
}

/** Result of the constsToLets transform. */
export interface ConstsToLetsResult {
  readonly ast: File;
}

/** A global identifier that was hoisted to a variable. */
export interface HoistedGlobal {
  readonly name: string;
  readonly globalName: string;
  readonly occurrences: number;
}

/** Result of the hoistGlobals transform. */
export interface HoistGlobalsResult {
  readonly ast: File;
  readonly hoistedGlobals: readonly HoistedGlobal[];
}

/** Tracks where a string value appears in the AST. */
export interface StringUsage {
  readonly literalNodes: NodePath<StringLiteral>[];
  readonly propertyAccessNodes: NodePath<StringLiteral>[];
  readonly objectPropertyNodes: NodePath<StringLiteral>[];
}

/** Info about a non-string literal in the AST. */
export interface LiteralInfo {
  readonly type: LiteralType;
  readonly value: LiteralValue;
  readonly nodes: NodePath[];
}

export type LiteralType = 'string' | 'number' | 'boolean' | 'null' | 'undefined' | 'bigint';
export type LiteralValue = string | number | boolean | null | undefined | bigint;

/** Decision to hoist a non-string literal. */
export interface HoistDecision {
  readonly type: LiteralType;
  readonly value: LiteralValue;
  readonly usage?: StringUsage;
  readonly nodes?: readonly NodePath[];
  readonly occurrences: number;
  readonly profit: number;
}

/** Decision to hoist a string with selective category hoisting. */
export interface SelectiveStringHoistDecision {
  readonly type: 'string';
  readonly value: string;
  readonly usage: StringUsage;
  readonly occurrences: number;
  readonly profit: number;
  readonly hoistLiterals: boolean;
  readonly hoistPropertyAccess: boolean;
  readonly hoistObjectProperties: boolean;
}

/** Usage counts for a string value across different contexts. */
export interface UsageCounts {
  readonly literalCount: number;
  readonly propertyAccessCount: number;
  readonly objectPropertyCount: number;
}

/** Babel's internal scope representation. */
export interface BabelScope {
  uid: number;
  path: NodePath;
  block: Node;
  labels: Map<string, NodePath>;
  inited: boolean;
  bindings: Record<string, unknown>;
  references: Record<string, boolean>;
  globals: Record<string, Identifier>;
  uids: Record<string, boolean>;
  data: Record<string, unknown>;
  crawling: boolean;
  parent?: BabelScope;
}
