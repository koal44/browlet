import { assert, describe, expect, expectTypeOf, it } from 'vitest';

import { TypeError as InfraTypeError } from '../../src/infra/exceptions';
import { InternalError } from '../../src/infra/internal-error';
import {
  getArrayBufferByteLength, getArrayBufferMaxByteLength,
  getArrayBufferViewBuffer, getArrayBufferViewByteLength, getArrayBufferViewByteOffset,
  getArrayBufferViewElementSize, getBufferSourceByteLength, getBufferSourceCopy,
  getBufferSourceUnderlyingBuffer, getBufferSourceView, getBufferTypeName, getTypedArrayLength,
  isArrayBufferView, isArrayBufferViewOutOfBounds, isBufferType, isBufferSourceDetached, isDetachedArrayBuffer,
  isFixedBufferSource, isLengthTrackingArrayBufferView, JSRealm,
  writeArrayBuffer, writeArrayBufferView,
} from '../../src/js-engine/index';

describe('Runtime buffer ownership', () => {
  it.each([false, true])('borrows the selected byte range while copies stay independent (shared=%s)', (shared) => {
    const buffer = shared ? new SharedArrayBuffer(4) : new ArrayBuffer(4);
    const source = new Uint8Array(buffer);
    source.set([90, 1, 2, 91]);
    const input = new DataView(buffer, 1, 2);
    const view = getBufferSourceView(input);
    const copy = getBufferSourceCopy(input);

    source[1] = 7;
    expect(Array.from(view)).toEqual([7, 2]);
    expect(Array.from(copy)).toEqual([1, 2]);
    view[1] = 8;
    expect(Array.from(source)).toEqual([90, 7, 8, 91]);
  });

  it.each([false, true])('borrows the current buffer range without following later growth (shared=%s)', (shared) => {
    const buffer = shared
      ? new SharedArrayBuffer(4, { maxByteLength: 8 })
      : new ArrayBuffer(4, { maxByteLength: 8 });
    const borrowed = getBufferSourceView(buffer);
    if (buffer instanceof SharedArrayBuffer) buffer.grow(8);
    else buffer.resize(8);
    expect(borrowed.byteLength).toBe(4);
    borrowed[0] = 7;
    expect(new Uint8Array(buffer)[0]).toBe(7);
  });

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

  it('preserves the backing buffer type when allocating views', () => {
    const { buffers } = createFixture();
    const ordinary = buffers.createView('Uint8Array', new ArrayBuffer(2));
    const sharedBuffer = new SharedArrayBuffer(2);
    const shared = buffers.createView('Uint8Array', sharedBuffer);
    const data = buffers.createView('DataView', sharedBuffer);
    expectTypeOf(ordinary).toEqualTypeOf<Uint8Array<ArrayBuffer>>();
    expectTypeOf(shared).toEqualTypeOf<Uint8Array<SharedArrayBuffer>>();
    expectTypeOf(data).toEqualTypeOf<DataView<SharedArrayBuffer>>();
    expectTypeOf(getArrayBufferViewBuffer(shared)).toEqualTypeOf<SharedArrayBuffer>();
    expect(shared.buffer).toBe(sharedBuffer);
    expect(data.buffer).toBe(sharedBuffer);
    shared[1] = 19;
    expect(data.getUint8(1)).toBe(19);
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
  it('narrows buffer kinds without consulting author properties or accepting impostors', () => {
    const realm = new JSRealm();
    const value: unknown = realm.evaluate('new Uint16Array(4)', 'buffer-brand.js');
    assert(isBufferType(value, 'Uint16Array'));
    expectTypeOf(value).toEqualTypeOf<Uint16Array>();
    const fail = (): never => { throw new Error('author property was consulted'); };
    Object.defineProperties(value, {
      buffer: { get: fail },
      byteLength: { get: fail },
      byteOffset: { get: fail },
      [Symbol.toStringTag]: { get: fail },
    });
    expect(isBufferType(value, 'Uint16Array')).toBe(true);
    expect(isBufferType(value, 'Uint8Array')).toBe(false);
    expect(getBufferSourceView(value)).toHaveLength(8);
    realm.detachArrayBuffer(getArrayBufferViewBuffer(value) as ArrayBuffer);
    expect(isBufferType(value, 'Uint16Array')).toBe(true);
    expect(getBufferSourceView(value)).toHaveLength(0);

    for (const input of [undefined, null, 1, 'bytes', {}, Object.create(Uint16Array.prototype), new Proxy(value, {})]) {
      expect(isArrayBufferView(input)).toBe(false);
      expect(isBufferType(input, 'Uint16Array')).toBe(false);
    }
  });

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
      buffer: ArrayBuffer;
      dataView: DataView;
      shared: SharedArrayBuffer;
      view: Uint16Array;
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

  it.each(['DataView', 'Uint8Array'] as const)('reads current lengths as a %s moves in and out of bounds', (name) => {
    const realm = new JSRealm();
    const buffer = realm.allocateArrayBuffer(8, 16);
    const fixed = realm.createView(name, buffer, 2, 4);
    const tracking = realm.createView(name, buffer, 2);

    expect([buffer, fixed, tracking].map(getBufferSourceByteLength)).toEqual([8, 4, 6]);
    buffer.resize(12);
    expect([buffer, fixed, tracking].map(getBufferSourceByteLength)).toEqual([12, 4, 10]);

    buffer.resize(2);
    expect(getBufferSourceByteLength(buffer)).toBe(2);
    expect(getBufferSourceByteLength(tracking)).toBe(0);
    if (name === 'DataView') expect(() => getBufferSourceByteLength(fixed)).toThrow(InfraTypeError);
    else expect(getBufferSourceByteLength(fixed)).toBe(0);

    buffer.resize(1);
    if (name === 'DataView') expect(() => getBufferSourceByteLength(tracking)).toThrow(InfraTypeError);
    else expect(getBufferSourceByteLength(tracking)).toBe(0);

    buffer.resize(8);
    expect([buffer, fixed, tracking].map(getBufferSourceByteLength)).toEqual([8, 4, 6]);
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

  it.each([false, true])('reports accessible lengths after detachment (resizable=%s)', (resizable) => {
    const realm = new JSRealm();
    const buffer = realm.allocateArrayBuffer(4, resizable ? 8 : undefined);
    const data = realm.createView('DataView', buffer, 1, 2);
    const typed = realm.createView('Uint8Array', buffer, 1, 2);
    const dataToEnd = realm.createView('DataView', buffer, 1);
    const typedToEnd = realm.createView('Uint8Array', buffer, 1);

    expect([buffer, data, typed, dataToEnd, typedToEnd].map(getBufferSourceByteLength))
      .toEqual([4, 2, 2, 3, 3]);
    realm.detachArrayBuffer(buffer);

    expect(getBufferSourceByteLength(buffer)).toBe(0);
    expect(getBufferSourceByteLength(typed)).toBe(0);
    expect(getBufferSourceByteLength(typedToEnd)).toBe(0);
    expect(() => getBufferSourceByteLength(data)).toThrow(InfraTypeError);
    expect(() => getBufferSourceByteLength(dataToEnd)).toThrow(InfraTypeError);
  });

  it.each([
    ['byteLength', 'detached', getArrayBufferViewByteLength],
    ['byteOffset', 'detached', getArrayBufferViewByteOffset],
    ['byteLength', 'out-of-bounds', getArrayBufferViewByteLength],
    ['byteOffset', 'out-of-bounds', getArrayBufferViewByteOffset],
  ] as const)('contains native %s failures for %s DataViews', (_, state, read) => {
    const buffer = new ArrayBuffer(8, { maxByteLength: 16 });
    const view = new DataView(buffer, 2, 4);
    if (state === 'detached') structuredClone(buffer, { transfer: [buffer] });
    else buffer.resize(1);

    expect(() => read(view)).toThrow(InfraTypeError);
    expect(getArrayBufferViewBuffer(view)).toBe(buffer);
    expectTypeOf(read).parameter(0).toEqualTypeOf<ArrayBufferView>();
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

  it.each([0, 1])('rejects %i-byte writes to detached storage with an exception request', (byteCount) => {
    const bytes = new Array<number>(byteCount).fill(1);
    const buffer = new ArrayBuffer(4);
    const dataView = new DataView(buffer);
    const typedArray = new Uint8Array(buffer);
    structuredClone(buffer, { transfer: [buffer] });

    expect(() => writeArrayBuffer(buffer, bytes)).toThrow(InfraTypeError);
    expect(() => writeArrayBufferView(dataView, bytes)).toThrow(InfraTypeError);
    expect(() => writeArrayBufferView(typedArray, bytes)).toThrow(InfraTypeError);
  });

  it.each(['DataView', 'Uint8Array'] as const)('rejects empty writes to an out-of-bounds %s', (name) => {
    const buffer = new ArrayBuffer(8, { maxByteLength: 16 });
    const view = name === 'DataView' ? new DataView(buffer, 4, 4) : new Uint8Array(buffer, 4, 4);
    buffer.resize(2);

    expect(() => writeArrayBufferView(view, [])).toThrow(InfraTypeError);
  });

  it.each(['detached', 'out-of-bounds'])('contains native set failures for a %s source', (state) => {
    const buffer = new ArrayBuffer(8, { maxByteLength: 16 });
    const source = new Uint8Array(buffer, 4, 4);
    if (state === 'detached') structuredClone(buffer, { transfer: [buffer] });
    else buffer.resize(2);

    expect(() => writeArrayBuffer(new ArrayBuffer(0), source)).toThrow(InfraTypeError);
  });

  it('permits empty writes to live storage and preserves source getter exceptions', () => {
    const buffer = new ArrayBuffer(2);
    expect(() => writeArrayBuffer(buffer, [], 2)).not.toThrow();
    expect(() => writeArrayBufferView(new DataView(buffer, 2, 0), [])).not.toThrow();
    expect(() => writeArrayBufferView(new Uint8Array(buffer, 2, 0), [])).not.toThrow();
    expect(() => writeArrayBuffer(buffer, [], 3)).toThrow(InternalError);

    const failure = new TypeError('source getter failed');
    const bytes = [0];
    Object.defineProperty(bytes, 0, { get() { throw failure; } });
    let caught: unknown;
    try { writeArrayBuffer(buffer, bytes); }
    catch (error) { caught = error; }
    expect(caught).toBe(failure);
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
});

function createFixture() {
  const realm = new JSRealm();
  return { realm, buffers: realm.createRuntimeBuffers() };
}
