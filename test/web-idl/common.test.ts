import { describe, expect, it } from 'vitest';

import { TestRealm as Realm } from './test-realm';
import { DefinitionAssembly } from '../../src/web-idl/assembly/index';
import { BindingWorld } from '../../src/web-idl/binding/world';
import { RealmBinding } from '../../src/web-idl/binding/realm';

import { IDLCallbackFunction } from '../../src/web-idl/values/callback';
import {
  allowSharedBufferSourceIDL, arrayBufferViewIDL, bufferSourceIDL, functionIDL,
  voidFunctionIDL, webIDLCommonDefinitions,
} from '../../src/web-idl/core/common';

import { reference, serializeDefinitions } from '../../src/web-idl/core/index';

describe('Web IDL common definitions', () => {
  it('represents the common typedefs and callbacks losslessly', () => {
    expect(serializeDefinitions([
      arrayBufferViewIDL,
      bufferSourceIDL,
      allowSharedBufferSourceIDL,
      functionIDL,
      voidFunctionIDL,
    ])).toBe(`typedef (Int8Array or Int16Array or Int32Array or Uint8Array or Uint16Array or Uint32Array or Uint8ClampedArray or BigInt64Array or BigUint64Array or Float16Array or Float32Array or Float64Array or DataView) ArrayBufferView;

typedef (ArrayBufferView or ArrayBuffer) BufferSource;

typedef (ArrayBuffer or SharedArrayBuffer or [AllowShared] ArrayBufferView) AllowSharedBufferSource;

callback Function = any(any... arguments);

callback VoidFunction = undefined();`);
  });

  it('invokes Function and VoidFunction with their common contracts', () => {
    const realm = new Realm();
    const binding = new RealmBinding(
      new DefinitionAssembly(webIDLCommonDefinitions),
      realm,
      new BindingWorld([]),
      (ctx) => ({ realm: ctx.realm }),
    );
    const function_ = binding.getConverter(binding.assembly.getIDLType(reference('Function'))).jsToIDL(realm.evaluate(
      '(function (...args) { return args; })',
      'common-function.js',
    ));
    const voidFunction = binding.getConverter(binding.assembly.getIDLType(reference('VoidFunction'))).jsToIDL(realm.evaluate('() => 42', 'common-void-function.js'));
    if (
      !IDLCallbackFunction.is(function_) ||
      !IDLCallbackFunction.is(voidFunction)
    ) {
      throw new Error('Common callbacks did not convert to callback values');
    }

    expect(function_.invoke([1, 'two', null],
      'rethrow',
    )).toEqual([1, 'two', null]);
    expect(voidFunction.invoke([],
      'rethrow',
    )).toBeUndefined();
  });
});
