import type { NodePath } from '@babel/traverse';
import _traverse from '@babel/traverse';
import type {
  BigIntLiteral,
  BooleanLiteral,
  ClassMethod,
  ClassProperty,
  File,
  Identifier,
  MemberExpression,
  Node,
  NullLiteral,
  NumericLiteral,
  ObjectProperty,
  StringLiteral,
} from '@babel/types';
import * as t from '@babel/types';
import type {
  HoistDecision,
  HoistResult,
  HoistedBinding,
  LiteralInfo,
  LiteralType,
  LiteralValue,
  MinifyOptions,
  SelectiveStringHoistDecision,
} from '../types.js';
import {
  calculateLiteralProfit,
  calculateSelectiveStringProfit,
  getLiteralRepresentationLength,
} from '../utils/profitCalculator.js';

const traverse = (_traverse as unknown as { default: typeof _traverse.default }).default;

const VALID_IDENTIFIER_REGEX = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

/** Checks if a string is a valid JS identifier. */
function isValidIdentifier(name: string): boolean {
  return VALID_IDENTIFIER_REGEX.test(name);
}

/** Characters that need escaping in JS strings - can't be used as delimiters. */
function needsEscaping(c: string): boolean {
  const code = c.charCodeAt(0);
  return (
    c === '"' ||
    c === "'" ||
    c === '\\' ||
    code === 0x0a || // \n
    code === 0x0d || // \r
    code === 0x2028 || // line separator
    code === 0x2029 // paragraph separator
  );
}

/**
 * Finds a single-byte UTF-8 delimiter that doesn't appear in any of the strings.
 * Only checks ASCII (0-127) since anything else is 2+ bytes in UTF-8.
 * Returns null if no suitable delimiter is found, triggering fallback to const declarations.
 */
function findDelimiter(strings: string[]): string | null {
  const allChars = new Set<string>();
  for (const s of strings) {
    for (const c of s) {
      allChars.add(c);
    }
  }

  // Preferred delimiters (common punctuation, all single-byte ASCII)
  const preferred = ',;:|!@#$%^&*~`<>?/-_=+.()[]{}';
  for (const d of preferred) {
    if (!allChars.has(d)) {
      return d;
    }
  }

  // Try all printable ASCII characters (32-126)
  for (let i = 32; i < 127; i++) {
    const c = String.fromCharCode(i);
    if (!needsEscaping(c) && !allChars.has(c)) {
      return c;
    }
  }

  // No single-byte delimiter found - return null to fall back to const declarations
  // (Characters >= 128 are 2+ bytes in UTF-8, negating the benefit of the split approach)
  return null;
}

function isSplitProfitable(stringCount: number): boolean {
  return stringCount >= 7;
}

/** Creates a Babel AST node for the given literal type and value. */
function createLiteralNode(type: LiteralType, value: LiteralValue): Node {
  switch (type) {
    case 'number':
      return t.numericLiteral(value as number);
    case 'boolean':
      return t.booleanLiteral(value as boolean);
    case 'null':
      return t.nullLiteral();
    case 'undefined':
      return t.identifier('undefined');
    case 'bigint':
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- bigIntLiteral is required for bigint support
      return t.bigIntLiteral(String(value));
    case 'string':
      return t.stringLiteral(value as string);
  }
}

// Collection types for string usage without AST modification
interface StringUsageCollected {
  literalNodes: NodePath<StringLiteral>[];
  // Dot notation: obj.prop - store the MemberExpression path and property name
  dotAccessNodes: { path: NodePath<MemberExpression>; name: string }[];
  // Bracket notation with string: obj["prop"] - store the StringLiteral path
  bracketAccessNodes: NodePath<StringLiteral>[];
  // Object property with identifier key: { prop: v }
  identifierKeyNodes: { path: NodePath<ObjectProperty>; name: string }[];
  // Object property with string key: { "prop": v }
  stringKeyNodes: NodePath<StringLiteral>[];
  // Class method with identifier key
  classMethodNodes: { path: NodePath<ClassMethod>; name: string }[];
  // Class property with identifier key
  classPropertyNodes: { path: NodePath<ClassProperty>; name: string }[];
}

/**
 * Hoists duplicate literals to variables for byte savings.
 */
export function hoistDuplicateLiterals(ast: File, _options?: MinifyOptions): HoistResult {
  const stringUsage = new Map<string, StringUsageCollected>();
  const otherLiterals = new Map<string, LiteralInfo>();

  // Helper to get or create string usage entry
  function getStringUsage(value: string): StringUsageCollected {
    let usage = stringUsage.get(value);
    if (usage === undefined) {
      usage = {
        literalNodes: [],
        dotAccessNodes: [],
        bracketAccessNodes: [],
        identifierKeyNodes: [],
        stringKeyNodes: [],
        classMethodNodes: [],
        classPropertyNodes: [],
      };
      stringUsage.set(value, usage);
    }
    return usage;
  }

  // Single traversal: collect everything without modifying AST
  traverse(ast, {
    MemberExpression(path: NodePath<MemberExpression>): void {
      if (!path.node.computed && t.isIdentifier(path.node.property)) {
        // Dot notation: obj.prop
        const propName = path.node.property.name;
        if (isValidIdentifier(propName)) {
          getStringUsage(propName).dotAccessNodes.push({ path, name: propName });
        }
      } else if (path.node.computed && t.isStringLiteral(path.node.property)) {
        // Bracket notation with string: obj["prop"]
        const value = path.node.property.value;
        getStringUsage(value).bracketAccessNodes.push(
          path.get('property') as NodePath<StringLiteral>
        );
      }
    },

    ObjectProperty(path: NodePath<ObjectProperty>): void {
      const nodeWithMethod = path.node as ObjectProperty & { method?: boolean };
      if (path.node.shorthand || nodeWithMethod.method === true) {
        return;
      }
      if (t.isObjectPattern(path.parent)) {
        return;
      }

      if (!path.node.computed && t.isIdentifier(path.node.key)) {
        // Identifier key: { prop: v }
        const propName = path.node.key.name;
        if (isValidIdentifier(propName)) {
          getStringUsage(propName).identifierKeyNodes.push({ path, name: propName });
        }
      } else if (path.node.computed && t.isStringLiteral(path.node.key)) {
        // String key: { ["prop"]: v }
        const value = path.node.key.value;
        getStringUsage(value).stringKeyNodes.push(path.get('key') as NodePath<StringLiteral>);
      }
    },

    ClassMethod(path: NodePath<ClassMethod>): void {
      if (
        path.node.computed ||
        t.isPrivateName(path.node.key) ||
        path.node.kind === 'constructor'
      ) {
        return;
      }
      if (t.isIdentifier(path.node.key)) {
        const propName = path.node.key.name;
        if (isValidIdentifier(propName)) {
          getStringUsage(propName).classMethodNodes.push({ path, name: propName });
        }
      }
    },

    ClassProperty(path: NodePath<ClassProperty>): void {
      if (path.node.computed || t.isPrivateName(path.node.key)) {
        return;
      }
      if (t.isIdentifier(path.node.key)) {
        const propName = path.node.key.name;
        if (isValidIdentifier(propName)) {
          getStringUsage(propName).classPropertyNodes.push({ path, name: propName });
        }
      }
    },

    StringLiteral(path: NodePath<StringLiteral>): void {
      const parent = path.parent;
      // Skip import/export paths
      if (
        t.isImportDeclaration(parent) ||
        t.isExportDeclaration(parent) ||
        t.isImportSpecifier(parent) ||
        t.isExportSpecifier(parent)
      ) {
        return;
      }

      // Skip if already handled as property access or object key
      if (t.isMemberExpression(parent) && parent.property === path.node) {
        return; // Handled in MemberExpression visitor
      }
      if (t.isObjectProperty(parent) && parent.key === path.node) {
        return; // Handled in ObjectProperty visitor
      }

      const value = path.node.value;
      getStringUsage(value).literalNodes.push(path);
    },

    NumericLiteral(path: NodePath<NumericLiteral>): void {
      const parent = path.parent;
      // Skip non-computed object property keys
      if (t.isObjectProperty(parent) && parent.key === path.node && !parent.computed) {
        return;
      }

      const value = path.node.value;
      const key = `number:${String(value)}`;
      const existing = otherLiterals.get(key);
      if (existing === undefined) {
        otherLiterals.set(key, { type: 'number', value, nodes: [path] });
      } else {
        existing.nodes.push(path);
      }
    },

    BooleanLiteral(path: NodePath<BooleanLiteral>): void {
      const parent = path.parent;
      // Skip non-computed object property keys
      if (t.isObjectProperty(parent) && parent.key === path.node && !parent.computed) {
        return;
      }

      const value = path.node.value;
      const key = `boolean:${String(value)}`;
      const existing = otherLiterals.get(key);
      if (existing === undefined) {
        otherLiterals.set(key, { type: 'boolean', value, nodes: [path] });
      } else {
        existing.nodes.push(path);
      }
    },

    NullLiteral(path: NodePath<NullLiteral>): void {
      const parent = path.parent;
      // Skip non-computed object property keys
      if (t.isObjectProperty(parent) && parent.key === path.node && !parent.computed) {
        return;
      }

      const key = 'null:null';
      const existing = otherLiterals.get(key);
      if (existing === undefined) {
        otherLiterals.set(key, { type: 'null', value: null, nodes: [path] });
      } else {
        existing.nodes.push(path);
      }
    },

    BigIntLiteral(path: NodePath<BigIntLiteral>): void {
      const parent = path.parent;
      // Skip non-computed object property keys
      if (t.isObjectProperty(parent) && parent.key === path.node && !parent.computed) {
        return;
      }

      const value = path.node.value;
      const key = `bigint:${value}`;
      const existing = otherLiterals.get(key);
      if (existing === undefined) {
        otherLiterals.set(key, { type: 'bigint', value, nodes: [path] });
      } else {
        existing.nodes.push(path);
      }
    },

    Identifier(path: NodePath<Identifier>): void {
      if (path.node.name !== 'undefined') {
        return;
      }

      const parent = path.parent;
      if (
        (t.isVariableDeclarator(parent) && parent.id === path.node) ||
        (t.isAssignmentExpression(parent) && parent.left === path.node) ||
        t.isFunctionDeclaration(parent) ||
        t.isFunctionExpression(parent) ||
        t.isArrowFunctionExpression(parent) ||
        (t.isObjectProperty(parent) && parent.key === path.node && !parent.computed) ||
        t.isObjectMethod(parent) ||
        t.isClassMethod(parent)
      ) {
        return;
      }

      const key = 'undefined:undefined';
      const existing = otherLiterals.get(key);
      if (existing === undefined) {
        otherLiterals.set(key, { type: 'undefined', value: undefined, nodes: [path] });
      } else {
        existing.nodes.push(path);
      }
    },
  });

  // Calculate profitability for strings
  interface StringCandidate {
    value: string;
    usage: StringUsageCollected;
    selectiveResult: ReturnType<typeof calculateSelectiveStringProfit>;
    effectiveOccurrences: number;
  }

  const stringCandidates: StringCandidate[] = [];

  for (const [value, usage] of stringUsage) {
    const literalCount =
      usage.literalNodes.length + usage.bracketAccessNodes.length + usage.stringKeyNodes.length;
    const propertyAccessCount = usage.dotAccessNodes.length;
    const objectPropertyCount =
      usage.identifierKeyNodes.length +
      usage.classMethodNodes.length +
      usage.classPropertyNodes.length;
    const totalOccurrences = literalCount + propertyAccessCount + objectPropertyCount;

    if (totalOccurrences < 2) {
      continue;
    }

    const selectiveResult = calculateSelectiveStringProfit(
      { literalCount, propertyAccessCount, objectPropertyCount },
      value,
      1,
      false
    );

    if (selectiveResult.profit > -2) {
      const effectiveOccurrences =
        (selectiveResult.hoistLiterals ? literalCount : 0) +
        (selectiveResult.hoistPropertyAccess ? propertyAccessCount : 0) +
        (selectiveResult.hoistObjectProperties ? objectPropertyCount : 0);

      if (effectiveOccurrences >= 2) {
        stringCandidates.push({ value, usage, selectiveResult, effectiveOccurrences });
      }
    }
  }

  const FIRST_DECL_OVERHEAD = 5;
  const profitableUnderConst = stringCandidates.filter((c) => c.selectiveResult.profit > 0);
  const marginalForSplit = stringCandidates.filter(
    (c) => c.selectiveResult.profit <= 0 && c.selectiveResult.profit > -2
  );

  let selectedCandidates: StringCandidate[];
  if (profitableUnderConst.length >= 7) {
    selectedCandidates = profitableUnderConst;
  } else if (profitableUnderConst.length + marginalForSplit.length >= 7) {
    selectedCandidates = [...profitableUnderConst, ...marginalForSplit];
  } else {
    selectedCandidates = profitableUnderConst;
  }

  selectedCandidates.sort((a, b) => b.effectiveOccurrences - a.effectiveOccurrences);

  const stringDecisions: SelectiveStringHoistDecision[] = [];
  const skippedAsFirst: StringCandidate[] = [];

  for (const candidate of selectedCandidates) {
    const { value, usage, selectiveResult, effectiveOccurrences } = candidate;
    const isFirst = stringDecisions.length === 0;

    if (isFirst) {
      const firstProfit = selectiveResult.profit - FIRST_DECL_OVERHEAD;
      if (firstProfit <= 0) {
        if (selectiveResult.profit > 0) {
          skippedAsFirst.push(candidate);
        }
        continue;
      }
    }

    stringDecisions.push({
      type: 'string',
      value,
      usage: {
        literalNodes: [
          ...usage.literalNodes,
          ...usage.bracketAccessNodes,
          ...usage.stringKeyNodes,
        ] as NodePath<StringLiteral>[],
        propertyAccessNodes: usage.dotAccessNodes.map(
          (d) => d.path as unknown as NodePath<StringLiteral>
        ),
        objectPropertyNodes: [
          ...usage.identifierKeyNodes.map((d) => d.path),
          ...usage.classMethodNodes.map((d) => d.path),
          ...usage.classPropertyNodes.map((d) => d.path),
        ] as unknown as NodePath<StringLiteral>[],
      },
      occurrences: effectiveOccurrences,
      profit: selectiveResult.profit,
      hoistLiterals: selectiveResult.hoistLiterals,
      hoistPropertyAccess: selectiveResult.hoistPropertyAccess,
      hoistObjectProperties: selectiveResult.hoistObjectProperties,
    });
  }

  if (stringDecisions.length > 0) {
    for (const candidate of skippedAsFirst) {
      const { usage, selectiveResult, effectiveOccurrences } = candidate;
      stringDecisions.push({
        type: 'string',
        value: candidate.value,
        usage: {
          literalNodes: [
            ...usage.literalNodes,
            ...usage.bracketAccessNodes,
            ...usage.stringKeyNodes,
          ] as NodePath<StringLiteral>[],
          propertyAccessNodes: usage.dotAccessNodes.map(
            (d) => d.path as unknown as NodePath<StringLiteral>
          ),
          objectPropertyNodes: [
            ...usage.identifierKeyNodes.map((d) => d.path),
            ...usage.classMethodNodes.map((d) => d.path),
            ...usage.classPropertyNodes.map((d) => d.path),
          ] as unknown as NodePath<StringLiteral>[],
        },
        occurrences: effectiveOccurrences,
        profit: selectiveResult.profit,
        hoistLiterals: selectiveResult.hoistLiterals,
        hoistPropertyAccess: selectiveResult.hoistPropertyAccess,
        hoistObjectProperties: selectiveResult.hoistObjectProperties,
      });
    }
    stringDecisions.sort((a, b) => b.occurrences - a.occurrences);
  }

  const hoistDecisions: HoistDecision[] = [];

  for (const [_, info] of otherLiterals) {
    if (info.nodes.length < 2) {
      continue;
    }

    const reprLength = getLiteralRepresentationLength(info.value, info.type);
    if (info.type === 'number' && reprLength <= 2) {
      continue;
    }

    const profit = calculateLiteralProfit(
      info.nodes.length,
      reprLength,
      1,
      stringDecisions.length === 0 && hoistDecisions.length === 0
    );

    if (profit > 0) {
      hoistDecisions.push({
        type: info.type,
        value: info.value,
        nodes: info.nodes,
        occurrences: info.nodes.length,
        profit,
      });
    }
  }

  hoistDecisions.sort((a, b) => b.occurrences - a.occurrences);

  // Apply replacements
  const hoistedLiteralBindings: HoistedBinding[] = [];

  for (let i = 0; i < stringDecisions.length; i++) {
    const decision = stringDecisions[i];
    if (decision === undefined) {
      continue;
    }

    const placeholderName = `__niu_literal_${String(i)}__`;
    const value = decision.value;
    const usage = stringUsage.get(value);
    if (usage === undefined) {
      continue;
    }

    hoistedLiteralBindings.push({
      name: placeholderName,
      value: t.stringLiteral(value),
      occurrences: decision.occurrences,
    });

    const placeholderId = t.identifier(placeholderName);

    if (decision.hoistLiterals) {
      // Replace string literals
      for (const path of usage.literalNodes) {
        path.replaceWith(t.cloneNode(placeholderId));
      }
      // Replace bracket access string literals
      for (const path of usage.bracketAccessNodes) {
        path.replaceWith(t.cloneNode(placeholderId));
      }
      // Replace string keys in objects
      for (const path of usage.stringKeyNodes) {
        path.replaceWith(t.cloneNode(placeholderId));
      }
    }

    if (decision.hoistPropertyAccess) {
      // Convert dot notation to bracket with identifier
      for (const { path } of usage.dotAccessNodes) {
        path.node.computed = true;
        path.node.property = t.cloneNode(placeholderId);
      }
    }

    if (decision.hoistObjectProperties) {
      // Convert identifier keys to computed with identifier
      for (const { path } of usage.identifierKeyNodes) {
        path.node.computed = true;
        path.node.key = t.cloneNode(placeholderId);
      }
      // Convert class method keys
      for (const { path } of usage.classMethodNodes) {
        path.node.computed = true;
        path.node.key = t.cloneNode(placeholderId);
      }
      // Convert class property keys
      for (const { path } of usage.classPropertyNodes) {
        path.node.computed = true;
        path.node.key = t.cloneNode(placeholderId);
      }
    }
  }

  // Replace non-string literals
  const otherLiteralOffset = stringDecisions.length;
  for (let i = 0; i < hoistDecisions.length; i++) {
    const decision = hoistDecisions[i];
    if (decision === undefined) {
      continue;
    }

    const placeholderName = `__niu_literal_${String(otherLiteralOffset + i)}__`;

    hoistedLiteralBindings.push({
      name: placeholderName,
      value: createLiteralNode(decision.type, decision.value),
      occurrences: decision.occurrences,
    });

    const nodes = decision.nodes;
    if (nodes !== undefined) {
      for (const path of nodes) {
        path.replaceWith(t.identifier(placeholderName));
      }
    }
  }

  // Insert declarations at program start
  if (hoistedLiteralBindings.length > 0) {
    const stringBindings: HoistedBinding[] = [];
    const otherBindings: HoistedBinding[] = [];

    for (const binding of hoistedLiteralBindings) {
      if (t.isStringLiteral(binding.value)) {
        stringBindings.push(binding);
      } else {
        otherBindings.push(binding);
      }
    }

    const declarations: t.VariableDeclaration[] = [];

    const delimiter =
      stringBindings.length > 0
        ? findDelimiter(stringBindings.map((b) => (b.value as t.StringLiteral).value))
        : null;
    const useSplit = isSplitProfitable(stringBindings.length) && delimiter !== null;

    if (stringBindings.length > 0) {
      if (useSplit) {
        const identifiers = stringBindings.map((b) => t.identifier(b.name));
        const joinedString = stringBindings
          .map((b) => (b.value as t.StringLiteral).value)
          .join(delimiter);

        const splitDeclaration = t.variableDeclaration('let', [
          t.variableDeclarator(
            t.arrayPattern(identifiers),
            t.callExpression(
              t.memberExpression(t.stringLiteral(joinedString), t.identifier('split')),
              [t.stringLiteral(delimiter)]
            )
          ),
        ]);
        declarations.push(splitDeclaration);
      } else {
        const stringDeclarators = stringBindings.map((binding) =>
          t.variableDeclarator(t.identifier(binding.name), binding.value as t.Expression)
        );
        declarations.push(t.variableDeclaration('const', stringDeclarators));
      }
    }

    if (otherBindings.length > 0) {
      const otherDeclarators = otherBindings.map((binding) =>
        t.variableDeclarator(t.identifier(binding.name), binding.value as t.Expression)
      );
      declarations.push(t.variableDeclaration('const', otherDeclarators));
    }

    // Insert using fresh traverse for proper scope registration
    traverse(ast, {
      Program(path: NodePath<t.Program>): void {
        for (let i = declarations.length - 1; i >= 0; i--) {
          const decl = declarations[i];
          if (decl !== undefined) {
            path.unshiftContainer('body', decl);
          }
        }
        path.stop();
      },
    });
  }

  return {
    ast,
    hoistedLiteralBindings,
  };
}
