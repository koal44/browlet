import { expect } from 'vitest';

import type { IDLType } from '../../src/web-idl/assembly/index';
import type { IDLValue } from '../../src/web-idl/values/value';
import type { Converter } from '../../src/web-idl/converters/converter';

import type { TestRealm as Realm } from './web-idl-realm';

/** Exercise the public converter entry or its retained steps with the same assertions. */
export function createConversionSteps(mode: 'direct' | 'prepared') {
  const jsToIDL = <Type extends IDLType>(value: unknown, converter: Converter<Type>): IDLValue<Type> =>
    mode === 'direct' ? converter.jsToIDL(value) : converter.getJSToIDLSteps()(value);
  const idlToJS = (value: unknown, converter: Converter): unknown =>
    mode === 'direct' ? converter.idlToJS(value) : converter.getIDLToJSSteps()(value);
  return { jsToIDL, idlToJS };
}

/** Require a conversion failure allocated in the selected realm. */
export function expectRealmTypeError(
  callback: () => unknown,
  realm: Realm,
): void {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(realm.TypeError);
    expect(error).not.toBeInstanceOf(TypeError);
    return;
  }
  throw new Error('Expected a target-realm TypeError');
}
