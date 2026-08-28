import { describe, expect, it } from 'vitest';

import { getDOMExceptionRequest } from '../../../../../src/shared/dom-exception';
import {
  createBindings, defineInterface, impl, xattr,
} from '../../../../../src/web-idl/index';
import {
  detachArrayBuffer, getBufferSourceCopy, isBufferSourceDetached,
} from '../../../../../src/web-idl/buffer-source';
import { Realm } from '../../../../../src/browlet/scripting/realm';
import type { StructuredDataEnvironment } from '../../../../../src/browlet/scripting/structured-data/environment';
import {
  structuredDeserializeWithTransfer, structuredSerializeWithTransfer,
} from '../../../../../src/browlet/scripting/structured-data/transfer';
import {
  isTransferableDetached, transferable,
} from '../../../../../src/browlet/scripting/structured-data/transferable';

describe('HTML structured transfer', () => {
  it('transfers ArrayBuffers into the target realm with graph identity', () => {
    const { source, sourceRealm, target, targetRealm } = createEnvironments();
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

  it('preserves resizable ArrayBuffer bounds while transferring', () => {
    const { source, sourceRealm, target, targetRealm } = createEnvironments();
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
    const { source, sourceRealm } = createEnvironments();
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
    const { source, sourceRealm } = createEnvironments();
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
  // the literal order pending the standards resolution recorded in roadmap.md.
  it('retains the specification\'s sequential detached-buffer behavior', () => {
    const { source, sourceRealm } = createEnvironments();
    const first = sourceRealm.evaluate(
      'new ArrayBuffer(2)',
      'structured-transfer-first-buffer.js',
    ) as ArrayBuffer;
    const second = sourceRealm.evaluate(
      'new ArrayBuffer(2)',
      'structured-transfer-second-buffer.js',
    ) as ArrayBuffer;
    detachArrayBuffer(second, sourceRealm);

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
    const bindings = createBindings([transferBoxIDL], { capabilities });
    const sourceRealm = new Realm();
    const targetRealm = new Realm();
    const sourceRegistration = bindings.register(sourceRealm);
    const targetRegistration = bindings.register(targetRealm);
    const agentCluster = {};
    const source: StructuredDataEnvironment = {
      agentCluster,
      interfaces: sourceRegistration.interfaces,
      realm: sourceRealm,
    };
    const target: StructuredDataEnvironment = {
      agentCluster,
      interfaces: targetRegistration.interfaces,
      realm: targetRealm,
    };
    const original = sourceRegistration.interfaces.create(transferBoxIDL);
    (original.implementation as TransferBoxImpl).value = 'transferred';

    expectDataCloneError(() => structuredSerializeWithTransfer(
      original.object,
      [original.object, original.object],
      source,
    ));
    expect(isTransferableDetached(original.implementation)).toBe(false);

    const serialized = structuredSerializeWithTransfer(
      original.object,
      [original.object],
      source,
    );
    expect(isTransferableDetached(original.implementation)).toBe(true);

    const result = structuredDeserializeWithTransfer(serialized, target);
    const transferred = result.transferredValues[0];
    const resolved = targetRegistration.interfaces.resolve(transferred);
    expect(result.deserialized).toBe(transferred);
    expect(resolved?.primaryInterface).toBe(transferBoxIDL);
    expect((resolved?.implementation as TransferBoxImpl).value)
      .toBe('transferred');
    expect(isTransferableDetached(resolved!.implementation)).toBe(false);

    const hiddenRealm = new Realm({ globalNames: ['Worker'] });
    const hiddenRegistration = bindings.register(hiddenRealm);
    const hiddenTarget: StructuredDataEnvironment = {
      agentCluster,
      interfaces: hiddenRegistration.interfaces,
      realm: hiddenRealm,
    };
    const hiddenOriginal = sourceRegistration.interfaces.create(transferBoxIDL);
    const hiddenSerialized = structuredSerializeWithTransfer(
      hiddenOriginal.object,
      [hiddenOriginal.object],
      source,
    );
    expectDataCloneError(() => structuredDeserializeWithTransfer(
      hiddenSerialized,
      hiddenTarget,
    ));
  });
});

function createEnvironments(): {
  source: StructuredDataEnvironment;
  sourceRealm: Realm;
  target: StructuredDataEnvironment;
  targetRealm: Realm;
} {
  const bindings = createBindings([]);
  const sourceRealm = new Realm();
  const targetRealm = new Realm();
  const sourceRegistration = bindings.register(sourceRealm);
  const targetRegistration = bindings.register(targetRealm);
  const agentCluster = {};
  return {
    source: {
      agentCluster,
      interfaces: sourceRegistration.interfaces,
      realm: sourceRealm,
    },
    sourceRealm,
    target: {
      agentCluster,
      interfaces: targetRegistration.interfaces,
      realm: targetRealm,
    },
    targetRealm,
  };
}

function expectDataCloneError(steps: () => unknown): void {
  try {
    steps();
  } catch (error) {
    expect(getDOMExceptionRequest(error)).toEqual({
      message: '',
      name: 'DataCloneError',
    });
    return;
  }
  throw new Error('Expected a DataCloneError DOMException');
}
