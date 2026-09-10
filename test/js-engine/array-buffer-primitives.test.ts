import { describe, expect, it } from 'vitest';

import * as JSEngine from '../../src/js-engine/index';

describe('JavaScript ArrayBuffer primitives', () => {
  it('recognizes fixed buffer sources across realms without accepting impostors', () => {
    const realm = new JSEngine.NodeRealm();
    const values = realm.evaluate(`(() => {
      const buffer = new ArrayBuffer(2);
      const shared = new SharedArrayBuffer(2);
      return [buffer, shared, new Uint8Array(buffer), new DataView(shared)];
    })()`, 'fixed-buffer-sources.js') as unknown[];

    for (const value of values) {
      expect(JSEngine.isFixedBufferSource(value)).toBe(true);
    }
    expect(JSEngine.isFixedBufferSource(Object.create(Uint8Array.prototype)))
      .toBe(false);
    expect(JSEngine.isFixedBufferSource(new Proxy(new Uint8Array(2), {})))
      .toBe(false);
  });

  it('reads ArrayBuffer and view state across realms', () => {
    const realm = new JSEngine.NodeRealm();
    const values = realm.evaluate(`(() => {
      const buffer = new ArrayBuffer(8, { maxByteLength: 16 });
      return {
        buffer,
        dataView: new DataView(buffer, 1, 3),
        shared: new SharedArrayBuffer(4, { maxByteLength: 8 }),
        view: new Uint16Array(buffer, 2, 2),
      };
    })()`, 'array-buffer-primitives.js') as {
      buffer: object;
      dataView: object;
      shared: object;
      view: object;
    };

    expect(JSEngine.getBufferTypeName(values.buffer)).toBe('ArrayBuffer');
    expect(JSEngine.getBufferTypeName(values.shared))
      .toBe('SharedArrayBuffer');
    expect(JSEngine.getBufferTypeName(values.dataView)).toBe('DataView');
    expect(JSEngine.getBufferTypeName(values.view)).toBe('Uint16Array');
    for (const value of Object.values(values)) {
      expect(JSEngine.isFixedBufferSource(value)).toBe(false);
    }
    expect(JSEngine.getBufferTypeName(
      Object.create(Uint8Array.prototype) as object,
    )).toBeUndefined();

    expect(JSEngine.getArrayBufferByteLength(values.buffer)).toBe(8);
    expect(JSEngine.getArrayBufferMaxByteLength(values.buffer)).toBe(16);
    expect(JSEngine.getArrayBufferMaxByteLength(values.shared)).toBe(8);
    expect(JSEngine.getArrayBufferViewBuffer(values.view)).toBe(values.buffer);
    expect(JSEngine.getArrayBufferViewByteOffset(values.view)).toBe(2);
    expect(JSEngine.getArrayBufferViewByteLength(values.view)).toBe(4);
    expect(JSEngine.getTypedArrayLength(values.view)).toBe(2);
    expect(JSEngine.getArrayBufferViewElementSize('Uint16Array')).toBe(2);
  });

  it('distinguishes fixed and length-tracking resizable views', () => {
    const buffer = new ArrayBuffer(8, { maxByteLength: 16 });
    const bytes = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
    new Uint8Array(buffer).set(bytes);
    const fixed = new Uint16Array(buffer, 2, 3);
    const tracking = new Uint16Array(buffer, 2);
    const fixedDataView = new DataView(buffer, 2, 6);
    const trackingDataView = new DataView(buffer, 2);

    expect(JSEngine.isLengthTrackingArrayBufferView(fixed))
      .toBe(false);
    expect(JSEngine.isLengthTrackingArrayBufferView(tracking))
      .toBe(true);
    expect(JSEngine.isLengthTrackingArrayBufferView(fixedDataView))
      .toBe(false);
    expect(JSEngine.isLengthTrackingArrayBufferView(trackingDataView))
      .toBe(true);
    expect(buffer.byteLength).toBe(8);
    expect(new Uint8Array(buffer)).toEqual(bytes);
  });

  it('reports detached buffers and out-of-bounds views', () => {
    const resizable = new ArrayBuffer(8, { maxByteLength: 8 });
    const view = new Uint8Array(resizable, 4, 4);
    resizable.resize(2);
    expect(JSEngine.isArrayBufferViewOutOfBounds(view)).toBe(true);

    const detached = new ArrayBuffer(2);
    const detachedView = new Uint8Array(detached);
    structuredClone(detached, { transfer: [detached] });
    expect(JSEngine.isDetachedArrayBuffer(detached)).toBe(true);
    expect(JSEngine.isFixedBufferSource(detached)).toBe(true);
    expect(JSEngine.isFixedBufferSource(detachedView)).toBe(true);
  });
});
