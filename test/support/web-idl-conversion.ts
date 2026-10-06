import { expect } from 'vitest';

import type { Definition } from '../../src/web-idl/core/index';
import type { IDLType } from '../../src/web-idl/assembly/index';
import type { IDLValue } from '../../src/web-idl/values/value';
import type { Converter } from '../../src/web-idl/converters/converter';
import { BindingWorld } from '../../src/web-idl/binding/world';
import type { RealmBinding } from '../../src/web-idl/binding/realm';

import { TestRealm as Realm } from './web-idl-realm';

/** Exercise the public converter entry or its retained steps with the same assertions. */
export function createConversionSteps(mode: 'direct' | 'prepared') {
  const jsToIDL = <Type extends IDLType>(value: unknown, converter: Converter<Type>): IDLValue<Type> =>
    mode === 'direct' ? converter.jsToIDL(value) : converter.getJSToIDLSteps()(value);
  const idlToJS = (value: unknown, converter: Converter): unknown =>
    mode === 'direct' ? converter.idlToJS(value) : converter.getIDLToJSSteps()(value);
  return { jsToIDL, idlToJS };
}

/** Register a minimal realm with the definitions needed by a conversion test. */
export function createBinding(
  definitions: Definition[] = [],
): { binding: RealmBinding; realm: Realm; } {
  const realm = new Realm();
  const world = new BindingWorld(definitions);
  world.register(realm, (ctx) => ({ realm: ctx.realm }));
  return { binding: world.getRealmBinding(realm)!, realm };
}

/** Require a conversion failure allocated in the selected realm. */
export function expectRealmTypeError(
  callback: () => unknown,
  realm: Realm,
): void {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(realm.intrinsics.typeError);
    expect(error).not.toBeInstanceOf(TypeError);
    return;
  }
  throw new Error('Expected a target-realm TypeError');
}
