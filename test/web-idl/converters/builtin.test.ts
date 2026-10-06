import { describe, expect, it } from 'vitest';

import { annotated, idlType, xattr } from '../../../src/web-idl/core/index';

import { createConversionSteps, createBinding, expectRealmTypeError } from '../../support/web-idl-conversion';

describe.each(['direct', 'prepared'] as const)('Web IDL %s built-in conversion', (mode) => {
  const { jsToIDL, idlToJS } = createConversionSteps(mode);

  it('converts primitive values and integer annotations', () => {
    const { binding, realm } = createBinding();
    const clamp = { kind: 'no-arguments', name: 'Clamp' } as const;
    const enforceRange = {
      kind: 'no-arguments', name: 'EnforceRange',
    } as const;

    expect(jsToIDL(257, binding.getConverter(binding.assembly.getIDLType(idlType.byte)))).toBe(1);
    expect(jsToIDL(-1, binding.getConverter(binding.assembly.getIDLType(idlType.octet)))).toBe(255);
    expect(jsToIDL(Infinity, binding.getConverter(binding.assembly.getIDLType(idlType.long)))).toBe(0);
    expect(jsToIDL(2.5, binding.getConverter(binding.assembly.getIDLType(annotated(idlType.byte, xattr(clamp))))))
      .toBe(2);
    expect(jsToIDL(3.5, binding.getConverter(binding.assembly.getIDLType(annotated(idlType.byte, xattr(clamp))))))
      .toBe(4);
    expect(jsToIDL(NaN, binding.getConverter(binding.assembly.getIDLType(annotated(idlType.byte, xattr(clamp))))))
      .toBe(0);
    expectRealmTypeError(
      () => jsToIDL(128, binding.getConverter(binding.assembly.getIDLType(annotated(idlType.byte, xattr(enforceRange))))),
      realm,
    );

    expect(jsToIDL(1.337, binding.getConverter(binding.assembly.getIDLType(idlType.float)))).toBe(Math.fround(1.337));
    expectRealmTypeError(
      () => jsToIDL(Infinity, binding.getConverter(binding.assembly.getIDLType(idlType.double))),
      realm,
    );
    expect(jsToIDL(true, binding.getConverter(binding.assembly.getIDLType(idlType.bigint)))).toBe(1n);
    expect(jsToIDL('10', binding.getConverter(binding.assembly.getIDLType(idlType.bigint)))).toBe(10n);
    expectRealmTypeError(
      () => jsToIDL({ valueOf: () => 1 }, binding.getConverter(binding.assembly.getIDLType(idlType.bigint))),
      realm,
    );
  });

  it('keeps identity and validation distinct for any, undefined, boolean, object, and symbol', () => {
    const { binding, realm } = createBinding();
    const types = binding.assembly.builtinTypes;
    const object = { valueOf() { throw new Error('Must not coerce'); } };
    const callable = () => {};
    const symbol = Symbol('value');
    for (const value of [object, callable, symbol, null, undefined, 1n]) {
      expect(jsToIDL(value, binding.getConverter(types.any))).toBe(value);
      expect(jsToIDL(value, binding.getConverter(types.undefined))).toBeUndefined();
      expect(idlToJS(value, binding.getConverter(types.undefined))).toBeUndefined();
    }
    expect(jsToIDL(object, binding.getConverter(types.boolean))).toBe(true);
    expect(jsToIDL(0, binding.getConverter(types.boolean))).toBe(false);
    expect(jsToIDL(object, binding.getConverter(types.object))).toBe(object);
    expect(jsToIDL(callable, binding.getConverter(types.object))).toBe(callable);
    expect(jsToIDL(symbol, binding.getConverter(types.symbol))).toBe(symbol);
    expectRealmTypeError(() => jsToIDL(null, binding.getConverter(types.object)), realm);
    expectRealmTypeError(() => jsToIDL(symbol, binding.getConverter(types.object)), realm);
    expectRealmTypeError(() => jsToIDL(Object(symbol), binding.getConverter(types.symbol)), realm);
  });

  it('realizes BigInt syntax failures without replacing author SyntaxErrors', () => {
    const { binding, realm } = createBinding();
    expect(() => jsToIDL('not an integer', binding.getConverter(binding.assembly.getIDLType(idlType.bigint))))
      .toThrow(realm.intrinsics.syntaxError);

    const authorError = new SyntaxError('author conversion');
    let caught: unknown;
    try {
      jsToIDL({
        [Symbol.toPrimitive]() { throw authorError; },
      }, binding.getConverter(binding.assembly.getIDLType(idlType.bigint)));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(authorError);
  });
});
