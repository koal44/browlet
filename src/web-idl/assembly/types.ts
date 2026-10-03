import type { BufferTypeName, ExtendedAttribute } from '../core/index';

import type {
  AssembledCallbackFunction, AssembledCallbackInterface, AssembledDictionary, AssembledEnumeration,
  AssembledInterface, AssembledProxyObject,
} from './assembled';

/** Runtime type contract, with declaration names, annotations, and nested types resolved. */
export type IDLType =
  | IDLAnyType
  | IDLUndefinedType
  | IDLBooleanType
  | IDLBigIntType
  | IDLObjectType
  | IDLSymbolType
  | IDLIntegerType
  | IDLFloatType
  | IDLStringType
  | IDLBufferType
  | IDLNullableType
  | IDLUnionType
  | IDLSequenceType
  | IDLAsyncSequenceType
  | IDLFrozenArrayType
  | IDLObservableArrayType
  | IDLRecordType
  | IDLPromiseType
  | IDLInterfaceType
  | IDLDictionaryType
  | IDLEnumerationType
  | IDLCallbackFunctionType
  | IDLCallbackInterfaceType
  | IDLProxyType;

export interface IDLAnyType extends TypeAttributes {
  kind: 'any';
}

export interface IDLUndefinedType extends TypeAttributes {
  kind: 'undefined';
}

export interface IDLBooleanType extends TypeAttributes {
  kind: 'boolean';
}

export interface IDLBigIntType extends TypeAttributes {
  kind: 'bigint';
}

export interface IDLObjectType extends TypeAttributes {
  kind: 'object';
}

export interface IDLSymbolType extends TypeAttributes {
  kind: 'symbol';
}

export interface IDLIntegerType extends TypeAttributes {
  kind: 'integer';
  name: IntegerTypeName;
  /** Overflow and rounding behavior selected by this use's annotations. */
  integerMode: IntegerConversionMode;
}

export interface IDLFloatType extends TypeAttributes {
  kind: 'float';
  name: FloatTypeName;
}

export interface IDLStringType extends TypeAttributes {
  kind: 'string';
  name: 'DOMString' | 'ByteString' | 'USVString';
  /** Whether this string use converts null to the empty string. */
  nullToEmptyString: boolean;
}

export interface IDLBufferType extends TypeAttributes {
  kind: 'buffer-source';
  name: BufferTypeName;
  /** Whether this use accepts shared backing memory. */
  allowShared: boolean;
  /** Whether this use accepts resizable or growable backing memory. */
  allowResizable: boolean;
}

export interface IDLNullableType extends TypeAttributes {
  kind: 'nullable';
  /** Non-null branch, including annotations inherited from the nullable use. */
  innerType: IDLType;
}

export interface IDLUnionType extends TypeAttributes {
  kind: 'union';
  /** Branches in declaration order, including inherited conversion annotations. */
  memberTypes: IDLType[];
}

export interface IDLSequenceType extends TypeAttributes {
  kind: 'sequence';
  elementType: IDLType;
}

export interface IDLAsyncSequenceType extends TypeAttributes {
  kind: 'async-sequence';
  elementType: IDLType;
}

export interface IDLFrozenArrayType extends TypeAttributes {
  kind: 'frozen-array';
  elementType: IDLType;
}

export interface IDLObservableArrayType extends TypeAttributes {
  kind: 'observable-array';
  elementType: IDLType;
}

export interface IDLRecordType extends TypeAttributes {
  kind: 'record';
  keyType: IDLStringType;
  valueType: IDLType;
}

export interface IDLPromiseType extends TypeAttributes {
  kind: 'promise';
  resultType: IDLType;
}

export interface IDLInterfaceType extends TypeAttributes {
  kind: 'interface';
  assembled: AssembledInterface;
}

export interface IDLDictionaryType extends TypeAttributes {
  kind: 'dictionary';
  assembled: AssembledDictionary;
}

export interface IDLEnumerationType extends TypeAttributes {
  kind: 'enumeration';
  assembled: AssembledEnumeration;
}

export interface IDLCallbackFunctionType extends TypeAttributes {
  kind: 'callback-function';
  assembled: AssembledCallbackFunction;
}

export interface IDLCallbackInterfaceType extends TypeAttributes {
  kind: 'callback-interface';
  assembled: AssembledCallbackInterface;
}

export interface IDLProxyType extends TypeAttributes {
  kind: 'proxy-object';
  assembled: AssembledProxyObject;
}

/** Conversion annotations retained after assembly. */
type TypeAttributes = {
  /** Ordered annotations used for type comparison and diagnostics. */
  attributes: ExtendedAttribute[];
};

export type IntegerConversionMode = 'wrap' | 'clamp' | 'enforce-range';
export type IntegerTypeName = keyof typeof integerTypes;
type FloatTypeName = 'float' | 'unrestricted float' | 'double' | 'unrestricted double';

/** Integer widths and signs used by conversion and declaration-default validation. */
export const integerTypes = {
  byte: { bitLength: 8, signed: true },
  octet: { bitLength: 8, signed: false },
  short: { bitLength: 16, signed: true },
  'unsigned short': { bitLength: 16, signed: false },
  long: { bitLength: 32, signed: true },
  'unsigned long': { bitLength: 32, signed: false },
  'long long': { bitLength: 64, signed: true },
  'unsigned long long': { bitLength: 64, signed: false },
};

/** The unannotated any type used for internal promise and iterator results. */
export const anyType: IDLAnyType = { kind: 'any', attributes: [] };

/** The return contract for callables that do not produce a value. */
export const undefinedType: IDLUndefinedType = { kind: 'undefined', attributes: [] };
