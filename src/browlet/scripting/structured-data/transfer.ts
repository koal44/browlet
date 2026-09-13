import {
  getArrayBufferMaxByteLength, getBufferSourceByteLength, getBufferTypeName,
  isBufferSourceDetached, isObject,
} from '../../../js-engine/index';
import { throwDOMException, type BindingContext } from '../../../web-idl/index';
import type { Realm } from '../realm';
import {
  createStructuredDataRecord, type StructuredDeserializeWithTransferResult,
  type StructuredDeserializeMemory, type StructuredSerializeMemory,
  type StructuredSerializeWithTransferResult, type TransferDataHolder,
  type TransferPlaceholderSerializedRecord,
} from './records';
import { structuredDeserialize } from './deserialize';
import { structuredSerializeInternal } from './serialize';
import {
  isTransferableDetached, markTransferableDetached, transferable,
  type TransferableSteps,
} from './transferable';

/** HTML §2.7.7, StructuredSerializeWithTransfer. */
export function structuredSerializeWithTransfer(
  value: unknown,
  transferList: readonly unknown[],
  ctx: BindingContext<Realm>,
): StructuredSerializeWithTransferResult {
  const memory: StructuredSerializeMemory = new Map();
  const preparedTransfers: PreparedTransfer[] = [];

  for (const valueToTransfer of transferList) {
    const prepared = prepareTransfer(valueToTransfer, ctx);
    if (memory.has(valueToTransfer)) return throwDOMException('DataCloneError');
    memory.set(valueToTransfer, prepared.placeholder);
    preparedTransfers.push(prepared);
  }

  const serialized = structuredSerializeInternal(
    value,
    false,
    ctx,
    memory,
  );
  const transferDataHolders: TransferDataHolder[] = [];

  for (const prepared of preparedTransfers) {
    transferDataHolders.push(performTransfer(prepared, ctx));
  }

  return { serialized, transferDataHolders };
}

/** HTML §2.7.8, StructuredDeserializeWithTransfer. */
export function structuredDeserializeWithTransfer(
  result: StructuredSerializeWithTransferResult,
  ctx: BindingContext<Realm>,
): StructuredDeserializeWithTransferResult {
  const memory: StructuredDeserializeMemory = new Map();
  const transferredValues: unknown[] = [];

  for (const dataHolder of result.transferDataHolders) {
    const value = receiveTransfer(dataHolder, ctx);
    memory.set(dataHolder.placeholder, value);
    transferredValues.push(value);
  }

  return {
    deserialized: structuredDeserialize(
      result.serialized,
      ctx,
      memory,
    ),
    transferredValues,
  };
}

// BINDING_INTEGRATION: resolve the source platform object and its transferable capability.
function prepareTransfer(
  value: unknown,
  ctx: BindingContext<Realm>,
): PreparedTransfer {
  if (!isObject(value)) return throwDOMException('DataCloneError');
  const bufferType = getBufferTypeName(value);
  const placeholder: TransferPlaceholderSerializedRecord = {
    type: 'transfer-placeholder',
  };
  if (bufferType === 'ArrayBuffer') {
    return { kind: 'ArrayBuffer', placeholder, value: value as ArrayBuffer };
  }
  if (bufferType === 'SharedArrayBuffer') return throwDOMException('DataCloneError');
  if (bufferType !== undefined) return throwDOMException('DataCloneError');

  const platformObject = ctx.getObjectRecord(value);
  if (!platformObject) return throwDOMException('DataCloneError');
  const steps = ctx.getCapability(
    platformObject.primaryInterface.definition,
    transferable,
  );
  if (!steps) return throwDOMException('DataCloneError');
  return {
    implementation: platformObject.implementation,
    interfaceName: platformObject.primaryInterface.definition.name,
    kind: 'platform-object',
    placeholder,
    steps,
  };
}

function performTransfer(
  prepared: PreparedTransfer,
  ctx: BindingContext<Realm>,
): TransferDataHolder {
  if (prepared.kind === 'ArrayBuffer') {
    if (isBufferSourceDetached(prepared.value)) return throwDOMException('DataCloneError');
    const byteLength = getBufferSourceByteLength(prepared.value);
    const maxByteLength = getArrayBufferMaxByteLength(prepared.value);
    return {
      type: maxByteLength === undefined
        ? 'ArrayBuffer'
        : 'ResizableArrayBuffer',
      placeholder: prepared.placeholder,
      buffer: ctx.realm.transferArrayBuffer(prepared.value),
      byteLength,
      ...(maxByteLength === undefined ? {} : { maxByteLength }),
    };
  }

  if (isTransferableDetached(prepared.implementation)) {
    return throwDOMException('DataCloneError');
  }
  const fields = createStructuredDataRecord();
  prepared.steps.transferSteps(prepared.implementation, fields);
  markTransferableDetached(prepared.implementation);
  return {
    type: 'platform-object',
    placeholder: prepared.placeholder,
    interfaceName: prepared.interfaceName,
    fields,
  };
}

// BINDING_INTEGRATION: construct and initialize the destination platform object.
function receiveTransfer(
  dataHolder: TransferDataHolder,
  ctx: BindingContext<Realm>,
): unknown {
  if (dataHolder.type === 'platform-object') {
    const interface_ = ctx.getInterface(
      dataHolder.interfaceName,
    );
    if (!interface_ || !ctx.isInterfaceExposed(interface_)) {
      return throwDOMException('DataCloneError');
    }
    const platformObject = ctx.createPlatformObject(interface_);
    const steps = ctx.getCapability(
      platformObject.primaryInterface.definition,
      transferable,
    );
    if (!steps) {
      throw new Error(
        `${platformObject.primaryInterface.definition.name} has no Transferable capability`,
      );
    }
    steps.transferReceivingSteps(
      dataHolder.fields,
      platformObject.implementation,
    );
    return platformObject.platformObject;
  }

  const value = ctx.realm.transferArrayBuffer(dataHolder.buffer);
  if (
    getBufferSourceByteLength(value) !== dataHolder.byteLength ||
    getArrayBufferMaxByteLength(value) !== dataHolder.maxByteLength
  ) {
    throw new Error('Received ArrayBuffer does not match its data holder');
  }
  return value;
}

type PreparedTransfer = PreparedArrayBufferTransfer | PreparedPlatformTransfer;

type PreparedArrayBufferTransfer = {
  kind: 'ArrayBuffer';
  placeholder: TransferPlaceholderSerializedRecord;
  value: ArrayBuffer;
};

type PreparedPlatformTransfer = {
  implementation: object;
  interfaceName: string;
  kind: 'platform-object';
  placeholder: TransferPlaceholderSerializedRecord;
  steps: TransferableSteps;
};
