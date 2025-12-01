import type { LiteralType, LiteralValue, UsageCounts } from '../types.js';

/**
 * Returns the byte length of a literal when serialized to code.
 *
 * Strings include quotes, bigints include the 'n' suffix.
 */
export function getLiteralRepresentationLength(value: LiteralValue, type: LiteralType): number {
  switch (type) {
    case 'string':
      return JSON.stringify(value).length;
    case 'number':
      return String(value).length;
    case 'boolean':
      return value === true ? 4 : 5;
    case 'null':
      return 4;
    case 'undefined':
      return 9;
    case 'bigint':
      return String(value).length + 1;
  }
}

/**
 * Calculates the byte cost of declaring a hoisted variable.
 *
 * First declaration: `const a="value"` = 6 + id + 1 + value
 *
 * Subsequent: `,a="value"` = 1 + id + 1 + value
 */
export function getDeclarationCost(
  valueReprLength: number,
  identifierLength: number,
  isFirst: boolean
): number {
  // First: "const " (6) + identifier + "=" (1) + value
  // Rest: "," (1) + identifier + "=" (1) + value
  if (isFirst) {
    return 6 + identifierLength + 1 + valueReprLength;
  }
  return 1 + identifierLength + 1 + valueReprLength;
}

/**
 * Calculates byte savings from hoisting a literal value.
 *
 * Compares: N occurrences of the literal inline
 *
 * Against: 1 declaration + N short identifier references
 *
 * Example: "hello" used 5 times with 1-char identifier
 *
 *   Original: 5 * 7 = 35 bytes
 *
 *   New: (6+1+1+7) + (5*1) = 20 bytes
 *
 *   Profit: 15 bytes
 */
export function calculateLiteralProfit(
  occurrences: number,
  literalReprLength: number,
  identifierLength: number,
  isFirst: boolean
): number {
  const originalCost = occurrences * literalReprLength;
  const declarationCost = getDeclarationCost(literalReprLength, identifierLength, isFirst);
  const referenceCost = occurrences * identifierLength;
  const newCost = declarationCost + referenceCost;

  return originalCost - newCost;
}

/**
 * Calculates byte savings from converting property access to bracket notation.
 *
 * Original: `.propertyName` = 1 + name.length
 *
 * New: `[a]` = 1 + identifierLength + 1
 *
 * Example: .something (10 chars) used 5 times with 1-char identifier
 *
 *   Original: 5 * 10 = 50 bytes
 *
 *   New: declaration + 5 * 3 = 15 + 15 = 30 bytes
 *
 *   Profit: 20 bytes
 */
export function calculatePropertyAccessProfit(
  occurrences: number,
  propertyName: string,
  identifierLength: number,
  isFirst: boolean
): number {
  const dotAccessLength = 1 + propertyName.length;
  const bracketAccessLength = 1 + identifierLength + 1;
  const originalCost = occurrences * dotAccessLength;
  const stringReprLength = JSON.stringify(propertyName).length;
  const declarationCost = getDeclarationCost(stringReprLength, identifierLength, isFirst);
  const newAccessCost = occurrences * bracketAccessLength;
  const newCost = declarationCost + newAccessCost;

  return originalCost - newCost;
}

/**
 * Calculates byte savings from converting object property keys to computed.
 *
 * Original: `{name: v}` - just the key length
 *
 * New: `{[a]: v}` = 1 + identifierLength + 1
 *
 * Example: { something: 1 } key used 5 times with 1-char identifier
 *
 *   Original: 5 * 9 = 45 bytes
 *
 *   New: declaration + 5 * 3 = ~28 bytes
 *
 *   Profit: ~17 bytes
 */
export function calculateObjectPropertyProfit(
  occurrences: number,
  propertyName: string,
  identifierLength: number,
  isFirst: boolean
): number {
  const originalPropertyLength = propertyName.length;
  const newPropertyLength = 1 + identifierLength + 1;
  const originalCost = occurrences * originalPropertyLength;
  const stringReprLength = JSON.stringify(propertyName).length;
  const declarationCost = getDeclarationCost(stringReprLength, identifierLength, isFirst);
  const newAccessCost = occurrences * newPropertyLength;
  const newCost = declarationCost + newAccessCost;

  return originalCost - newCost;
}

/** Returns true if the profit is positive. */
export function isProfitable(profit: number): boolean {
  return profit > 0;
}

/**
 * Calculates total byte savings for a string used as literals, property access, and object keys.
 * Returns -Infinity if fewer than 2 total occurrences.
 */
export function calculateCombinedStringProfit(
  usage: UsageCounts,
  value: string,
  identifierLength: number,
  isFirst: boolean
): number {
  const { literalCount, propertyAccessCount, objectPropertyCount } = usage;
  const totalOccurrences = literalCount + propertyAccessCount + objectPropertyCount;

  if (totalOccurrences < 2) {
    return -Infinity;
  }

  const stringReprLength = JSON.stringify(value).length;

  // Original cost: each usage type has different byte cost
  let originalCost = 0;
  originalCost += literalCount * stringReprLength;
  originalCost += propertyAccessCount * (1 + value.length); // .name
  originalCost += objectPropertyCount * value.length; // name:

  const declarationCost = getDeclarationCost(stringReprLength, identifierLength, isFirst);

  // New cost: declaration + references with bracket notation where needed
  const newCost =
    declarationCost +
    literalCount * identifierLength +
    propertyAccessCount * (2 + identifierLength) + // [a]
    objectPropertyCount * (2 + identifierLength); // [a]:

  return originalCost - newCost;
}

/**
 * Calculates byte savings from hoisting a global identifier.
 *
 * Example: Array used 5 times with 1-char identifier
 *
 *   Original: 5 * 5 = 25 bytes
 *
 *   New: (6+1+1+5) + (5*1) = 18 bytes
 *
 *   Profit: 7 bytes
 */
export function calculateGlobalProfit(
  occurrences: number,
  globalNameLength: number,
  identifierLength: number,
  isFirst: boolean
): number {
  if (occurrences < 2) {
    return -Infinity;
  }

  const originalCost = occurrences * globalNameLength;
  const declarationCost = getDeclarationCost(globalNameLength, identifierLength, isFirst);
  const referenceCost = occurrences * identifierLength;
  const newCost = declarationCost + referenceCost;

  return originalCost - newCost;
}

/**
 * Checks if property access hoisting is profitable per-occurrence.
 *
 * Original: `.name` (1 + name.length) vs New: `[a]` (2 + identifierLength)
 *
 * Profitable when name.length > 1 + identifierLength
 */
export function isPropertyAccessProfitable(
  propertyName: string,
  identifierLength: number
): boolean {
  return propertyName.length > 1 + identifierLength;
}

/**
 * Checks if object property key hoisting is profitable per-occurrence.
 *
 * Original: `name` vs New: `[a]` (2 + identifierLength)
 *
 * Profitable when name.length > 2 + identifierLength
 */
export function isObjectPropertyProfitable(
  propertyName: string,
  identifierLength: number
): boolean {
  return propertyName.length > 2 + identifierLength;
}

/**
 * Calculates profit for a string, selectively including only profitable usage categories.
 *
 * Short strings may be profitable as literals but not as property access/keys.
 *
 * This function evaluates each category independently and returns which to hoist.
 *
 * Example: "A" used 5x as literal, 2x as .A property
 *
 *   Literals: profitable (5 * 3 vs declaration + 5 * 1)
 *
 *   Property access: not profitable (.A is 2 chars, [a] is 3 chars)
 */
export function calculateSelectiveStringProfit(
  usage: UsageCounts,
  value: string,
  identifierLength: number,
  isFirst: boolean
): {
  profit: number;
  hoistLiterals: boolean;
  hoistPropertyAccess: boolean;
  hoistObjectProperties: boolean;
} {
  const { literalCount, propertyAccessCount, objectPropertyCount } = usage;
  const stringReprLength = JSON.stringify(value).length;

  // Check per-occurrence profitability for each category
  const propertyAccessProfitablePerOccurrence = isPropertyAccessProfitable(value, identifierLength);
  const objectPropertyProfitablePerOccurrence = isObjectPropertyProfitable(value, identifierLength);

  // Only count occurrences from profitable categories
  const effectiveLiteralCount = literalCount;
  const effectivePropertyAccessCount = propertyAccessProfitablePerOccurrence
    ? propertyAccessCount
    : 0;
  const effectiveObjectPropertyCount = objectPropertyProfitablePerOccurrence
    ? objectPropertyCount
    : 0;
  const effectiveTotal =
    effectiveLiteralCount + effectivePropertyAccessCount + effectiveObjectPropertyCount;

  if (effectiveTotal < 2) {
    return {
      profit: -Infinity,
      hoistLiterals: false,
      hoistPropertyAccess: false,
      hoistObjectProperties: false,
    };
  }

  // Calculate original cost for included categories only
  let originalCost = 0;
  originalCost += effectiveLiteralCount * stringReprLength;
  if (propertyAccessProfitablePerOccurrence) {
    originalCost += propertyAccessCount * (1 + value.length);
  }
  if (objectPropertyProfitablePerOccurrence) {
    originalCost += objectPropertyCount * value.length;
  }

  const declarationCost = getDeclarationCost(stringReprLength, identifierLength, isFirst);

  // Calculate new cost for included categories
  let newCost = declarationCost;
  newCost += effectiveLiteralCount * identifierLength;
  if (propertyAccessProfitablePerOccurrence) {
    newCost += propertyAccessCount * (2 + identifierLength);
  }
  if (objectPropertyProfitablePerOccurrence) {
    newCost += objectPropertyCount * (2 + identifierLength);
  }

  const profit = originalCost - newCost;

  return {
    profit,
    hoistLiterals: effectiveLiteralCount > 0,
    hoistPropertyAccess: propertyAccessProfitablePerOccurrence && propertyAccessCount > 0,
    hoistObjectProperties: objectPropertyProfitablePerOccurrence && objectPropertyCount > 0,
  };
}
