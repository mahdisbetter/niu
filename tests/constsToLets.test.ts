import { minify } from '../src/index.js';

async function transform(code: string): Promise<string> {
  return (await minify(code, { constsToLets: true })).code;
}

describe('constsToLets', () => {
  describe('basic conversion', () => {
    test('converts simple const to let', async () => {
      const input = `const x = 1;`;
      const output = await transform(input);

      expect(output).toContain('let');
      expect(output).not.toMatch(/\bconst\b/);
    });

    test('converts multiple const declarations', async () => {
      const input = `const a = 1; const b = 2; const c = 3;`;
      const output = await transform(input);

      expect(output).not.toMatch(/\bconst\b/);
      expect((output.match(/\blet\b/g) || []).length).toBe(3);
    });

    test('converts const with multiple declarators', async () => {
      const input = `const a = 1, b = 2, c = 3;`;
      const output = await transform(input);

      expect(output).toContain('let');
      expect(output).not.toMatch(/\bconst\b/);
      expect((output.match(/\blet\b/g) || []).length).toBe(1);
    });

    test('preserves let declarations', async () => {
      const input = `let x = 1;`;
      const output = await transform(input);

      expect(output).toContain('let');
    });

    test('preserves var declarations', async () => {
      const input = `var x = 1;`;
      const output = await transform(input);

      expect(output).toContain('var');
    });
  });

  describe('for loop declarations', () => {
    test('converts const in for loop initializer', async () => {
      const input = `for (const i = 0; i < 10; i++) {}`;
      const output = await transform(input);

      expect(output).toContain('let');
      expect(output).not.toMatch(/\bconst\b/);
    });

    test('converts const in for-of loop', async () => {
      const input = `for (const item of items) { console.log(item); }`;
      const output = await transform(input);

      expect(output).toContain('let');
      expect(output).not.toMatch(/\bconst\b/);
    });

    test('converts const in for-in loop', async () => {
      const input = `for (const key in obj) { console.log(key); }`;
      const output = await transform(input);

      expect(output).toContain('let');
      expect(output).not.toMatch(/\bconst\b/);
    });
  });

  describe('nested scopes', () => {
    test('converts const in function body', async () => {
      const input = `
        function test() {
          const inner = 1;
          return inner;
        }
      `;
      const output = await transform(input);

      expect(output).not.toMatch(/\bconst\b/);
    });

    test('converts const in arrow function', async () => {
      const input = `const fn = () => { const x = 1; return x; };`;
      const output = await transform(input);

      expect(output).not.toMatch(/\bconst\b/);
    });

    test('converts const in nested blocks', async () => {
      const input = `
        {
          const a = 1;
          {
            const b = 2;
            {
              const c = 3;
            }
          }
        }
      `;
      const output = await transform(input);

      expect(output).not.toMatch(/\bconst\b/);
      expect((output.match(/\blet\b/g) || []).length).toBe(3);
    });

    test('converts const in if blocks', async () => {
      const input = `
        if (true) {
          const x = 1;
        } else {
          const y = 2;
        }
      `;
      const output = await transform(input);

      expect(output).not.toMatch(/\bconst\b/);
    });

    test('converts const in try-catch-finally', async () => {
      const input = `
        try {
          const a = 1;
        } catch (e) {
          const b = 2;
        } finally {
          const c = 3;
        }
      `;
      const output = await transform(input);

      expect(output).not.toMatch(/\bconst\b/);
    });

    test('converts const in switch cases', async () => {
      const input = `
        switch (x) {
          case 1: {
            const a = 1;
            break;
          }
          case 2: {
            const b = 2;
            break;
          }
        }
      `;
      const output = await transform(input);

      expect(output).not.toMatch(/\bconst\b/);
    });

    test('converts const in while loop body', async () => {
      const input = `
        while (true) {
          const x = 1;
          break;
        }
      `;
      const output = await transform(input);

      expect(output).not.toMatch(/\bconst\b/);
    });

    test('converts const in do-while loop body', async () => {
      const input = `
        do {
          const x = 1;
        } while (false);
      `;
      const output = await transform(input);

      expect(output).not.toMatch(/\bconst\b/);
    });
  });

  describe('destructuring', () => {
    test('converts const with object destructuring', async () => {
      const input = `const { a, b } = obj;`;
      const output = await transform(input);

      expect(output).toContain('let');
      expect(output).not.toMatch(/\bconst\b/);
    });

    test('converts const with array destructuring', async () => {
      const input = `const [a, b, c] = arr;`;
      const output = await transform(input);

      expect(output).toContain('let');
      expect(output).not.toMatch(/\bconst\b/);
    });

    test('converts const with nested destructuring', async () => {
      const input = `const { a: { b } } = obj;`;
      const output = await transform(input);

      expect(output).toContain('let');
      expect(output).not.toMatch(/\bconst\b/);
    });

    test('converts const with default values in destructuring', async () => {
      const input = `const { a = 1, b = 2 } = obj;`;
      const output = await transform(input);

      expect(output).toContain('let');
      expect(output).not.toMatch(/\bconst\b/);
    });

    test('converts const with rest in destructuring', async () => {
      const input = `const { a, ...rest } = obj;`;
      const output = await transform(input);

      expect(output).toContain('let');
      expect(output).not.toMatch(/\bconst\b/);
    });
  });

  describe('integration with other transforms', () => {
    test('converts hoisted consts to lets', async () => {
      const input = `
        console.log("test");
        console.log("test");
        console.log("test");
        console.log("test");
        console.log("test");
      `;
      const output = (await minify(input, { hoistDuplicateLiterals: true, constsToLets: true })).code;

      expect(output).toMatch(/let [a-z]="test"/);
      expect(output).not.toMatch(/\bconst\b/);
    });

    test('converts all consts including those from mangling', async () => {
      const input = `
        const myVar = 1;
        const anotherVar = 2;
        console.log(myVar + anotherVar);
      `;
      const output = (await minify(input, { hoistDuplicateLiterals: false, constsToLets: true })).code;

      expect(output).not.toMatch(/\bconst\b/);
      expect(output).toMatch(/\blet\b/);
    });
  });

  describe('edge cases', () => {
    test('handles empty input', async () => {
      await expect(transform('')).resolves.toBeDefined();
    });

    test('handles input with no const', async () => {
      const input = `let x = 1; var y = 2;`;
      const output = await transform(input);

      expect(output).not.toMatch(/\bconst\b/);
    });

    test('handles class with const inside methods', async () => {
      const input = `
        class MyClass {
          method() {
            const x = 1;
            return x;
          }
        }
      `;
      const output = await transform(input);

      expect(output).not.toMatch(/\bconst\b/);
    });

    test('does not affect class declarations', async () => {
      const input = `class MyClass {}`;
      const output = await transform(input);

      expect(output).toContain('class');
    });

    test('handles const in IIFE', async () => {
      const input = `(function() { const x = 1; return x; })();`;
      const output = await transform(input);

      expect(output).not.toMatch(/\bconst\b/);
    });
  });
});

describe('byte savings verification', () => {
  test('saves bytes per const->let conversion', async () => {
    const input = `const a = 1;`;
    const output = await transform(input);

    // After mangling variable names get shorter too
    expect(output.length).toBeLessThanOrEqual(input.replace(/\s/g, '').length);
  });

  test('total savings scales with number of consts', async () => {
    const manyConsts = Array(10)
      .fill(0)
      .map((_, i) => `const v${i} = ${i};`)
      .join('');
    const output = await transform(manyConsts);

    const originalLength = manyConsts.replace(/\s/g, '').length;
    const outputLength = output.length;

    expect(outputLength).toBeLessThan(originalLength);
  });
});
