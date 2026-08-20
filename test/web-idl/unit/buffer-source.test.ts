import { describe, expect, it } from 'vitest';

import { Realm } from '../../../src/browlet/realm';
import {
  createArrayBuffer, createArrayBufferView, createSharedArrayBuffer,
  detachArrayBuffer, getBufferSourceByteLength, getBufferSourceCopy,
  getBufferSourceUnderlyingBuffer, isBufferSourceDetached,
  transferArrayBuffer, writeArrayBuffer, writeArrayBufferView,
} from '../../../src/web-idl/buffer-source';

describe('Web IDL buffer source algorithms', () => {
  it('creates and writes target-realm buffers and views', () => {
    const realm = new Realm();
    const buffer = createArrayBuffer(Uint8Array.from([1, 2, 3, 4]), realm);

    expect(buffer).toBeInstanceOf(realm.intrinsics.bufferSource.arrayBuffer);
    expect(getBufferSourceByteLength(buffer)).toBe(4);
    expect(getBufferSourceCopy(buffer)).toEqual(Uint8Array.from([1, 2, 3, 4]));

    writeArrayBuffer(buffer, [8, 9], 1);
    expect(getBufferSourceCopy(buffer)).toEqual(Uint8Array.from([1, 8, 9, 4]));

    const view = createArrayBufferView(
      'Uint16Array',
      [1, 2, 3, 4],
      realm,
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

    expect(() => createArrayBufferView('Uint16Array', [1], realm))
      .toThrow(/multiple/);
  });

  it('creates shared buffers and copies their bytes', () => {
    const realm = new Realm();
    const buffer = createSharedArrayBuffer([1, 2], realm);
    const SharedArrayBuffer_ = realm.intrinsics.bufferSource.sharedArrayBuffer;

    if (!SharedArrayBuffer_) throw new Error('Missing SharedArrayBuffer intrinsic');
    expect(buffer).toBeInstanceOf(SharedArrayBuffer_);
    expect(getBufferSourceCopy(buffer)).toEqual(Uint8Array.from([1, 2]));
  });

  it('detects detachment and transfers into the target realm', () => {
    const firstRealm = new Realm();
    const secondRealm = new Realm();
    const detached = createArrayBuffer([1, 2], firstRealm);

    detachArrayBuffer(detached, firstRealm);
    expect(isBufferSourceDetached(detached)).toBe(true);
    expect(getBufferSourceCopy(detached)).toEqual(new Uint8Array());
    expect(() => detachArrayBuffer(detached, firstRealm)).not.toThrow();

    const source = createArrayBuffer([3, 4], firstRealm);
    const transferred = transferArrayBuffer(source, secondRealm);

    expect(isBufferSourceDetached(source)).toBe(true);
    expect(transferred).toBeInstanceOf(
      secondRealm.intrinsics.bufferSource.arrayBuffer,
    );
    expect(getBufferSourceCopy(transferred)).toEqual(Uint8Array.from([3, 4]));
  });
});
