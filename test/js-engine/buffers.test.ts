import { describe, expect, it } from 'vitest';

import { createRuntimeBuffers, NodeRealm } from '../../src/js-engine/index';

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

function createFixture() {
  const realm = new NodeRealm();
  return { realm, buffers: createRuntimeBuffers(realm) };
}
