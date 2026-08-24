import { describe, expect, it } from 'vitest';

import { Realm } from '../../../src/browlet/realm';
import { assembleDefinitions } from '../../../src/web-idl/assembly';
import { JavaScriptBinding } from '../../../src/web-idl/binding';
import { invokeCallbackFunction } from '../../../src/web-idl/callback';
import { isCallbackFunctionValue } from '../../../src/web-idl/callback-value';
import {
  allowSharedBufferSourceIDL, arrayBufferViewIDL, bufferSourceIDL, functionIDL,
  voidFunctionIDL, webIDLCommonDefinitions,
} from '../../../src/web-idl/common-definitions';
import { convertToIDL } from '../../../src/web-idl/conversion';
import { reference } from '../../../src/web-idl/declaration/index';
import { PlatformObjectRegistry } from '../../../src/web-idl/platform-object';
import { serializeDefinitions } from '../../../src/web-idl/declaration/index';

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
    const binding = new JavaScriptBinding(
      assembleDefinitions(webIDLCommonDefinitions),
      realm,
      new PlatformObjectRegistry(),
    );
    const function_ = convertToIDL(
      realm.evaluate(
        '(function (...arguments_) { return arguments_; })',
        'common-function.js',
      ),
      reference('Function'),
      binding,
    );
    const voidFunction = convertToIDL(
      realm.evaluate('() => 42', 'common-void-function.js'),
      reference('VoidFunction'),
      binding,
    );
    if (
      !isCallbackFunctionValue(function_) ||
      !isCallbackFunctionValue(voidFunction)
    ) {
      throw new Error('Common callbacks did not convert to callback values');
    }

    expect(invokeCallbackFunction(
      function_,
      [1, 'two', null],
      'rethrow',
    )).toEqual([1, 'two', null]);
    expect(invokeCallbackFunction(
      voidFunction,
      [],
      'rethrow',
    )).toBeUndefined();
  });
});
