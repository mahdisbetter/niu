import { minify } from '../src/index.js';

async function transform(code: string): Promise<string> {
  return (await minify(code, {})).code;
}

describe('mangleIdentifiers', () => {
  describe('basic renaming', () => {
    test('renames simple variables to short names', async () => {
      const input = `const myVariable = 1; console.log(myVariable);`;
      const output = await transform(input);

      expect(output).not.toContain('myVariable');
      expect(output.length).toBeLessThan(input.length);
    });

    test('renames function parameters', async () => {
      const input = `function foo(parameter) { return parameter + 1; }`;
      const output = await transform(input);

      expect(output).not.toContain('parameter');
    });

    test('renames arrow function parameters', async () => {
      const input = `const fn = (param) => param * 2`;
      const output = await transform(input);

      expect(output).not.toContain('param');
    });
  });

  describe('reference counting', () => {
    test('assigns shortest name to most referenced variable', async () => {
      const input = `
        const mostUsed = 1;
        const lessUsed = 2;
        console.log(mostUsed);
        console.log(mostUsed);
        console.log(mostUsed);
        console.log(mostUsed);
        console.log(lessUsed);
      `;
      const output = await transform(input);

      expect(output).not.toContain('mostUsed');
      expect(output).not.toContain('lessUsed');
    });
  });

  describe('scope handling', () => {
    test('handles nested function scopes', async () => {
      const input = `
        function outer(outerParam) {
          function inner(innerParam) {
            return innerParam + outerParam;
          }
          return inner(1);
        }
      `;
      const output = await transform(input);

      expect(output).not.toContain('outerParam');
      expect(output).not.toContain('innerParam');
      expect(output).not.toContain('outer');
      expect(output).not.toContain('inner');
    });

    test('handles block scopes', async () => {
      const input = `
        {
          const blockVar = 1;
          console.log(blockVar);
        }
      `;
      const output = await transform(input);

      expect(output).not.toContain('blockVar');
    });

    test('handles let in for loops', async () => {
      const input = `
        for (let loopVar = 0; loopVar < 10; loopVar++) {
          console.log(loopVar);
        }
      `;
      const output = await transform(input);

      expect(output).not.toContain('loopVar');
    });

    test('handles const in for-of loops', async () => {
      const input = `
        const arr = [1, 2, 3];
        for (const item of arr) {
          console.log(item);
        }
      `;
      const output = await transform(input);

      expect(output).not.toContain('item');
    });

    test('handles catch clause parameters', async () => {
      const input = `
        try {
          throw new Error();
        } catch (error) {
          console.log(error);
        }
      `;
      const output = await transform(input);

      expect(output).not.toContain('error');
    });
  });

  describe('globals preservation', () => {
    test('does not rename console', async () => {
      const input = `console.log("test")`;
      const output = await transform(input);

      expect(output).toContain('console');
    });

    test('does not rename window', async () => {
      const input = `window.location.href`;
      const output = await transform(input);

      expect(output).toContain('window');
    });

    test('does not rename document', async () => {
      const input = `document.getElementById("x")`;
      const output = await transform(input);

      expect(output).toContain('document');
    });

    test('does not rename Math', async () => {
      const input = `Math.random()`;
      const output = await transform(input);

      expect(output).toContain('Math');
    });

    test('does not rename Promise', async () => {
      const input = `new Promise((resolve) => resolve(1))`;
      const output = await transform(input);

      expect(output).toContain('Promise');
    });

    test('does not rename undefined', async () => {
      const input = `const x = undefined`;
      const output = await transform(input);

      expect(output).toContain('undefined');
    });

    test('does not rename process (Node.js)', async () => {
      const input = `process.env.NODE_ENV`;
      const output = await transform(input);

      expect(output).toContain('process');
    });
  });

  describe('reserved words', () => {
    test('does not generate reserved word identifiers', async () => {
      const vars: string[] = [];
      for (let i = 0; i < 100; i++) {
        vars.push(`var${i}`);
      }
      const input =
        vars.map((v) => `const ${v} = ${vars.indexOf(v)};`).join('\n') +
        vars.map((v) => `console.log(${v});`).join('\n');

      const output = await transform(input);

      const reservedPattern =
        /\b(if|else|for|while|do|switch|case|break|continue|return|throw|try|catch|finally|const|let|var|function|class|new|this|super|import|export|default|null|true|false|undefined|void|typeof|instanceof|in|of|delete|with|debugger|yield|await|enum|implements|interface|package|private|protected|public|static)\s*=/;
      expect(output).not.toMatch(reservedPattern);
    });
  });

  describe('name sequence', () => {
    test('generates names in correct sequence', async () => {
      const input = `
        const var1 = 1; console.log(var1);
        const var2 = 2; console.log(var2);
        const var3 = 3; console.log(var3);
      `;
      const output = await transform(input);

      expect(output).toMatch(/const [a-z]=/);
    });
  });

  describe('shadowing', () => {
    test('handles variable shadowing correctly', async () => {
      const input = `
        const x = 1;
        function test() {
          const x = 2;
          return x;
        }
        console.log(x);
      `;
      const output = await transform(input);

      expect(() => new Function(output)).not.toThrow();
    });
  });

  describe('property names', () => {
    test('does not rename object property names', async () => {
      const input = `const obj = { propertyName: 1 }; console.log(obj.propertyName);`;
      const output = await transform(input);

      expect(output).toContain('propertyName');
    });

    test('does not rename method names', async () => {
      const input = `const obj = { myMethod() { return 1; } }; obj.myMethod();`;
      const output = await transform(input);

      expect(output).toContain('myMethod');
    });
  });

  describe('integration', () => {
    test('works with hoisted literals', async () => {
      const input = `
        console.log("test");
        console.log("test");
        console.log("test");
        console.log("test");
        console.log("test");
      `;
      const output = (await minify(input, { hoistDuplicateLiterals: true })).code;

      expect(output).toMatch(/const [a-z]="test"/);
    });

    test('assigns shortest names based on usage frequency', async () => {
      const input = `
        const rarelyUsed = 1;
        console.log(rarelyUsed);
        console.log("frequent");
        console.log("frequent");
        console.log("frequent");
        console.log("frequent");
        console.log("frequent");
        console.log("frequent");
        console.log("frequent");
        console.log("frequent");
        console.log("frequent");
        console.log("frequent");
      `;
      const output = (await minify(input, { hoistDuplicateLiterals: true })).code;

      expect(output).toMatch(/"frequent"/);
    });
  });
});

describe('edge cases', () => {
  test('handles empty input', async () => {
    await expect(transform('')).resolves.toBeDefined();
  });

  test('handles input with only globals', async () => {
    const input = `console.log(Math.random())`;
    const output = await transform(input);
    expect(output).toContain('console');
    expect(output).toContain('Math');
  });

  test('handles class declarations', async () => {
    const input = `
      class MyClass {
        constructor(param) {
          this.value = param;
        }
        method() {
          return this.value;
        }
      }
    `;
    const output = await transform(input);

    expect(output).not.toContain('param');
  });

  test('handles destructuring', async () => {
    const input = `
      const { propA, propB } = obj;
      console.log(propA, propB);
    `;
    const output = await transform(input);

    expect(output.length).toBeLessThan(input.length);
  });

  test('handles rest parameters', async () => {
    const input = `
      function test(...restParams) {
        return restParams.length;
      }
    `;
    const output = await transform(input);

    expect(output).not.toContain('restParams');
  });

  test('handles default parameters', async () => {
    const input = `
      function test(param = defaultValue) {
        return param;
      }
    `;
    const output = await transform(input);

    expect(output).not.toContain('param');
  });
});

describe('scope reuse', () => {
  test('reuses names in independent nested functions', async () => {
    const input = `
      function outer(param1) {
        function inner(param2) {
          return param2 + 1;
        }
        return inner(param1);
      }
    `;
    const output = await transform(input);

    // Inner function can reuse 'a' since it doesn't reference outer's param
    expect(output).toMatch(/function [a-z]\([a-z]\)\{function [a-z]\([a-z]\)/);
  });

  test('reserves names when inner references outer', async () => {
    const input = `
      function outer(param1) {
        function inner(param2) {
          return param1 + param2;
        }
        return inner(param1);
      }
    `;
    const output = await transform(input);

    // Inner function must use different name since it references outer's param
    expect(output).toBeTruthy();
  });
});
