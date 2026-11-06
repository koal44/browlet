import { InternalError } from '../../../infra/index';
import type { JSWasmModule } from '../../../js-engine/index';
import type { BufferViewTypeName, StructuredData } from '../../../web-idl/core/index';

import type { BrowletEnvironment } from '../../environment/index';

/** Serialized graph node; a null cluster ID means the value is unrestricted. */
// Store the existing cluster identity, not its isolate-local AgentCluster object.
// This keeps the restriction portable without retaining agents, realms, or tasks.
export type SerializedRecord =
  | SerializedPrimitive
  | SerializedBoxedPrimitive
  | SerializedDate
  | SerializedRegExp
  | SerializedArrayBuffer
  | SerializedSharedArrayBuffer
  | SerializedWasmModule
  | SerializedArrayBufferView
  | SerializedMap
  | SerializedSet
  | SerializedError
  | SerializedArray
  | SerializedObject
  | SerializedPlatformObject
  | SerializedTransferPlaceholder;

// Stamped instances use their implementation identity, including transfer placeholders.
export type StructuredSerializeMemory = Map<unknown, SerializedRecord>;
export type StructuredDeserializeMemory = Map<SerializedRecord, unknown>;

export type SerializedPrimitive = {
  type: 'primitive';
  value: undefined | null | boolean | number | bigint | string;
  agentClusterId: null;
};

export type SerializedBoxedPrimitive =
  | { type: 'Boolean'; value: boolean; agentClusterId: string | null; }
  | { type: 'Number'; value: number; agentClusterId: string | null; }
  | { type: 'BigInt'; value: bigint; agentClusterId: string | null; }
  | { type: 'String'; value: string; agentClusterId: string | null; };

export type SerializedDate = {
  type: 'Date';
  value: number;
  agentClusterId: string | null;
};

export type SerializedRegExp = {
  type: 'RegExp';
  source: string;
  flags: string;
  agentClusterId: string | null;
};

export type SerializedArrayBuffer = {
  type: 'ArrayBuffer' | 'ResizableArrayBuffer';
  bytes: Uint8Array;
  byteLength: number;
  /** Present only for resizable buffers. */
  maxByteLength?: number;
  agentClusterId: string | null;
};

export type SerializedSharedArrayBuffer = {
  type: 'SharedArrayBuffer' | 'GrowableSharedArrayBuffer';
  /** Host token for the inaccessible shared [[ArrayBufferData]] block. */
  buffer: SharedArrayBuffer;
  byteLength: number;
  /** Present only for growable buffers. */
  maxByteLength?: number;
  agentClusterId: string | null;
};

export type SerializedArrayBufferView = {
  type: 'ArrayBufferView';
  constructor: BufferViewTypeName;
  buffer: SerializedArrayBuffer | SerializedSharedArrayBuffer | SerializedTransferPlaceholder;
  byteLength: number | 'auto';
  byteOffset: number;
  arrayLength?: number | 'auto';
  agentClusterId: string | null;
};

/** Native compiled-code token; author properties and the original Module identity are not retained. */
export type SerializedWasmModule = {
  type: 'WebAssembly.Module';
  module: JSWasmModule;
  agentClusterId: string | null;
};

export type SerializedMap = {
  type: 'Map';
  entries: SerializedMapEntry[];
  agentClusterId: string | null;
};

export type SerializedMapEntry = {
  key: SerializedRecord;
  value: SerializedRecord;
};

export type SerializedSet = {
  type: 'Set';
  entries: SerializedRecord[];
  agentClusterId: string | null;
};

export type SerializedError = {
  type: 'Error';
  name: SerializedErrorName;
  message: string | undefined;
  stack: string;
  cause?: SerializedRecord;
  agentClusterId: string | null;
};

export type SerializedErrorName = typeof serializedErrorNames[number];

export function isSerializedErrorName(
  value: unknown,
): value is SerializedErrorName {
  return serializedErrorNames.some((name) => name === value);
}

export type SerializedArray = {
  type: 'Array';
  length: number;
  properties: SerializedProperty[];
  agentClusterId: string | null;
};

export type SerializedObject = {
  type: 'Object';
  properties: SerializedProperty[];
  agentClusterId: string | null;
};

export type SerializedProperty = {
  key: string;
  value: SerializedRecord;
};

export type SerializedPlatformObject = {
  type: 'platform-object';
  interfaceName: string;
  data: StructuredData;
  agentClusterId: string | null;
};

/** Graph reference whose value is supplied by transfer memory. */
export type SerializedTransferPlaceholder = {
  type: 'transfer-placeholder';
  agentClusterId: string | null;
};

export type TransferDataHolder =
  | ArrayBufferTransferDataHolder
  | PlatformObjectTransferDataHolder;

export type ArrayBufferTransferDataHolder = {
  type: 'ArrayBuffer' | 'ResizableArrayBuffer';
  placeholder: SerializedTransferPlaceholder;
  buffer: ArrayBuffer;
  byteLength: number;
  /** Present only for resizable buffers. */
  maxByteLength?: number;
  agentClusterId: string | null;
};

export type PlatformObjectTransferDataHolder = {
  type: 'platform-object';
  placeholder: SerializedTransferPlaceholder;
  interfaceName: string;
  data: StructuredData;
  agentClusterId: string | null;
};

export type StructuredSerializeWithTransferResult = {
  serialized: SerializedRecord;
  transferDataHolders: TransferDataHolder[];
  interfaceNames: Set<string>;
  agentClusterId: string | null;
};

export type StructuredDeserializeWithTransferResult = {
  deserialized: unknown;
  transferredValues: unknown[];
};

const serializedErrorNames = [
  'Error', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError',
  'TypeError', 'URIError',
] as const;

// https://html.spec.whatwg.org/multipage/structured-data.html#restrict-to-the-same-agent-cluster
// Represent the cluster by its existing ID; each isolate keeps its own members.
export function restrictToSameAgentCluster(
  record: { agentClusterId: string | null; },
  env: BrowletEnvironment,
): void {
  const cluster = env.realm.agent.agentCluster;
  // An unassociated agent cannot supply a restriction: null would mean unrestricted.
  if (cluster === null) throw new InternalError('Realm agent has no agent cluster');
  record.agentClusterId = cluster.id;
}
