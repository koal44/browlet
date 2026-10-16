import { InternalError } from '../../../infra/internal-error';
import {
  getArrayBufferMaxByteLength, getArrayBufferByteLength, isArrayBuffer,
  isArrayBufferView, isSharedArrayBuffer, isDetachedArrayBuffer, isObject,
} from '../../../js-engine/index';
import {
  DOMExceptionImpl, DOMExceptionNames, StructuredData,
  type BindingContext, type StampedImplInstance, type TransferSteps,
} from '../../../web-idl/index';

import type { BrowletEnvironment } from '../../environment';

import {
  restrictToSameAgentCluster,
  type PlatformObjectTransferDataHolder, type StructuredDeserializeWithTransferResult,
  type StructuredDeserializeMemory, type StructuredSerializeMemory,
  type StructuredSerializeWithTransferResult, type TransferDataHolder,
  type SerializedTransferPlaceholder,
} from './records';
import { structuredDeserialize } from './deserialize';
import { structuredSerializeInternal } from './serialize';
import { DetachedTransferableStamper } from './transferable';

// https://html.spec.whatwg.org/multipage/structured-data.html#dom-structuredclone
export function structuredClone(
  value: unknown,
  transferList: unknown[],
  ctx: BindingContext<BrowletEnvironment>,
): unknown {
  const serialized = structuredSerializeWithTransfer(value, transferList, ctx);
  return structuredDeserializeWithTransfer(serialized, ctx).deserialized;
}

// https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializewithtransfer
export function structuredSerializeWithTransfer(
  value: unknown,
  transferList: unknown[],
  ctx: BindingContext<BrowletEnvironment>,
): StructuredSerializeWithTransferResult {
  const memory: StructuredSerializeMemory = new Map();
  const preparedTransfers: PreparedTransfer[] = [];

  for (const valueToTransfer of transferList) {
    const prepared = prepareTransfer(valueToTransfer, ctx);
    const identity = prepared.kind === 'platform-object' ? prepared.implInst : prepared.value;
    if (memory.has(identity)) throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);
    memory.set(identity, prepared.placeholder);
    preparedTransfers.push(prepared);
  }

  const serialized = structuredSerializeInternal(
    value,
    false,
    ctx,
    memory,
  );
  const result: StructuredSerializeWithTransferResult = {
    serialized, transferDataHolders: [], interfaceNames: new Set(), cluster: null,
  };

  for (const prepared of preparedTransfers) {
    const dataHolder = performTransfer(prepared, ctx);
    result.transferDataHolders.push(dataHolder);
    if (dataHolder.type === 'platform-object') result.interfaceNames.add(dataHolder.interfaceName);
    if (dataHolder.cluster !== null) result.cluster = dataHolder.cluster;
  }

  // Transfer holders precede graph records in the specification's ordered memory.
  // Our graph keeps separate placeholders; the holders above supply their metadata.
  for (const record of memory.values()) {
    if (record.type === 'platform-object') result.interfaceNames.add(record.interfaceName);
    if (record.cluster !== null) result.cluster = record.cluster;
  }
  return result;
}

// https://html.spec.whatwg.org/multipage/structured-data.html#structureddeserializewithtransfer
export function structuredDeserializeWithTransfer(
  result: StructuredSerializeWithTransferResult,
  ctx: BindingContext<BrowletEnvironment>,
): StructuredDeserializeWithTransferResult {
  if (result.cluster !== null && result.cluster !== ctx.realm.agent.agentCluster) {
    throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);
  }
  for (const interfaceName of result.interfaceNames) {
    if (!ctx.isInterfaceExposed(interfaceName)) throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);
  }

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

// BINDING_INTEGRATION: resolve the source instance and its interface's transfer steps.
function prepareTransfer(
  value: unknown,
  ctx: BindingContext<BrowletEnvironment>,
): PreparedTransfer {
  if (!isObject(value)) throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);
  const placeholder: SerializedTransferPlaceholder = {
    type: 'transfer-placeholder',
    cluster: null,
  };
  if (isArrayBuffer(value)) {
    return {
      kind: 'ArrayBuffer',
      placeholder,
      value,
    };
  }
  if (isSharedArrayBuffer(value) || isArrayBufferView(value)) throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);

  const record = ctx.getObjectRecord(value);
  if (!record) throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);
  const steps = record.assembled.transferSteps;
  if (!steps) throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);
  return {
    kind: 'platform-object',
    implInst: record.implInst,
    interfaceName: record.assembled.name,
    placeholder,
    steps,
    sameAgentCluster: record.assembled.hasExtendedAttribute('SameAgentCluster', false),
  };
}

function performTransfer(
  prepared: PreparedTransfer,
  ctx: BindingContext<BrowletEnvironment>,
): TransferDataHolder {
  if (prepared.kind === 'ArrayBuffer') {
    if (isDetachedArrayBuffer(prepared.value)) throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);
    const byteLength = getArrayBufferByteLength(prepared.value);
    const maxByteLength = getArrayBufferMaxByteLength(prepared.value);
    return {
      type: maxByteLength === undefined
        ? 'ArrayBuffer'
        : 'ResizableArrayBuffer',
      placeholder: prepared.placeholder,
      buffer: ctx.realm.transferArrayBuffer(prepared.value),
      byteLength,
      ...(maxByteLength === undefined ? {} : { maxByteLength }),
      cluster: null,
    };
  }

  if (DetachedTransferableStamper.has(prepared.implInst)) {
    throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);
  }
  const dataHolder: PlatformObjectTransferDataHolder = {
    type: 'platform-object',
    placeholder: prepared.placeholder,
    interfaceName: prepared.interfaceName,
    data: new StructuredData(),
    cluster: null,
  };
  dataHolder.data.shouldRestrict = prepared.sameAgentCluster;
  if (dataHolder.data.shouldRestrict) restrictToSameAgentCluster(dataHolder, ctx.getEnvironment());
  prepared.steps.transferSteps(prepared.implInst, dataHolder.data);
  if (dataHolder.data.shouldRestrict && dataHolder.cluster === null) {
    restrictToSameAgentCluster(dataHolder, ctx.getEnvironment());
  }
  DetachedTransferableStamper.stamp(prepared.implInst);
  return dataHolder;
}

// BINDING_INTEGRATION: construct and initialize the destination platform object.
function receiveTransfer(
  dataHolder: TransferDataHolder,
  ctx: BindingContext<BrowletEnvironment>,
): unknown {
  if (dataHolder.type === 'platform-object') {
    const platformRecord = ctx.createPlatformRecord(dataHolder.interfaceName);
    if (!platformRecord) throw new DOMExceptionImpl('', DOMExceptionNames.dataClone);
    const steps = platformRecord.assembled.transferSteps;
    if (!steps) {
      throw new InternalError(
        `${platformRecord.assembled.name} has no transfer steps`,
      );
    }
    steps.transferReceivingSteps(
      dataHolder.data,
      platformRecord.implInst,
    );
    return platformRecord.platformObject;
  }

  const value = ctx.realm.transferArrayBuffer(dataHolder.buffer);
  if (
    getArrayBufferByteLength(value) !== dataHolder.byteLength ||
    getArrayBufferMaxByteLength(value) !== dataHolder.maxByteLength
  ) {
    throw new InternalError('Received ArrayBuffer does not match its data holder');
  }
  return value;
}

type PreparedTransfer = PreparedArrayBufferTransfer | PreparedPlatformTransfer;

type PreparedArrayBufferTransfer = {
  kind: 'ArrayBuffer';
  placeholder: SerializedTransferPlaceholder;
  value: ArrayBuffer;
};

type PreparedPlatformTransfer = {
  kind: 'platform-object';
  implInst: StampedImplInstance;
  interfaceName: string;
  placeholder: SerializedTransferPlaceholder;
  steps: TransferSteps;
  sameAgentCluster: boolean;
};
