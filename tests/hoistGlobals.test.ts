import { minify } from '../src/index.js';

async function transform(code: string): Promise<string> {
  return (await minify(code, { hoistGlobals: true })).code;
}

describe('hoistGlobals', () => {
  describe('basic global hoisting', () => {
    test('hoists Array when used multiple times', async () => {
      const input = `
        Array.isArray(x);
        Array.isArray(y);
        Array.isArray(z);
        Array.from(a);
        Array.from(b);
      `;
      const output = await transform(input);

      expect(output).toMatch(/[a-z]=Array/);
      expect(output).not.toMatch(/Array\.isArray/);
    });

    test('hoists Math when used multiple times', async () => {
      const input = `
        Math.random();
        Math.floor(x);
        Math.ceil(y);
        Math.abs(z);
        Math.min(a, b);
        Math.max(c, d);
      `;
      const output = await transform(input);

      expect(output).toMatch(/[a-z]=Math/);
    });

    test('hoists Object when used multiple times', async () => {
      const input = `
        Object.keys(a);
        Object.values(b);
        Object.entries(c);
        Object.assign(d, e);
      `;
      const output = await transform(input);

      expect(output).toMatch(/[a-z]=Object/);
    });

    test('does not hoist globals used only once', async () => {
      const input = `
        console.log("hello");
      `;
      const output = await transform(input);

      expect(output).toContain('console.log');
      expect(output).not.toMatch(/=[a-z]+console/);
    });

    test('does not hoist short globals when unprofitable', async () => {
      const input = `
        a.x;
        a.y;
      `;
      const output = await transform(input);

      expect(output).not.toMatch(/=[a-z]+a;/);
    });
  });

  describe('shadowing detection', () => {
    test('hoists global even when shadowed in nested scope', async () => {
      const input = `
        function foo() {
          const Array = [1, 2, 3];
          return Array;
        }
        Array.isArray(x);
        Array.isArray(y);
        Array.isArray(z);
        Array.from(a);
      `;
      const output = await transform(input);

      expect(output).toMatch(/[a-z]=Array/);
    });

    test('does not hoist if global is shadowed by function declaration', async () => {
      const input = `
        function Math() { return 42; }
        Math.random();
        Math.random();
        Math.random();
      `;
      const output = await transform(input);

      // The Math here is a local function, not the global
      expect(output).not.toMatch(/[a-z]=Math;/);
    });

    test('correctly handles partial shadowing by parameter', async () => {
      const input = `
        function foo(console) {
          console.log("hi");
        }
        console.log("a");
        console.log("b");
        console.log("c");
        console.log("d");
        console.log("e");
      `;
      const output = await transform(input);

      // Global console should be hoisted for outer usages
      expect(output).toMatch(/[a-z]=console/);
    });
  });

  describe('identifier exclusions', () => {
    test('does not treat object property keys as globals', async () => {
      const input = `
        const obj = {
          Array: 1,
          Math: 2,
          Object: 3
        };
        Array.isArray(x);
        Array.isArray(y);
        Array.from(z);
        Array.of(w);
      `;
      const output = await transform(input);

      expect(output).toMatch(/[a-z]=Array/);
      expect(output).toContain('Array:1');
    });

    test('does not treat member expression property as global', async () => {
      const input = `
        obj.Array;
        obj.Array;
        obj.Array;
        Array.isArray(x);
        Array.isArray(y);
      `;
      const output = await transform(input);

      expect(output).toContain('obj.Array');
    });
  });

  describe('profit calculation', () => {
    test('hoists long global name with fewer occurrences', async () => {
      const input = `
        URLSearchParams.toString();
        URLSearchParams.get();
        URLSearchParams.set();
      `;
      const output = await transform(input);

      expect(output).toMatch(/[a-z]=URLSearchParams/);
    });

    test('hoists Reflect when profitable', async () => {
      const input = `
        Reflect.get(a, b);
        Reflect.set(a, b, c);
        Reflect.has(a, b);
      `;
      const output = await transform(input);

      expect(output).toMatch(/[a-z]=Reflect/);
    });
  });

  describe('integration with mangling', () => {
    test('hoisted globals get short names after mangling', async () => {
      const input = `
        Array.isArray(x);
        Array.isArray(y);
        Array.isArray(z);
        Array.from(a);
        Array.from(b);
      `;
      const output = await transform(input);

      expect(output.length).toBeLessThan(input.length);
      expect(output).toMatch(/[a-z]=Array/);
    });

    test('reduces code size with multiple globals', async () => {
      const input = `
        console.log(Array.isArray(x));
        console.log(Array.from(y));
        console.log(Object.keys(z));
        console.log(Object.values(w));
        Array.isArray(a);
        Object.entries(b);
      `;
      const output = await transform(input);

      expect(output.length).toBeLessThan(input.replace(/\s+/g, '').length);
    });
  });

  describe('edge cases', () => {
    test('handles empty input', async () => {
      const output = await transform('');
      expect(output).toBe('');
    });

    test('handles input with no globals', async () => {
      const input = `
        function foo(x) {
          const y = x + 1;
          return y;
        }
      `;
      const output = await transform(input);

      expect(output).not.toMatch(/__niu_global_/);
    });

    test('handles globals in arrow functions', async () => {
      const input = `
        const fn = () => Array.isArray(x);
        const fn2 = () => Array.from(y);
        const fn3 = () => Array.of(z);
        const fn4 = () => Array.isArray(w);
      `;
      const output = await transform(input);

      expect(output).toMatch(/[a-z]=Array/);
    });

    test('handles globals in class methods', async () => {
      const input = `
        class Foo {
          bar() {
            return Array.isArray(this.x);
          }
          baz() {
            return Array.from(this.y);
          }
          qux() {
            return Array.of(this.z);
          }
          quux() {
            return Array.isArray(this.w);
          }
        }
      `;
      const output = await transform(input);

      expect(output).toMatch(/[a-z]=Array/);
    });

    test('preserves behavior with typeof', async () => {
      const input = `
        typeof undefined;
        undefined;
        undefined;
        undefined;
      `;
      const output = await transform(input);

      expect(output).toContain('typeof');
    });
  });

  describe('disabled hoisting', () => {
    test('can disable global hoisting via options', async () => {
      const input = `
        Array.isArray(x);
        Array.isArray(y);
        Array.isArray(z);
        Array.from(a);
      `;
      const output = (await minify(input, { hoistGlobals: false })).code;

      expect(output).not.toMatch(/[a-z]=Array/);
      expect(output).toContain('Array');
    });
  });

  describe('typeof safety', () => {
    test('does not hoist globals used in typeof expressions', async () => {
      const input = `
        typeof __THREE_DEVTOOLS__ !== 'undefined' && __THREE_DEVTOOLS__.register(this);
        typeof __THREE_DEVTOOLS__ !== 'undefined' && __THREE_DEVTOOLS__.register(that);
        typeof __THREE_DEVTOOLS__ !== 'undefined' && __THREE_DEVTOOLS__.send(data);
      `;
      const output = await transform(input);

      expect(output).not.toMatch(/=__THREE_DEVTOOLS__/);
      expect(output).toContain('typeof __THREE_DEVTOOLS__');
    });

    test('does not hoist React DevTools check pattern', async () => {
      const input = `
        typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ !== 'undefined' && __REACT_DEVTOOLS_GLOBAL_HOOK__.inject(this);
        typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ !== 'undefined' && __REACT_DEVTOOLS_GLOBAL_HOOK__.emit('render');
      `;
      const output = await transform(input);

      expect(output).not.toMatch(/=__REACT_DEVTOOLS_GLOBAL_HOOK__/);
    });

    test('still hoists globals not used in typeof', async () => {
      const input = `
        typeof someCheck !== 'undefined';
        Array.isArray(x);
        Array.from(y);
        Array.of(z);
        Array.isArray(w);
      `;
      const output = await transform(input);

      expect(output).toMatch(/=Array/);
    });

    test('handles mixed typeof and non-typeof usage of same global', async () => {
      const input = `
        typeof MyGlobal !== 'undefined';
        MyGlobal.method1();
        MyGlobal.method2();
        MyGlobal.method3();
        MyGlobal.method4();
      `;
      const output = await transform(input);

      expect(output).not.toMatch(/=MyGlobal/);
      expect(output).toContain('MyGlobal.method1');
    });
  });
});
