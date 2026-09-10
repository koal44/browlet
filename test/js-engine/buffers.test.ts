import { describe, expect, it } from 'vitest';

import {
  getArrayBufferByteLength, getArrayBufferMaxByteLength,
  getArrayBufferViewBuffer, getArrayBufferViewByteLength, getArrayBufferViewByteOffset,
  getArrayBufferViewElementSize, getBufferSourceByteLength, getBufferSourceCopy,
  getBufferSourceUnderlyingBuffer, getBufferTypeName, getTypedArrayLength,
  isArrayBufferViewOutOfBounds, isBufferSourceDetached, isDetachedArrayBuffer,
  isFixedBufferSource, isLengthTrackingArrayBufferView, JSRealm,
  writeArrayBuffer, writeArrayBufferView,
} from '../../src/js-engine/index';

describe('Runtime buffer ownership', () => {
  it('allocates final storage and shares it between target-realm views', () => {
    const { realm, buffers } = createFixture();
    const buffer = buffers.allocateArrayBuffer(8);
    const bytes = buffers.createView('Uint8Array', buffer);
    const words = buffers.createView('Uint16Array', buffer, 2, 2);
    const data = buffers.createView('DataView', buffer, 2, 4);

    expect(buffer).toBeInstanceOf(realm.intrinsics.bufferSource.arrayBuffer);
    expect(bytes).toBeInstanceOf(realm.intrinsics.bufferSource.views.Uint8Array!);
    expect(words).toBeInstanceOf(realm.intrinsics.bufferSource.views.Uint16Array!);
    expect(data).toBeInstanceOf(realm.intrinsics.bufferSource.views.DataView!);
    expect(Array.from(bytes)).toEqual(Array(8).fill(0));
    expect(words.buffer).toBe(buffer);
    expect(data.buffer).toBe(buffer);
    expect([words.byteOffset, words.length, words.byteLength]).toEqual([2, 2, 4]);
    expect([data.byteOffset, data.byteLength]).toEqual([2, 4]);

    data.setUint8(0, 73);
    expect(bytes[2]).toBe(73);
    expect(() => buffers.createView('Uint16Array', buffer, 1, 2))
      .toThrow(realm.intrinsics.rangeError);
    expect(() => buffers.createView('DataView', buffer, 7, 2))
      .toThrow(realm.intrinsics.rangeError);
  });

  it('creates a foreign view without replacing or copying its supplied buffer', () => {
    const { realm, buffers } = createFixture();
    const source = Uint8Array.of(1, 2, 3);
    const view = buffers.createView('Uint8Array', source.buffer, 1, 2);

    expect(view).toBeInstanceOf(realm.intrinsics.bufferSource.views.Uint8Array!);
    expect(view.buffer).toBe(source.buffer);
    view[0] = 19;
    expect(Array.from(source)).toEqual([1, 19, 3]);
  });

  it('transfers owned storage and preserves retained identity after mutation and detachment', () => {
    const { realm, buffers } = createFixture();
    const source = Uint8Array.of(7, 11, 13, 17);
    const alias = source.subarray(1, 3);
    const buffer = buffers.transferArrayBuffer(source.buffer);
    const view = buffers.createView('Uint8Array', buffer, 1, 2);

    expect(buffer).toBeInstanceOf(realm.intrinsics.bufferSource.arrayBuffer);
    expect(source.byteLength).toBe(0);
    expect(alias.byteLength).toBe(0);
    expect(Array.from(view)).toEqual([11, 13]);
    const retained = buffer;
    view[0] = 19;
    expect(buffers.createView('Uint8Array', retained)[1]).toBe(19);

    const next = buffers.transferArrayBuffer(buffer);
    expect(retained).toBe(buffer);
    expect(retained.byteLength).toBe(0);
    expect(view.byteLength).toBe(0);
    expect(buffers.createView('Uint8Array', next)[1]).toBe(19);
    expect(() => buffers.transferArrayBuffer(buffer))
      .toThrow(realm.intrinsics.typeError);
  });

  it('copies only borrowed bytes and leaves their original allocation intact', () => {
    const { realm, buffers } = createFixture();
    const source = Uint8Array.of(90, 1, 2, 91);
    const borrowed = source.subarray(1, 3);
    const buffer = buffers.copyArrayBuffer(borrowed);
    const bytes = buffers.copyUint8Array(borrowed);

    expect(buffer).toBeInstanceOf(realm.intrinsics.bufferSource.arrayBuffer);
    expect(bytes).toBeInstanceOf(realm.intrinsics.bufferSource.views.Uint8Array!);
    expect(bytes.buffer).toBeInstanceOf(realm.intrinsics.bufferSource.arrayBuffer);
    expect(buffer.byteLength).toBe(2);
    expect(bytes.buffer.byteLength).toBe(2);
    expect(Array.from(new Uint8Array(buffer))).toEqual([1, 2]);
    expect(Array.from(bytes)).toEqual([1, 2]);
    bytes[0] = 42;
    new Uint8Array(buffer)[1] = 43;
    expect(Array.from(source)).toEqual([90, 1, 2, 91]);
  });

  it('distinguishes fixed and length-tracking views of resizable storage', () => {
    const { buffers } = createFixture();
    const source = new ArrayBuffer(8, { maxByteLength: 16 });
    const buffer = buffers.transferArrayBuffer(source);
    const tracking = buffers.createView('Uint8Array', buffer, 2);
    const fixed = buffers.createView('Uint8Array', buffer, 2, 2);
    const data = buffers.createView('DataView', buffer, 2);

    expect(buffer.resizable).toBe(true);
    expect(buffer.maxByteLength).toBe(16);
    buffer.resize(12);
    expect(tracking.byteLength).toBe(10);
    expect(fixed.byteLength).toBe(2);
    expect(data.byteLength).toBe(10);
  });

  it('uses captured intrinsics after author globals have been replaced', () => {
    const { realm, buffers } = createFixture();
    realm.evaluate(`
      globalThis.ArrayBuffer = globalThis.Uint8Array = function () {
        throw new Error('replaced constructor');
      };
    `, 'replace-buffer-constructors.js');

    const source = Uint8Array.of(3, 5);
    const buffer = buffers.allocateArrayBuffer(2);
    const view = buffers.createView('Uint8Array', buffer);
    view.set(source);
    const transferred = buffers.transferArrayBuffer(buffer);
    expect(transferred).toBeInstanceOf(realm.intrinsics.bufferSource.arrayBuffer);
    expect(Array.from(buffers.createView('Uint8Array', transferred))).toEqual([3, 5]);
    expect(Array.from(buffers.copyUint8Array(source))).toEqual([3, 5]);
  });
});

describe('JavaScript ArrayBuffer primitives', () => {
  it('recognizes fixed buffer sources across realms without accepting impostors', () => {
    const realm = new JSRealm();
    const values = realm.evaluate(`(() => {
      const buffer = new ArrayBuffer(2);
      const shared = new SharedArrayBuffer(2);
      return [buffer, shared, new Uint8Array(buffer), new DataView(shared)];
    })()`, 'fixed-buffer-sources.js') as unknown[];

    for (const value of values) {
      expect(isFixedBufferSource(value)).toBe(true);
    }
    expect(isFixedBufferSource(Object.create(Uint8Array.prototype)))
      .toBe(false);
    expect(isFixedBufferSource(new Proxy(new Uint8Array(2), {})))
      .toBe(false);
  });

  it('reads ArrayBuffer and view state across realms', () => {
    const realm = new JSRealm();
    const values = realm.evaluate(`(() => {
      const buffer = new ArrayBuffer(8, { maxByteLength: 16 });
      return {
        buffer,
        dataView: new DataView(buffer, 1, 3),
        shared: new SharedArrayBuffer(4, { maxByteLength: 8 }),
        view: new Uint16Array(buffer, 2, 2),
      };
    })()`, 'buffers.js') as {
      buffer: object;
      dataView: object;
      shared: object;
      view: object;
    };

    expect(getBufferTypeName(values.buffer)).toBe('ArrayBuffer');
    expect(getBufferTypeName(values.shared))
      .toBe('SharedArrayBuffer');
    expect(getBufferTypeName(values.dataView)).toBe('DataView');
    expect(getBufferTypeName(values.view)).toBe('Uint16Array');
    for (const value of Object.values(values)) {
      expect(isFixedBufferSource(value)).toBe(false);
    }
    expect(getBufferTypeName(
      Object.create(Uint8Array.prototype) as object,
    )).toBeUndefined();

    expect(getArrayBufferByteLength(values.buffer)).toBe(8);
    expect(getArrayBufferMaxByteLength(values.buffer)).toBe(16);
    expect(getArrayBufferMaxByteLength(values.shared)).toBe(8);
    expect(getArrayBufferViewBuffer(values.view)).toBe(values.buffer);
    expect(getArrayBufferViewByteOffset(values.view)).toBe(2);
    expect(getArrayBufferViewByteLength(values.view)).toBe(4);
    expect(getTypedArrayLength(values.view)).toBe(2);
    expect(getArrayBufferViewElementSize('Uint16Array')).toBe(2);
  });

  it('distinguishes fixed and length-tracking resizable views', () => {
    const buffer = new ArrayBuffer(8, { maxByteLength: 16 });
    const bytes = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
    new Uint8Array(buffer).set(bytes);
    const fixed = new Uint16Array(buffer, 2, 3);
    const tracking = new Uint16Array(buffer, 2);
    const fixedDataView = new DataView(buffer, 2, 6);
    const trackingDataView = new DataView(buffer, 2);

    expect(isLengthTrackingArrayBufferView(fixed))
      .toBe(false);
    expect(isLengthTrackingArrayBufferView(tracking))
      .toBe(true);
    expect(isLengthTrackingArrayBufferView(fixedDataView))
      .toBe(false);
    expect(isLengthTrackingArrayBufferView(trackingDataView))
      .toBe(true);
    expect(buffer.byteLength).toBe(8);
    expect(new Uint8Array(buffer)).toEqual(bytes);
  });

  it('reports detached buffers and out-of-bounds views', () => {
    const resizable = new ArrayBuffer(8, { maxByteLength: 8 });
    const view = new Uint8Array(resizable, 4, 4);
    resizable.resize(2);
    expect(isArrayBufferViewOutOfBounds(view)).toBe(true);

    const detached = new ArrayBuffer(2);
    const detachedView = new Uint8Array(detached);
    structuredClone(detached, { transfer: [detached] });
    expect(isDetachedArrayBuffer(detached)).toBe(true);
    expect(isFixedBufferSource(detached)).toBe(true);
    expect(isFixedBufferSource(detachedView)).toBe(true);
  });
});

describe('Realm buffer creation and transfer', () => {
  it('creates and writes target-realm buffers and views', () => {
    const realm = new JSRealm();
    const buffer = realm.createArrayBuffer(Uint8Array.from([1, 2, 3, 4]));

    expect(buffer).toBeInstanceOf(realm.intrinsics.bufferSource.arrayBuffer);
    expect(getBufferSourceByteLength(buffer)).toBe(4);
    expect(getBufferSourceCopy(buffer)).toEqual(Uint8Array.from([1, 2, 3, 4]));

    writeArrayBuffer(buffer, [8, 9], 1);
    expect(getBufferSourceCopy(buffer)).toEqual(Uint8Array.from([1, 8, 9, 4]));

    const view = realm.createArrayBufferView(
      'Uint16Array',
      [1, 2, 3, 4],
    );
    const Uint16Array_ = realm.intrinsics.bufferSource.views.Uint16Array;
    if (!Uint16Array_) throw new Error('Missing Uint16Array intrinsic');
    expect(view).toBeInstanceOf(Uint16Array_);
    expect(getBufferSourceByteLength(view)).toBe(4);
    expect(getBufferSourceCopy(view)).toEqual(Uint8Array.from([1, 2, 3, 4]));

    writeArrayBufferView(view, [5, 6], 2);
    expect(getBufferSourceCopy(view)).toEqual(Uint8Array.from([1, 2, 5, 6]));
    expect(getBufferSourceByteLength(
      getBufferSourceUnderlyingBuffer(view),
    )).toBe(4);

    expect(() => realm.createArrayBufferView('Uint16Array', [1]))
      .toThrow(/multiple/);
  });

  it('creates shared buffers and copies their bytes', () => {
    const realm = new JSRealm();
    const buffer = realm.createSharedArrayBuffer([1, 2]);
    const SharedArrayBuffer_ = realm.intrinsics.bufferSource.sharedArrayBuffer;

    if (!SharedArrayBuffer_) throw new Error('Missing SharedArrayBuffer intrinsic');
    expect(buffer).toBeInstanceOf(SharedArrayBuffer_);
    expect(getBufferSourceCopy(buffer)).toEqual(Uint8Array.from([1, 2]));
  });

  it('detects detachment and transfers into the target realm', () => {
    const firstRealm = new JSRealm();
    const secondRealm = new JSRealm();
    const detached = firstRealm.createArrayBuffer([1, 2]);

    firstRealm.detachArrayBuffer(detached);
    expect(isBufferSourceDetached(detached)).toBe(true);
    expect(getBufferSourceCopy(detached)).toEqual(new Uint8Array());
    expect(() => firstRealm.detachArrayBuffer(detached)).not.toThrow();

    const source = firstRealm.createArrayBuffer([3, 4]);
    const transferred = secondRealm.transferArrayBuffer(source);

    expect(isBufferSourceDetached(source)).toBe(true);
    expect(transferred).toBeInstanceOf(
      secondRealm.intrinsics.bufferSource.arrayBuffer,
    );
    expect(getBufferSourceCopy(transferred)).toEqual(Uint8Array.from([3, 4]));
  });

  it.fails('reads the internal byte length of detached views', () => {
    const realm = new JSRealm();
    const buffer = realm.createArrayBuffer([1, 2, 3, 4]);
    const DataView_ = realm.intrinsics.bufferSource.views.DataView;
    const Uint8Array_ = realm.intrinsics.bufferSource.views.Uint8Array;
    if (!DataView_ || !Uint8Array_) throw new Error('Missing view intrinsics');

    const views = [
      Reflect.construct(DataView_, [buffer, 1, 2]) as object,
      Reflect.construct(Uint8Array_, [buffer, 1, 2]) as object,
    ];
    realm.detachArrayBuffer(buffer);
    const lengths = views.map((view) => {
      try {
        return getBufferSourceByteLength(view);
      } catch {
        return undefined;
      }
    });

    expect(lengths).toEqual([2, 2]);
  });
});

function createFixture() {
  const realm = new JSRealm();
  return { realm, buffers: realm.createRuntimeBuffers() };
}
