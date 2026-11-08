import { describe, expect, it } from 'vitest';

import { JSRealm, createMicrotaskQueue } from '../../src/js-engine/index';

describe('realm source evaluation', () => {
  it('reruns identical source and allocates fresh objects and closures', () => {
    const realm = createRealm();
    const source = `(() => {
      globalThis.calls = (globalThis.calls ?? 0) + 1;
      let local = 0;
      return { calls: globalThis.calls, next: () => ++local };
    })()`;
    const first = realm.evaluate(source, 'repeat.js') as { calls: number; next: () => number; };
    const second = realm.evaluate(source, 'repeat.js') as typeof first;

    expect(first).not.toBe(second);
    expect(first.next).not.toBe(second.next);
    expect([first.calls, second.calls]).toEqual([1, 2]);
    expect([first.next(), first.next(), second.next()]).toEqual([1, 2, 1]);
  });

  it('keeps source locations and exception realms when source is repeated', () => {
    const realm = createRealm();
    for (const [filename, lineOffset] of [['first.js', 2], ['second.js', 6], ['first.js', 2]] as const) {
      const error = realm.evaluate('new Error("example")', filename, lineOffset) as Error;
      expect(Object.getPrototypeOf(error)).toBe(realm.Error.prototype);
      expect(error.stack).toContain(`${filename}:${lineOffset + 1}:`);
    }
    expect(() => realm.evaluate('const =', 'invalid.js')).toThrow();
    expect(realm.evaluate('5', 'invalid.js')).toBe(5);
  });

  it('performs global declaration checks on every execution', () => {
    const realm = createRealm();
    const source = 'let singleDeclaration = 5; singleDeclaration;';
    expect(realm.evaluate(source, 'declaration.js')).toBe(5);
    expect(() => realm.evaluate(source, 'declaration.js')).toThrow('already been declared');
  });

  it('keeps evaluation state local to each realm through alternating sources', () => {
    const first = createRealm();
    const second = createRealm();
    Reflect.set(first.globalObject, 'value', 5);
    Reflect.set(second.globalObject, 'value', 9);
    // Exercise both recently reused source and source displaced by a larger set.
    for (const index of [0, 1, 0, 1, ...Array.from({ length: 40 }, (_, value) => value), 0, 1]) {
      const source = `value + ${index}`;
      expect(first.evaluate(source, 'value.js')).toBe(5 + index);
      expect(second.evaluate(source, 'value.js')).toBe(9 + index);
    }
  });
});

function createRealm(): JSRealm {
  return new JSRealm(createMicrotaskQueue(), {
    dynamicImport: { importModule() { throw new Error('Unexpected import'); } },
  });
}
