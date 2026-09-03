import { describe, expect, it } from 'vitest';

import * as JavaScript from '../../../src/javascript/index';

describe('JavaScript ArrayBuffer primitives', () => {
  it('reads ArrayBuffer and view state across realms', () => {
    const realm = new JavaScript.NodeRealm();
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

    expect(JavaScript.getBufferTypeName(values.buffer)).toBe('ArrayBuffer');
    expect(JavaScript.getBufferTypeName(values.shared))
      .toBe('SharedArrayBuffer');
    expect(JavaScript.getBufferTypeName(values.dataView)).toBe('DataView');
    expect(JavaScript.getBufferTypeName(values.view)).toBe('Uint16Array');
    expect(JavaScript.getBufferTypeName(
      Object.create(Uint8Array.prototype) as object,
    )).toBeUndefined();

    expect(JavaScript.getArrayBufferByteLength(values.buffer)).toBe(8);
    expect(JavaScript.getArrayBufferMaxByteLength(values.buffer)).toBe(16);
    expect(JavaScript.getArrayBufferMaxByteLength(values.shared)).toBe(8);
    expect(JavaScript.getArrayBufferViewBuffer(values.view)).toBe(values.buffer);
    expect(JavaScript.getArrayBufferViewByteOffset(values.view)).toBe(2);
    expect(JavaScript.getArrayBufferViewByteLength(values.view)).toBe(4);
    expect(JavaScript.getTypedArrayLength(values.view)).toBe(2);
    expect(JavaScript.getArrayBufferViewElementSize('Uint16Array')).toBe(2);
  });

  it('distinguishes fixed and length-tracking resizable views', () => {
    const buffer = new ArrayBuffer(8, { maxByteLength: 16 });
    const bytes = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
    new Uint8Array(buffer).set(bytes);
    const fixed = new Uint16Array(buffer, 2, 3);
    const tracking = new Uint16Array(buffer, 2);
    const fixedDataView = new DataView(buffer, 2, 6);
    const trackingDataView = new DataView(buffer, 2);

    expect(JavaScript.isLengthTrackingResizableArrayBufferView(fixed))
      .toBe(false);
    expect(JavaScript.isLengthTrackingResizableArrayBufferView(tracking))
      .toBe(true);
    expect(JavaScript.isLengthTrackingResizableArrayBufferView(fixedDataView))
      .toBe(false);
    expect(JavaScript.isLengthTrackingResizableArrayBufferView(trackingDataView))
      .toBe(true);
    expect(buffer.byteLength).toBe(8);
    expect(new Uint8Array(buffer)).toEqual(bytes);
  });

  it('reports detached buffers and out-of-bounds views', () => {
    const resizable = new ArrayBuffer(8, { maxByteLength: 8 });
    const view = new Uint8Array(resizable, 4, 4);
    resizable.resize(2);
    expect(JavaScript.isArrayBufferViewOutOfBounds(view)).toBe(true);

    const detached = new ArrayBuffer(2);
    structuredClone(detached, { transfer: [detached] });
    expect(JavaScript.isDetachedArrayBuffer(detached)).toBe(true);
  });
});
