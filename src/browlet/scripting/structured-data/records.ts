import type { BufferViewTypeName } from '../../../web-idl/index';

/**
 * Open fields owned by one interface's Serializable capability.
 *
 * The outer structured-data record family is closed below; only an interface
 * specification knows the fields that its own platform record contributes.
 */
export type StructuredDataRecord = Map<string, unknown>;

export function createStructuredDataRecord(): StructuredDataRecord {
  return new Map();
}

export type SerializedRecord =
  | PrimitiveSerializedRecord
  | BoxedPrimitiveSerializedRecord
  | DateSerializedRecord
  | RegExpSerializedRecord
  | ArrayBufferSerializedRecord
  | SharedArrayBufferSerializedRecord
  | ArrayBufferViewSerializedRecord
  | MapSerializedRecord
  | SetSerializedRecord
  | ErrorSerializedRecord
  | ArraySerializedRecord
  | ObjectSerializedRecord
  | PlatformObjectSerializedRecord
  | TransferPlaceholderSerializedRecord;

// Stamped instances use their implementation identity, including transfer placeholders.
export type StructuredSerializeMemory = Map<unknown, SerializedRecord>;
export type StructuredDeserializeMemory = Map<SerializedRecord, unknown>;

export type PrimitiveSerializedRecord = {
  type: 'primitive';
  value: undefined | null | boolean | number | bigint | string;
};

export type BoxedPrimitiveSerializedRecord =
  | { type: 'Boolean'; value: boolean; }
  | { type: 'Number'; value: number; }
  | { type: 'BigInt'; value: bigint; }
  | { type: 'String'; value: string; };

export type DateSerializedRecord = {
  type: 'Date';
  value: number;
};

export type RegExpSerializedRecord = {
  type: 'RegExp';
  source: string;
  flags: string;
};

export type ArrayBufferSerializedRecord = {
  type: 'ArrayBuffer' | 'ResizableArrayBuffer';
  bytes: Uint8Array;
  byteLength: number;
  maxByteLength?: number;
};

export type SharedArrayBufferSerializedRecord = {
  type: 'SharedArrayBuffer' | 'GrowableSharedArrayBuffer';
  /** Host token for the inaccessible shared [[ArrayBufferData]] block. */
  buffer: object;
  byteLength: number;
  maxByteLength?: number;
  agentCluster: object;
};

export type ArrayBufferViewSerializedRecord = {
  type: 'ArrayBufferView';
  constructor: BufferViewTypeName;
  buffer: ArrayBufferSerializedRecord | SharedArrayBufferSerializedRecord |
    TransferPlaceholderSerializedRecord;
  byteLength: number | 'auto';
  byteOffset: number;
  arrayLength?: number | 'auto';
};

export type MapSerializedRecord = {
  type: 'Map';
  entries: SerializedMapEntry[];
};

export type SerializedMapEntry = {
  key: SerializedRecord;
  value: SerializedRecord;
};

export type SetSerializedRecord = {
  type: 'Set';
  entries: SerializedRecord[];
};

export type ErrorSerializedRecord = {
  type: 'Error';
  name: SerializedErrorName;
  message: string | undefined;
  stack: string;
  cause?: SerializedRecord;
};

export type SerializedErrorName = typeof serializedErrorNames[number];

export function isSerializedErrorName(
  value: unknown,
): value is SerializedErrorName {
  return serializedErrorNames.some((name) => name === value);
}

export type ArraySerializedRecord = {
  type: 'Array';
  length: number;
  properties: SerializedProperty[];
};

export type ObjectSerializedRecord = {
  type: 'Object';
  properties: SerializedProperty[];
};

export type SerializedProperty = {
  key: string;
  value: SerializedRecord;
};

export type PlatformObjectSerializedRecord = {
  type: 'platform-object';
  interfaceName: string;
  fields: StructuredDataRecord;
};

/** Graph reference whose value is supplied by §2.7.8 transfer memory. */
export type TransferPlaceholderSerializedRecord = {
  type: 'transfer-placeholder';
};

export type TransferDataHolder =
  | ArrayBufferTransferDataHolder
  | PlatformObjectTransferDataHolder;

export type ArrayBufferTransferDataHolder = {
  type: 'ArrayBuffer' | 'ResizableArrayBuffer';
  placeholder: TransferPlaceholderSerializedRecord;
  buffer: ArrayBuffer;
  byteLength: number;
  maxByteLength?: number;
};

export type PlatformObjectTransferDataHolder = {
  type: 'platform-object';
  placeholder: TransferPlaceholderSerializedRecord;
  interfaceName: string;
  fields: StructuredDataRecord;
};

export type StructuredSerializeWithTransferResult = {
  serialized: SerializedRecord;
  transferDataHolders: TransferDataHolder[];
};

export type StructuredDeserializeWithTransferResult = {
  deserialized: unknown;
  transferredValues: unknown[];
};

const serializedErrorNames = [
  'Error', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError',
  'TypeError', 'URIError',
] as const;
