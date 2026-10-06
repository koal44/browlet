import { describe, expect, it } from 'vitest';

import {
  annotated, defineTypedef, idlType, nullable, reference, union, xattr,
} from '../../../src/web-idl/core/index';

import { createConversionSteps, createBinding, expectRealmTypeError } from '../../support/web-idl-conversion';

describe.each(['direct', 'prepared'] as const)('Web IDL %s buffer-source conversion', (mode) => {
  const { jsToIDL, idlToJS } = createConversionSteps(mode);

  it('converts buffer source types by brand, backing buffer, and annotations', () => {
    const { binding, realm } = createBinding();
    const allowResizable = {
      kind: 'no-arguments', name: 'AllowResizable',
    } as const;
    const allowShared = {
      kind: 'no-arguments', name: 'AllowShared',
    } as const;
    const arrayBuffer = realm.evaluate(
      'new ArrayBuffer(4)',
      'buffer-source-array-buffer.js',
    ) as object;
    const resizable = realm.evaluate(
      'new ArrayBuffer(4, { maxByteLength: 8 })',
      'buffer-source-resizable.js',
    ) as object;
    const uint8 = realm.evaluate(
      'new Uint8Array(new ArrayBuffer(4))',
      'buffer-source-uint8.js',
    ) as object;
    const shared = realm.evaluate(
      'new SharedArrayBuffer(4)',
      'buffer-source-shared.js',
    ) as object;
    const growableShared = realm.evaluate(
      'new SharedArrayBuffer(4, { maxByteLength: 8 })',
      'buffer-source-growable-shared.js',
    ) as object;
    const sharedView = realm.evaluate(
      'new Uint8Array(new SharedArrayBuffer(4))',
      'buffer-source-shared-view.js',
    ) as object;
    const growableView = realm.evaluate(
      'new Uint8Array(new SharedArrayBuffer(4, { maxByteLength: 8 }))',
      'buffer-source-growable-view.js',
    ) as object;
    const detachedView = realm.evaluate(
      `(() => {
        const buffer = new ArrayBuffer(4);
        const view = new DataView(buffer);
        buffer.transfer();
        return view;
      })()`,
      'buffer-source-detached-view.js',
    ) as object;

    expect(jsToIDL(arrayBuffer, binding.getConverter(binding.assembly.getIDLType(idlType.ArrayBuffer))))
      .toBe(arrayBuffer);
    expect(idlToJS(arrayBuffer, binding.getConverter(binding.assembly.getIDLType(idlType.ArrayBuffer))))
      .toBe(arrayBuffer);
    expect(jsToIDL(uint8, binding.getConverter(binding.assembly.getIDLType(idlType.Uint8Array)))).toBe(uint8);
    expect(jsToIDL(detachedView, binding.getConverter(binding.assembly.getIDLType(idlType.DataView))))
      .toBe(detachedView);
    expectRealmTypeError(
      () => jsToIDL(uint8, binding.getConverter(binding.assembly.getIDLType(idlType.Uint16Array))),
      realm,
    );

    expectRealmTypeError(
      () => jsToIDL(resizable, binding.getConverter(binding.assembly.getIDLType(idlType.ArrayBuffer))),
      realm,
    );
    expect(jsToIDL(resizable, binding.getConverter(binding.assembly.getIDLType(annotated(idlType.ArrayBuffer, xattr(allowResizable)))))).toBe(resizable);

    expect(jsToIDL(shared, binding.getConverter(binding.assembly.getIDLType(idlType.SharedArrayBuffer))))
      .toBe(shared);
    expectRealmTypeError(
      () => jsToIDL(growableShared, binding.getConverter(binding.assembly.getIDLType(idlType.SharedArrayBuffer))),
      realm,
    );
    expect(jsToIDL(growableShared, binding.getConverter(binding.assembly.getIDLType(annotated(idlType.SharedArrayBuffer, xattr(allowResizable)))))).toBe(growableShared);
    expectRealmTypeError(
      () => jsToIDL(sharedView, binding.getConverter(binding.assembly.getIDLType(idlType.Uint8Array))),
      realm,
    );
    expect(jsToIDL(sharedView, binding.getConverter(binding.assembly.getIDLType(annotated(idlType.Uint8Array, xattr(allowShared)))))).toBe(sharedView);
    expectRealmTypeError(
      () => jsToIDL(growableView, binding.getConverter(binding.assembly.getIDLType(annotated(idlType.Uint8Array, xattr(allowShared))))),
      realm,
    );
    expect(jsToIDL(growableView, binding.getConverter(binding.assembly.getIDLType(annotated(idlType.Uint8Array, xattr(allowShared, allowResizable)))))).toBe(growableView);

    expect(jsToIDL(arrayBuffer, binding.getConverter(binding.assembly.getIDLType(reference('BufferSource'))))).toBe(arrayBuffer);
    expect(jsToIDL(uint8, binding.getConverter(binding.assembly.getIDLType(reference('BufferSource'))))).toBe(uint8);
    expectRealmTypeError(
      () => jsToIDL(shared, binding.getConverter(binding.assembly.getIDLType(reference('BufferSource')))),
      realm,
    );
    expectRealmTypeError(
      () => jsToIDL(sharedView, binding.getConverter(binding.assembly.getIDLType(reference('BufferSource')))),
      realm,
    );
    expect(jsToIDL(shared, binding.getConverter(binding.assembly.getIDLType(reference('AllowSharedBufferSource'))))).toBe(shared);
    expect(jsToIDL(sharedView, binding.getConverter(binding.assembly.getIDLType(reference('AllowSharedBufferSource'))))).toBe(sharedView);
  });

  it('combines buffer annotations through aliases, nullable types, and union members', () => {
    const { binding, realm } = createBinding([
      defineTypedef({
        name: 'SharedView', type: annotated(idlType.Uint8Array, xattr('AllowShared')),
      }),
    ]);
    const type = nullable(union(reference('SharedView'), idlType.boolean));
    const resizable = annotated(type, xattr('AllowResizable'));
    const view = new Uint8Array(new SharedArrayBuffer(4, { maxByteLength: 8 }));

    for (let attempt = 0; attempt < 2; attempt++) {
      expect(jsToIDL(view, binding.getConverter(binding.assembly.getIDLType(resizable)))).toBe(view);
      expectRealmTypeError(() => jsToIDL(view, binding.getConverter(binding.assembly.getIDLType(type))), realm);
      expectRealmTypeError(() => jsToIDL(view, binding.getConverter(binding.assembly.getIDLType(idlType.Uint8Array))), realm);
      expect(jsToIDL(null, binding.getConverter(binding.assembly.getIDLType(resizable)))).toBeNull();
      expect(idlToJS(view, binding.getConverter(binding.assembly.getIDLType(resizable)))).toBe(view);
    }
  });
});
