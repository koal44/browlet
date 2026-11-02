import { describe, expect, it } from 'vitest';
import { itPassesWith } from '../test-runtime';

import { JSRealm } from '../../src/js-engine/index';

describe('realm-owned function bodies', () => {
  it('parses without executing and retains the function realm, parameters and dynamic receiver', () => {
    const realm = new JSRealm();
    Reflect.set(realm.globalObject, 'calls', 0);
    const fn = realm.compileFunction('++calls; return [this, event];', ['event'], {
      name: 'onstorage', contextExtensions: [],
    });
    expect(Reflect.get(realm.globalObject, 'calls')).toBe(0);
    expect(Object.getPrototypeOf(fn)).toBe(realm.Function.prototype);
    expect(fn.name).toBe('onstorage');
    expect(fn.length).toBe(1);
    const receiver = {};
    expect(Reflect.apply(fn, receiver, [5])).toEqual([receiver, 5]);
    expect(Reflect.get(realm.globalObject, 'calls')).toBe(1);
  });

  it('uses live object scopes from outermost to innermost, respecting unscopables', () => {
    const realm = new JSRealm();
    const document = { foo: 1 };
    const form = { foo: 2 };
    const element = { foo: 3, [Symbol.unscopables]: { foo: false } };
    const fn = realm.compileFunction('return foo;', [], {
      name: 'handler', contextExtensions: [document, form, element],
    });
    expect(fn()).toBe(3);
    element.foo = 5;
    expect(fn()).toBe(5);
    element[Symbol.unscopables].foo = true;
    expect(fn()).toBe(2);
  });

  it('uses Proxy scopes without reading them during compilation or replacing method receivers', () => {
    const realm = new JSRealm();
    const reads: PropertyKey[] = [];
    const scope = new Proxy({ foo: 5, method() { return this; } }, {
      get(target, key, receiver): unknown { reads.push(key); return Reflect.get(target, key, receiver); },
    });
    const fn = realm.compileFunction('foo++; return [foo, method(), event, this];', ['event'], {
      name: 'onclick', contextExtensions: [scope],
    });
    expect(reads).toEqual([]);
    expect(Object.getPrototypeOf(fn)).toBe(realm.Function.prototype);
    expect(fn.name).toBe('onclick');
    const receiver = {};
    expect(Reflect.apply(fn, receiver, [7])).toEqual([6, scope, 7, receiver]);
    expect(scope.foo).toBe(6);
  });

  it('adds no factory bindings or self-name binding and retains strict FunctionBody behavior', () => {
    const realm = new JSRealm();
    const scopes = [new Proxy({}, {})];
    Reflect.set(realm.globalObject, 'onclick', 5);
    const fn = realm.compileFunction('"use strict"; return [this, onclick, typeof scopes, typeof source, typeof factory];', [], {
      name: 'onclick', contextExtensions: scopes,
    });
    expect(fn()).toEqual([undefined, 5, 'undefined', 'undefined', 'undefined']);
    Reflect.set(realm.globalObject, 'onclick', 7);
    expect(fn()).toEqual([undefined, 7, 'undefined', 'undefined', 'undefined']);
    for (const source of ['}; globalThis.escaped = true; function other() {', '"use strict"; with ({}) {}']) {
      expect(() => realm.compileFunction(source, [], { name: 'onclick', contextExtensions: scopes }))
        .toThrow(realm.SyntaxError);
    }
    expect(Reflect.get(realm.globalObject, 'escaped')).toBeUndefined();
  });

  // Stock Node's Proxy-scope fallback still creates an anonymous literal.
  itPassesWith('namedFunctionSource')('retains the handler name in intrinsic source text with Proxy scopes', () => {
    const realm = new JSRealm();
    const fn = realm.compileFunction('return 5;', ['event'], {
      name: 'onclick', contextExtensions: [new Proxy({}, {})],
    });
    expect(realm.Function.prototype.toString.call(fn)).toBe('function onclick(event) {\nreturn 5;\n}');
  });

  // Stock Node cannot supply V8's retained source name; the function's own name is correct.
  itPassesWith('namedFunctionSource')('preserves the name in source text without introducing a self-name scope', () => {
    const realm = new JSRealm();
    Reflect.set(realm.globalObject, 'onstorage', 5);
    const fn = realm.compileFunction('return onstorage;', ['event'], {
      name: 'onstorage', contextExtensions: [],
    });
    expect(fn()).toBe(5);
    expect(fn.toString())
      .toBe('function onstorage(event) {\nreturn onstorage;\n}');
  });

  it('reports FunctionBody early errors in the selected realm and cannot escape the body', () => {
    const realm = new JSRealm();
    for (const source of ['return }', '}; globalThis.escaped = true; function other() {', '"use strict"; with ({}) {}']) {
      expect(() => realm.compileFunction(source, [], { name: 'handler', contextExtensions: [] }))
        .toThrow(realm.SyntaxError);
    }
    expect(Reflect.get(realm.globalObject, 'escaped')).toBeUndefined();
    expect(realm.compileFunction('return 5;', [], { name: 'handler', contextExtensions: [] })()).toBe(5);
  });
});
