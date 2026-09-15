import { describe, expect, it } from 'vitest';

import {
  BindingWorld, defineInterface, impl, xattr, type BindingContext,
} from '../../../../src/web-idl/index';
import { DOMException as InternalDOMException } from '../../../../src/web-idl/core/dom-exception';
import {
  getBufferSourceCopy, getBufferSourceUnderlyingBuffer, isBufferSourceDetached,
} from '../../../../src/js-engine/index';
import { Realm } from '../../../../src/browlet/scripting/realm';
import {
  structuredDeserializeWithTransfer, structuredSerializeWithTransfer,
} from '../../../../src/browlet/scripting/structured-data/transfer';
import {
  isTransferableDetached, transferable,
} from '../../../../src/browlet/scripting/structured-data/transferable';

describe('HTML structured transfer', () => {
  it('transfers ArrayBuffers into the target realm with graph identity', () => {
    const { source, sourceRealm, target, targetRealm } = createContexts();
    const buffer = sourceRealm.evaluate(`(() => {
      const value = new ArrayBuffer(4);
      new Uint8Array(value).set([1, 2, 3, 4]);
      return value;
    })()`, 'structured-transfer-array-buffer.js') as ArrayBuffer;
    const value = { first: buffer, second: buffer };

    const serialized = structuredSerializeWithTransfer(
      value,
      [buffer],
      source,
    );
    expect(isBufferSourceDetached(buffer)).toBe(true);
    expect(serialized.transferDataHolders).toHaveLength(1);

    const result = structuredDeserializeWithTransfer(serialized, target);
    const clone = result.deserialized as typeof value;
    const transferred = result.transferredValues[0] as ArrayBuffer;

    expect(transferred).toBeInstanceOf(
      targetRealm.intrinsics.bufferSource.arrayBuffer,
    );
    expect(getBufferSourceCopy(transferred)).toEqual(
      Uint8Array.from([1, 2, 3, 4]),
    );
    expect(clone.first).toBe(transferred);
    expect(clone.second).toBe(transferred);
  });

  it('transfers the backing buffer referenced by an ArrayBuffer view', () => {
    const { source, sourceRealm, target, targetRealm } = createContexts();
    const view = sourceRealm.evaluate(`(() => {
      const value = new Uint8Array([1, 2, 3, 4]);
      return value.subarray(1, 3);
    })()`, 'structured-transfer-array-buffer-view.js') as object;
    const buffer = getBufferSourceUnderlyingBuffer(view);

    const serialized = structuredSerializeWithTransfer(
      view,
      [buffer],
      source,
    );
    const result = structuredDeserializeWithTransfer(serialized, target);
    const clone = result.deserialized as object;
    const transferred = result.transferredValues[0] as object;

    expect(isBufferSourceDetached(buffer)).toBe(true);
    expect(getBufferSourceUnderlyingBuffer(clone)).toBe(transferred);
    expect(getBufferSourceCopy(clone)).toEqual(Uint8Array.from([2, 3]));
    expect(transferred).toBeInstanceOf(
      targetRealm.intrinsics.bufferSource.arrayBuffer,
    );
  });

  it('preserves resizable ArrayBuffer bounds while transferring', () => {
    const { source, sourceRealm, target, targetRealm } = createContexts();
    const buffer = sourceRealm.evaluate(`(() => {
      const value = new ArrayBuffer(4, { maxByteLength: 8 });
      new Uint8Array(value).set([5, 6, 7, 8]);
      return value;
    })()`, 'structured-transfer-resizable-buffer.js') as ArrayBuffer;

    const serialized = structuredSerializeWithTransfer(
      buffer,
      [buffer],
      source,
    );
    expect(serialized.serialized.type).toBe('transfer-placeholder');
    expect(serialized.transferDataHolders[0]).toMatchObject({
      type: 'ResizableArrayBuffer',
      byteLength: 4,
      maxByteLength: 8,
    });

    const result = structuredDeserializeWithTransfer(serialized, target);
    const transferred = result.transferredValues[0] as ArrayBuffer;
    expect(result.deserialized).toBe(transferred);
    expect(transferred).toBeInstanceOf(
      targetRealm.intrinsics.bufferSource.arrayBuffer,
    );
    expect(transferred.resizable).toBe(true);
    expect(transferred.maxByteLength).toBe(8);
    expect(getBufferSourceCopy(transferred)).toEqual(
      Uint8Array.from([5, 6, 7, 8]),
    );
  });

  it('validates the whole transfer-list shape before mutation', () => {
    const { source, sourceRealm } = createContexts();
    const buffer = sourceRealm.evaluate(
      'new ArrayBuffer(2)',
      'structured-transfer-validation-buffer.js',
    ) as ArrayBuffer;
    const view = sourceRealm.evaluate(
      'new Uint8Array(2)',
      'structured-transfer-validation-view.js',
    );
    const shared = sourceRealm.evaluate(
      'new SharedArrayBuffer(2)',
      'structured-transfer-validation-shared.js',
    );

    expectDataCloneError(() => structuredSerializeWithTransfer(
      null,
      [buffer, 1],
      source,
    ));
    expect(isBufferSourceDetached(buffer)).toBe(false);
    expectDataCloneError(() => structuredSerializeWithTransfer(
      null,
      [buffer, buffer],
      source,
    ));
    expect(isBufferSourceDetached(buffer)).toBe(false);
    expectDataCloneError(() => structuredSerializeWithTransfer(
      null,
      [view],
      source,
    ));
    expectDataCloneError(() => structuredSerializeWithTransfer(
      null,
      [shared],
      source,
    ));
  });

  it('serializes the graph before performing irreversible transfers', () => {
    const { source, sourceRealm } = createContexts();
    const buffer = sourceRealm.evaluate(
      'new ArrayBuffer(2)',
      'structured-transfer-atomic-buffer.js',
    ) as ArrayBuffer;
    const expected = new Error('getter failed');
    const value = Object.defineProperty({}, 'failure', {
      enumerable: true,
      get() {
        throw expected;
      },
    });

    expect(() => structuredSerializeWithTransfer(value, [buffer], source))
      .toThrow(expected);
    expect(isBufferSourceDetached(buffer)).toBe(false);
  });

  // HTML interleaves detachedness checks with transfer steps. Engines differ
  // for all-ArrayBuffer lists and none guarantees mixed-list atomicity; retain
  // the literal order pending the standards resolution recorded in ROADMAP.md.
  it('retains the specification\'s sequential detached-buffer behavior', () => {
    const { source, sourceRealm } = createContexts();
    const first = sourceRealm.evaluate(
      'new ArrayBuffer(2)',
      'structured-transfer-first-buffer.js',
    ) as ArrayBuffer;
    const second = sourceRealm.evaluate(
      'new ArrayBuffer(2)',
      'structured-transfer-second-buffer.js',
    ) as ArrayBuffer;
    sourceRealm.detachArrayBuffer(second);

    expectDataCloneError(() => structuredSerializeWithTransfer(
      null,
      [first, second],
      source,
    ));
    expect(isBufferSourceDetached(first)).toBe(true);
    expect(isBufferSourceDetached(second)).toBe(true);
  });

  it('runs exact platform transfer and receiving capabilities', () => {
    class TransferBoxImpl {
      value = '';
    }

    const transferBoxIDL = defineInterface({
      name: 'TransferBox',
      exposed: 'Window',
      ...xattr('Transferable'),
      implementation: impl(TransferBoxImpl),
      members: [],
    });
    const capabilities = [transferable.for(transferBoxIDL, {
      transferSteps(value, dataHolder) {
        dataHolder.set('Value', (value as TransferBoxImpl).value);
      },
      transferReceivingSteps(dataHolder, value) {
        (value as TransferBoxImpl).value = dataHolder.get('Value') as string;
      },
    })];
    const bindings = new BindingWorld<Realm>([transferBoxIDL], { capabilities });
    const sourceRealm = new Realm();
    const targetRealm = new Realm();
    const source = bindings.register(sourceRealm);
    const target = bindings.register(targetRealm);
    const original = source.createPlatformObject(transferBoxIDL);
    source.unwrap(original.platformObject, TransferBoxImpl)!.value = 'transferred';

    expectDataCloneError(() => structuredSerializeWithTransfer(
      original.platformObject,
      [original.platformObject, original.platformObject],
      source,
    ));
    expect(isTransferableDetached(original.implInst)).toBe(false);

    expectDataCloneError(() => structuredSerializeWithTransfer(
      original.platformObject,
      [original.platformObject, original.implInst],
      source,
    ));
    expect(isTransferableDetached(original.implInst)).toBe(false);

    const serialized = structuredSerializeWithTransfer(
      { first: original.platformObject, second: original.implInst },
      [original.platformObject],
      source,
    );
    expect(isTransferableDetached(original.implInst)).toBe(true);

    const result = structuredDeserializeWithTransfer(serialized, target);
    const transferred = result.transferredValues[0];
    const resolved = target.getObjectRecord(transferred);
    const clone = result.deserialized as { first: object; second: object; };
    expect(clone.first).toBe(transferred);
    expect(clone.second).toBe(transferred);
    expect(resolved?.primaryInterface.definition).toBe(transferBoxIDL);
    expect(target.unwrap(transferred, TransferBoxImpl)?.value)
      .toBe('transferred');
    expect(isTransferableDetached(resolved!.implInst)).toBe(false);

    const hiddenRealm = new Realm({ globalNames: ['Worker'] });
    const hiddenTarget = bindings.register(hiddenRealm);
    const hiddenOriginal = source.createPlatformObject(transferBoxIDL);
    const hiddenSerialized = structuredSerializeWithTransfer(
      hiddenOriginal.platformObject,
      [hiddenOriginal.platformObject],
      source,
    );
    expectDataCloneError(() => structuredDeserializeWithTransfer(
      hiddenSerialized,
      hiddenTarget,
    ));
  });
});

function createContexts(): {
  source: BindingContext<Realm>;
  sourceRealm: Realm;
  target: BindingContext<Realm>;
  targetRealm: Realm;
} {
  const bindings = new BindingWorld<Realm>([]);
  const sourceRealm = new Realm();
  const targetRealm = new Realm();
  const source = bindings.register(sourceRealm);
  const target = bindings.register(targetRealm);
  return {
    source,
    sourceRealm,
    target,
    targetRealm,
  };
}

function expectDataCloneError(steps: () => unknown): void {
  try {
    steps();
  } catch (error) {
    expect(InternalDOMException.is(error)).toBe(true);
    expect(error).toMatchObject({
      message: '',
      name: 'DataCloneError',
    });
    return;
  }
  throw new Error('Expected a DataCloneError DOMException');
}
