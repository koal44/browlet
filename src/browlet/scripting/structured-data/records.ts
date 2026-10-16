import { InternalError } from '../../../infra/internal-error';
import type { BufferViewTypeName, StructuredData } from '../../../web-idl/index';

import type { AgentCluster } from '../agents';
import type { BrowletEnvironment } from '../../environment';

/** Serialized graph node; a null cluster means the value is unrestricted. */
export type SerializedRecord =
  | SerializedPrimitive
  | SerializedBoxedPrimitive
  | SerializedDate
  | SerializedRegExp
  | SerializedArrayBuffer
  | SerializedSharedArrayBuffer
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
  cluster: null;
};

export type SerializedBoxedPrimitive =
  | { type: 'Boolean'; value: boolean; cluster: AgentCluster | null; }
  | { type: 'Number'; value: number; cluster: AgentCluster | null; }
  | { type: 'BigInt'; value: bigint; cluster: AgentCluster | null; }
  | { type: 'String'; value: string; cluster: AgentCluster | null; };

export type SerializedDate = {
  type: 'Date';
  value: number;
  cluster: AgentCluster | null;
};

export type SerializedRegExp = {
  type: 'RegExp';
  source: string;
  flags: string;
  cluster: AgentCluster | null;
};

export type SerializedArrayBuffer = {
  type: 'ArrayBuffer' | 'ResizableArrayBuffer';
  bytes: Uint8Array;
  byteLength: number;
  /** Present only for resizable buffers. */
  maxByteLength?: number;
  cluster: AgentCluster | null;
};

export type SerializedSharedArrayBuffer = {
  type: 'SharedArrayBuffer' | 'GrowableSharedArrayBuffer';
  /** Host token for the inaccessible shared [[ArrayBufferData]] block. */
  buffer: SharedArrayBuffer;
  byteLength: number;
  /** Present only for growable buffers. */
  maxByteLength?: number;
  cluster: AgentCluster | null;
};

export type SerializedArrayBufferView = {
  type: 'ArrayBufferView';
  constructor: BufferViewTypeName;
  buffer: SerializedArrayBuffer | SerializedSharedArrayBuffer | SerializedTransferPlaceholder;
  byteLength: number | 'auto';
  byteOffset: number;
  arrayLength?: number | 'auto';
  cluster: AgentCluster | null;
};

export type SerializedMap = {
  type: 'Map';
  entries: SerializedMapEntry[];
  cluster: AgentCluster | null;
};

export type SerializedMapEntry = {
  key: SerializedRecord;
  value: SerializedRecord;
};

export type SerializedSet = {
  type: 'Set';
  entries: SerializedRecord[];
  cluster: AgentCluster | null;
};

export type SerializedError = {
  type: 'Error';
  name: SerializedErrorName;
  message: string | undefined;
  stack: string;
  cause?: SerializedRecord;
  cluster: AgentCluster | null;
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
  cluster: AgentCluster | null;
};

export type SerializedObject = {
  type: 'Object';
  properties: SerializedProperty[];
  cluster: AgentCluster | null;
};

export type SerializedProperty = {
  key: string;
  value: SerializedRecord;
};

export type SerializedPlatformObject = {
  type: 'platform-object';
  interfaceName: string;
  data: StructuredData;
  cluster: AgentCluster | null;
};

/** Graph reference whose value is supplied by transfer memory. */
export type SerializedTransferPlaceholder = {
  type: 'transfer-placeholder';
  cluster: AgentCluster | null;
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
  cluster: AgentCluster | null;
};

export type PlatformObjectTransferDataHolder = {
  type: 'platform-object';
  placeholder: SerializedTransferPlaceholder;
  interfaceName: string;
  data: StructuredData;
  cluster: AgentCluster | null;
};

export type StructuredSerializeWithTransferResult = {
  serialized: SerializedRecord;
  transferDataHolders: TransferDataHolder[];
  interfaceNames: Set<string>;
  cluster: AgentCluster | null;
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
export function restrictToSameAgentCluster(
  record: { cluster: AgentCluster | null; },
  env: BrowletEnvironment,
): void {
  const cluster = env.realm.agent.agentCluster;
  // An unassociated agent cannot supply a restriction: null would mean unrestricted.
  if (cluster === null) throw new InternalError('Realm agent has no agent cluster');
  record.cluster = cluster;
}
