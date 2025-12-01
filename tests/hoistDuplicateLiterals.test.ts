import { minify } from '../src/index.js';

async function transform(code: string): Promise<string> {
  return (await minify(code, { hoistDuplicateLiterals: true })).code;
}

describe('hoistDuplicateLiterals', () => {
  describe('basic string hoisting', () => {
    test('hoists duplicate strings when profitable', async () => {
      const input = `
        console.log("hello");
        console.log("hello");
        console.log("hello");
        console.log("hello");
        console.log("hello");
      `;
      const output = await transform(input);

      expect(output).toMatch(/const [a-zA-Z]="hello"/);
      expect((output.match(/"hello"/g) || []).length).toBe(1);
    });

    test('does not hoist single occurrence', async () => {
      const input = `console.log("hello")`;
      const output = await transform(input);

      expect(output).toContain('"hello"');
    });

    test('does not hoist when unprofitable (short string, few occurrences)', async () => {
      const input = `
        console.log("a");
        console.log("a");
      `;
      const output = await transform(input);

      const matches = output.match(/"a"/g);
      expect(matches).toBeTruthy();
      expect(matches!.length).toBe(2);
    });
  });

  describe('property access conversion', () => {
    test('converts dot notation to bracket and hoists when profitable', async () => {
      const input = `
        obj.something;
        obj.something;
        obj.something;
        obj.something;
        obj.something;
        obj.something;
        obj.something;
        obj.something;
        obj.something;
        obj.something;
      `;
      const output = await transform(input);

      expect(output).toMatch(/const [a-zA-Z]="something"/);
      expect(output).toMatch(/[a-zA-Z]\[[a-zA-Z]\]/);
    });

    test('reverses bracket notation when not hoisted', async () => {
      const input = `
        obj.prop;
        obj.prop;
      `;
      const output = await transform(input);

      expect(output).toContain('obj.prop');
      expect(output).not.toContain('obj["prop"]');
    });

    test('handles reserved words in property names', async () => {
      const input = `
        obj.if;
        obj.if;
        obj.if;
        obj.if;
        obj.if;
        obj.if;
        obj.if;
        obj.if;
        obj.if;
        obj.if;
      `;
      const output = await transform(input);

      expect(output).toBeTruthy();
    });
  });

  describe('object property conversion', () => {
    test('converts object properties to computed and hoists when profitable', async () => {
      const input = `
        const a = { something: 1 };
        const b = { something: 2 };
        const c = { something: 3 };
        const d = { something: 4 };
        const e = { something: 5 };
        const f = { something: 6 };
        const g = { something: 7 };
        const h = { something: 8 };
        const i = { something: 9 };
        const j = { something: 10 };
      `;
      const output = await transform(input);

      expect(output).toMatch(/"something"/);
    });

    test('reverses computed property when not hoisted', async () => {
      const input = `
        const a = { x: 1 };
        const b = { x: 2 };
      `;
      const output = await transform(input);

      expect(output).not.toMatch(/\["x"\]/);
    });
  });

  describe('number literals', () => {
    test('hoists duplicate numbers when profitable', async () => {
      const input = `
        x = 12345;
        y = 12345;
        z = 12345;
        a = 12345;
        b = 12345;
        c = 12345;
        d = 12345;
        e = 12345;
        f = 12345;
        g = 12345;
      `;
      const output = await transform(input);

      expect((output.match(/12345/g) || []).length).toBe(1);
    });

    test('does not hoist small numbers when unprofitable', async () => {
      const input = `
        x = 0;
        y = 0;
        z = 0;
      `;
      const output = await transform(input);

      expect((output.match(/=0/g) || []).length).toBe(3);
    });
  });

  describe('boolean literals', () => {
    test('hoists true when profitable', async () => {
      const input = `
        a = true; b = true; c = true; d = true; e = true;
        f = true; g = true; h = true; i = true; j = true;
      `;
      const output = await transform(input);

      expect((output.match(/true/g) || []).length).toBe(1);
    });

    test('hoists false when profitable', async () => {
      const input = `
        a = false; b = false; c = false; d = false; e = false;
        f = false; g = false; h = false; i = false; j = false;
      `;
      const output = await transform(input);

      expect((output.match(/false/g) || []).length).toBe(1);
    });
  });

  describe('null and undefined', () => {
    test('hoists null when profitable', async () => {
      const input = `
        a = null; b = null; c = null; d = null; e = null;
        f = null; g = null; h = null; i = null; j = null;
      `;
      const output = await transform(input);

      expect((output.match(/null/g) || []).length).toBe(1);
    });

    test('hoists undefined when profitable', async () => {
      const input = `
        a = undefined;
        b = undefined;
        c = undefined;
        d = undefined;
        e = undefined;
      `;
      const output = await transform(input);

      expect((output.match(/undefined/g) || []).length).toBeLessThanOrEqual(2);
    });
  });

  describe('mixed literals', () => {
    test('handles multiple different literals', async () => {
      const input = `
        log("test"); log("test"); log("test"); log("test"); log("test");
        x = 999; y = 999; z = 999; a = 999; b = 999;
      `;
      const output = await transform(input);

      expect((output.match(/"test"/g) || []).length).toBe(1);
      expect((output.match(/999/g) || []).length).toBe(1);
    });
  });

  describe('nested scopes', () => {
    test('hoists literals from nested functions', async () => {
      const input = `
        function outer() {
          console.log("deeply");
          function inner() {
            console.log("deeply");
            console.log("deeply");
            console.log("deeply");
            console.log("deeply");
          }
        }
        console.log("deeply");
      `;
      const output = await transform(input);

      expect(output).toMatch(/^const [a-zA-Z]="deeply"/);
    });
  });

  describe('edge cases', () => {
    test('handles empty input', async () => {
      await expect(transform('')).resolves.toBeDefined();
    });

    test('handles input with no literals', async () => {
      const input = `const x = y + z`;
      await expect(transform(input)).resolves.toBeDefined();
    });

    test('preserves string in import statements', async () => {
      const input = `import foo from "module"`;
      const output = await transform(input);
      expect(output).toContain('"module"');
    });

    test('handles numeric property keys', async () => {
      const input = `
        obj[0] = 1;
        obj[0] = 2;
      `;
      await expect(transform(input)).resolves.toBeDefined();
    });
  });
});

describe('profit calculation accuracy', () => {
  test('correctly calculates break-even for string literals', async () => {
    const input3 = `x = "abc"; y = "abc"; z = "abc"`;
    const output3 = await transform(input3);
    expect((output3.match(/"abc"/g) || []).length).toBe(3);

    const input4 = `a = "abc"; b = "abc"; c = "abc"; d = "abc"`;
    const output4 = await transform(input4);
    expect((output4.match(/"abc"/g) || []).length).toBe(1);
  });

  test('accounts for identifier length in profit calculation', async () => {
    const input = `
      a1 = "str1"; a2 = "str1"; a3 = "str1"; a4 = "str1"; a5 = "str1";
      b1 = "str2"; b2 = "str2"; b3 = "str2"; b4 = "str2"; b5 = "str2";
    `;
    const output = await transform(input);

    expect(output).toContain('"str1"');
    expect(output).toContain('"str2"');
  });

  test('property access overhead is correctly calculated', async () => {
    const shortInput = `obj.x; obj.x; obj.x`;
    const shortOutput = await transform(shortInput);
    expect(shortOutput).toContain('obj.x');

    const longInput = `
      obj.verylongpropertyname; obj.verylongpropertyname;
      obj.verylongpropertyname; obj.verylongpropertyname;
      obj.verylongpropertyname; obj.verylongpropertyname;
    `;
    const longOutput = await transform(longInput);
    expect(longOutput).toMatch(/"verylongpropertyname"/);
  });
});

describe('split declaration optimization', () => {
  test('uses split format when 7+ strings are hoisted', async () => {
    const input = `
      log("str1"); log("str1"); log("str1"); log("str1");
      log("str2"); log("str2"); log("str2"); log("str2");
      log("str3"); log("str3"); log("str3"); log("str3");
      log("str4"); log("str4"); log("str4"); log("str4");
      log("str5"); log("str5"); log("str5"); log("str5");
      log("str6"); log("str6"); log("str6"); log("str6");
      log("str7"); log("str7"); log("str7"); log("str7");
    `;
    const output = await transform(input);

    expect(output).toContain('.split(');
  });

  test('uses regular const format when fewer than 7 strings', async () => {
    const input = `
      log("str1"); log("str1"); log("str1"); log("str1");
      log("str2"); log("str2"); log("str2"); log("str2");
      log("str3"); log("str3"); log("str3"); log("str3");
    `;
    const output = await transform(input);

    expect(output).toMatch(/^const\s+/);
    expect(output).not.toContain('.split(');
  });

  test('finds delimiter that is not in any string', async () => {
    const input = `
      log("a,1"); log("a,1"); log("a,1"); log("a,1");
      log("b,2"); log("b,2"); log("b,2"); log("b,2");
      log("c,3"); log("c,3"); log("c,3"); log("c,3");
      log("d,4"); log("d,4"); log("d,4"); log("d,4");
      log("e,5"); log("e,5"); log("e,5"); log("e,5");
      log("f,6"); log("f,6"); log("f,6"); log("f,6");
      log("g,7"); log("g,7"); log("g,7"); log("g,7");
    `;
    const output = await transform(input);

    expect(output).toContain('.split(');
    expect(output).not.toMatch(/\.split\(","\)/);
  });

  test('split format produces smaller output', async () => {
    const input = `
      log("string1"); log("string1"); log("string1"); log("string1");
      log("string2"); log("string2"); log("string2"); log("string2");
      log("string3"); log("string3"); log("string3"); log("string3");
      log("string4"); log("string4"); log("string4"); log("string4");
      log("string5"); log("string5"); log("string5"); log("string5");
      log("string6"); log("string6"); log("string6"); log("string6");
      log("string7"); log("string7"); log("string7"); log("string7");
      log("string8"); log("string8"); log("string8"); log("string8");
    `;
    const output = await transform(input);

    expect(output).toContain('.split(');
    expect(output).toContain('string1');
    expect(output).toContain('string8');
  });

  test('keeps non-string literals in separate const declaration', async () => {
    const input = `
      log("str1"); log("str1"); log("str1"); log("str1");
      log("str2"); log("str2"); log("str2"); log("str2");
      log("str3"); log("str3"); log("str3"); log("str3");
      log("str4"); log("str4"); log("str4"); log("str4");
      log("str5"); log("str5"); log("str5"); log("str5");
      log("str6"); log("str6"); log("str6"); log("str6");
      log("str7"); log("str7"); log("str7"); log("str7");
      x = 12345; y = 12345; z = 12345; a = 12345; b = 12345;
    `;
    const output = await transform(input);

    expect(output).toContain('.split(');
    expect(output).toMatch(/const\s+\w+=12345/);
  });
});

describe('selective hoisting', () => {
  test('hoists short strings for literals but not for property access', async () => {
    const input = `
      let arr1 = ["W", "W", "W", "W", "W"];
      let arr2 = ["W", "w"];
      myObj.W = 123;
      console.log(myObj.W);
    `;
    const output = await transform(input);

    expect(output).toMatch(/="W"/);
    expect(output).not.toMatch(/\["W","W"/);
    expect(output).toContain('.W=');
    expect(output).toContain('.W)');
    expect(output).not.toMatch(/\[[a-zA-Z]\]=123/);
  });

  test('hoists long strings for both literals and property access', async () => {
    const input = `
      let arr = ["longName", "longName", "longName"];
      myObj.longName = 1;
      myObj.longName = 2;
      myObj.longName = 3;
    `;
    const output = await transform(input);

    expect(output).toMatch(/="longName"/);
    expect(output).toMatch(/\[[a-zA-Z]\]=/);
  });

  test('hoists medium strings for literals and property access but not object keys', async () => {
    const input = `
      let arr = ["abc", "abc", "abc", "abc", "abc"];
      obj.abc; obj.abc; obj.abc; obj.abc; obj.abc;
      let x = { abc: 1 };
      let y = { abc: 2 };
    `;
    const output = await transform(input);

    expect(output).toMatch(/="abc"/);
    expect(output).toMatch(/{abc:/);
  });
});

describe('class method and property hoisting', () => {
  test('hoists class method names when profitable', async () => {
    const input = `
      class Foo {
        longMethodName() { return 1; }
      }
      class Bar {
        longMethodName() { return 2; }
      }
      class Baz {
        longMethodName() { return 3; }
      }
    `;
    const output = await transform(input);

    expect(output).toMatch(/="longMethodName"/);
    expect(output).toMatch(/\[[a-zA-Z]\]\(\)/);
  });

  test('hoists class property names when profitable', async () => {
    const input = `
      class Foo {
        longPropertyName = 1;
      }
      class Bar {
        longPropertyName = 2;
      }
      class Baz {
        longPropertyName = 3;
      }
    `;
    const output = await transform(input);

    expect(output).toMatch(/="longPropertyName"/);
    expect(output).toMatch(/\[[a-zA-Z]\]=/);
  });

  test('does not hoist short class method names', async () => {
    const input = `
      class Foo {
        x() { return 1; }
      }
      class Bar {
        x() { return 2; }
      }
    `;
    const output = await transform(input);

    expect(output).not.toMatch(/="x"/);
    expect(output).toMatch(/x\(\)/);
  });

  test('does not hoist short class property names', async () => {
    const input = `
      class Foo {
        y = 1;
      }
      class Bar {
        y = 2;
      }
    `;
    const output = await transform(input);

    expect(output).not.toMatch(/="y"/);
    expect(output).toMatch(/{y=/);
  });

  test('preserves constructor as non-computed', async () => {
    const input = `
      class Foo {
        constructor() { this.x = 1; }
      }
      class Bar {
        constructor() { this.x = 2; }
      }
      class Baz {
        constructor() { this.x = 3; }
      }
    `;
    const output = await transform(input);

    expect(output).toMatch(/constructor\(\)/);
    expect(output).not.toMatch(/\["constructor"\]/);
  });

  test('hoists shared names across methods, properties, and objects', async () => {
    const input = `
      class MyClass {
        sharedName() { return 1; }
      }
      const obj = { sharedName: 2 };
      instance.sharedName;
      instance.sharedName;
    `;
    const output = await transform(input);

    expect(output).toMatch(/="sharedName"/);
    expect((output.match(/"sharedName"/g) || []).length).toBe(1);
  });

  test('handles getters and setters', async () => {
    const input = `
      class Foo {
        get longAccessorName() { return this._val; }
        set longAccessorName(v) { this._val = v; }
      }
      class Bar {
        get longAccessorName() { return this._val; }
        set longAccessorName(v) { this._val = v; }
      }
    `;
    const output = await transform(input);

    expect(output).toMatch(/="longAccessorName"/);
    expect(output).toMatch(/get\s*\[[a-zA-Z]\]/);
    expect(output).toMatch(/set\s*\[[a-zA-Z]\]/);
  });

  test('handles static methods and properties', async () => {
    const input = `
      class Foo {
        static longStaticMethod() { return 1; }
        static longStaticProp = 1;
      }
      class Bar {
        static longStaticMethod() { return 2; }
        static longStaticProp = 2;
      }
      class Baz {
        static longStaticMethod() { return 3; }
        static longStaticProp = 3;
      }
    `;
    const output = await transform(input);

    expect(output).toMatch(/"longStaticMethod"/);
    expect(output).toMatch(/"longStaticProp"/);
  });
});
