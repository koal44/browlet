import { assertNever } from '../../infra/index';
import type { BufferTypeName, ExtendedAttribute } from '../core/index';

import type { AssembledInterface } from './interface';
import type { AssembledCallbackFunction, AssembledCallbackInterface } from './callback';
import type { AssembledDictionary } from './dictionary';
import type { AssembledEnumeration } from './enumeration';
import type { AssembledProxyObject } from './proxy-object';

/** Runtime type contract, with declaration names, annotations, and nested types resolved. */
export type IDLType =
  | IDLAnyType | IDLUndefinedType | IDLBooleanType | IDLBigIntType | IDLObjectType | IDLSymbolType
  | IDLIntegerType | IDLFloatType | IDLStringType | IDLBufferType | IDLNullableType | IDLUnionType
  | IDLSequenceType | IDLAsyncSequenceType | IDLFrozenArrayType | IDLObservableArrayType
  | IDLRecordType | IDLPromiseType | IDLInterfaceType | IDLDictionaryType | IDLEnumerationType
  | IDLCallbackFunctionType | IDLCallbackInterfaceType | IDLProxyType;

/** Facts shared by a runtime type across every binding and realm. */
abstract class Type {
  abstract kind: IDLType['kind'];
  /** Ordered annotations used for type comparison and diagnostics. */
  attributes: ExtendedAttribute[];
  /** Whether every branch produces a primitive IDL value, including null and enumeration strings. */
  isPrimitive = false;
  /** Whether IDL values need no further conversion for implementation use, absent binding overrides. */
  canPassToImpl = false;
  /** Branch selections prepared only when conversion or overload resolution needs them. */
  #candidates?: IDLTypeCandidates;
  /** Comparison key that ignores annotations and preserves union order. */
  #overloadKey?: string;
  /** Comparison key that includes annotations and ignores union order. */
  #conversionKey?: string;
  /** Completed JSON classification, evaluated only after member assembly has finished. */
  #jsonType?: boolean;

  constructor(attributes: ExtendedAttribute[] = []) {
    this.attributes = attributes;
  }

  /** Flattened branches and their categories; container contents retain their own candidates. */
  get candidates(): IDLTypeCandidates {
    return this.#candidates ??= new IDLTypeCandidates(this as IDLType);
  }

  /** Compare overload types without conversion annotations. */
  get overloadKey(): string {
    if (this.#overloadKey !== undefined) return this.#overloadKey;
    const type = this as IDLType;
    let key: string;
    switch (type.kind) {
      case 'any': case 'undefined': case 'boolean': case 'bigint': case 'object': case 'symbol':
        key = type.kind;
        break;
      case 'integer': case 'float': case 'string': case 'buffer-source':
        key = type.name;
        break;
      case 'interface': case 'dictionary': case 'enumeration': case 'callback-function':
      case 'callback-interface': case 'proxy-object':
        key = `reference:${type.assembled.primary.name}`;
        break;
      case 'nullable': key = `${type.innerType.overloadKey}?`; break;
      case 'union': key = `(${type.memberTypes.map((member) => member.overloadKey).join(' or ')})`; break;
      case 'sequence': case 'async-sequence': case 'frozen-array': case 'observable-array':
        key = `${type.kind}<${type.elementType.overloadKey}>`;
        break;
      case 'promise': key = `promise<${type.resultType.overloadKey}>`; break;
      case 'record': key = `record<${type.keyType.overloadKey}, ${type.valueType.overloadKey}>`; break;
    }
    return this.#overloadKey = key;
  }

  /** Compare conversion contracts, including annotations and nested types. */
  get conversionKey(): string {
    if (this.#conversionKey !== undefined) return this.#conversionKey;
    const type = this as IDLType;
    let parts: string[];
    switch (type.kind) {
      case 'any': case 'undefined': case 'boolean': case 'bigint': case 'object': case 'symbol':
        parts = [];
        break;
      case 'integer': case 'float': case 'string': case 'buffer-source': parts = [type.name]; break;
      case 'interface': case 'dictionary': case 'enumeration': case 'callback-function':
      case 'callback-interface': case 'proxy-object': parts = [type.assembled.primary.name]; break;
      case 'union': parts = type.memberTypes.map((member) => member.conversionKey).sort(); break;
      case 'record': parts = [type.keyType.conversionKey, type.valueType.conversionKey]; break;
      case 'nullable': parts = [type.innerType.conversionKey]; break;
      case 'promise': parts = [type.resultType.conversionKey]; break;
      default: parts = [type.elementType.conversionKey];
    }
    return this.#conversionKey = JSON.stringify([
      type.kind, parts, type.attributes.map((attribute) => JSON.stringify(attribute)).sort(),
    ]);
  }

  /** Whether values of this type can contribute to a default toJSON operation. */
  // https://webidl.spec.whatwg.org/#dfn-json-types
  get isJSON(): boolean {
    return this.#jsonType ??= this.#checkJSONType(new Set());
  }

  // Recursive answers depend on the current dictionary path; only the root getter caches its result.
  #checkJSONType(seen: Set<AssembledDictionary>): boolean {
    const type = this as IDLType;
    switch (type.kind) {
      case 'integer': case 'float': case 'string': case 'boolean': case 'object': case 'enumeration':
        return true;
      case 'nullable': return type.innerType.#checkJSONType(seen);
      case 'sequence': case 'frozen-array': return type.elementType.#checkJSONType(seen);
      case 'union': return type.memberTypes.every((member) => member.#checkJSONType(seen));
      case 'record': return type.valueType.#checkJSONType(seen);
      case 'interface': return type.assembled.hasToJSON();
      case 'dictionary': {
        if (seen.has(type.assembled)) return false;
        const path = new Set(seen).add(type.assembled);
        return type.assembled.members.every((member) => member.type.#checkJSONType(path));
      }
      default: return false;
    }
  }
}

/** Primitive IDL representations already have their implementation representation. */
abstract class PrimitiveType extends Type {
  override isPrimitive = true;
  override canPassToImpl = true;
}

export class IDLAnyType extends Type {
  kind = 'any' as const;
  override canPassToImpl = true;
}

export class IDLUndefinedType extends PrimitiveType {
  kind = 'undefined' as const;
}

export class IDLBooleanType extends PrimitiveType {
  kind = 'boolean' as const;
}

export class IDLBigIntType extends PrimitiveType {
  kind = 'bigint' as const;
}

export class IDLObjectType extends Type {
  kind = 'object' as const;
  override canPassToImpl = true;
}

export class IDLSymbolType extends PrimitiveType {
  kind = 'symbol' as const;
}

export class IDLIntegerType extends PrimitiveType {
  kind = 'integer' as const;
  name: IntegerTypeName;
  /** Width, signedness, and conversion bounds shared by every use of this integer name. */
  format: IntegerFormat;
  /** Overflow and rounding behavior selected by this use's annotations. */
  integerMode: IntegerConversionMode;

  constructor(name: IntegerTypeName, integerMode: IntegerConversionMode, attributes: ExtendedAttribute[] = []) {
    super(attributes);
    this.name = name;
    this.format = integerTypes[name];
    this.integerMode = integerMode;
  }
}

export class IDLFloatType extends PrimitiveType {
  kind = 'float' as const;
  name: FloatTypeName;

  constructor(name: FloatTypeName, attributes: ExtendedAttribute[] = []) {
    super(attributes);
    this.name = name;
  }
}

export class IDLStringType extends PrimitiveType {
  kind = 'string' as const;
  name: 'DOMString' | 'ByteString' | 'USVString';
  /** Whether this string use converts null to the empty string. */
  nullToEmptyString: boolean;

  constructor(name: IDLStringType['name'], nullToEmptyString: boolean, attributes: ExtendedAttribute[] = []) {
    super(attributes);
    this.name = name;
    this.nullToEmptyString = nullToEmptyString;
  }
}

export class IDLBufferType extends Type {
  kind = 'buffer-source' as const;
  override canPassToImpl = true;
  name: BufferTypeName;
  /** Whether values are views whose sharing and resizing rules apply to their backing buffer. */
  isView: boolean;
  /** Whether this use accepts shared backing memory. */
  allowShared: boolean;
  /** Whether this use accepts resizable or growable backing memory. */
  allowResizable: boolean;

  constructor(name: BufferTypeName, allowShared: boolean, allowResizable: boolean, attributes: ExtendedAttribute[] = []) {
    super(attributes);
    this.name = name;
    this.isView = name !== 'ArrayBuffer' && name !== 'SharedArrayBuffer';
    this.allowShared = allowShared;
    this.allowResizable = allowResizable;
  }
}

export class IDLNullableType<Inner extends IDLType = IDLType> extends Type {
  kind = 'nullable' as const;
  /** Non-null branch, including annotations inherited from the nullable use. */
  innerType: Inner;
  /** Callback declaration whose nullable attribute uses the legacy non-object-to-null rule. */
  legacyCallback: AssembledCallbackFunction | null;

  constructor(innerType: Inner, attributes: ExtendedAttribute[] = []) {
    super(attributes);
    this.innerType = innerType;
    this.isPrimitive = innerType.isPrimitive;
    this.canPassToImpl = innerType.canPassToImpl;
    this.legacyCallback = innerType.kind === 'callback-function' && innerType.assembled.treatsNonObjectAsNull
      ? innerType.assembled : null;
  }
}

export class IDLUnionType<Member extends IDLType = IDLType> extends Type {
  kind = 'union' as const;
  /** Branches in declaration order, including inherited conversion annotations. */
  memberTypes: Member[];

  constructor(memberTypes: Member[], attributes: ExtendedAttribute[] = []) {
    super(attributes);
    this.memberTypes = memberTypes;
    this.isPrimitive = memberTypes.every((member) => member.isPrimitive);
    this.canPassToImpl = memberTypes.every((member) => member.canPassToImpl);
  }
}

export class IDLSequenceType<Element extends IDLType = IDLType> extends Type {
  kind = 'sequence' as const;
  elementType: Element;

  constructor(elementType: Element, attributes: ExtendedAttribute[] = []) {
    super(attributes);
    this.elementType = elementType;
    this.canPassToImpl = elementType.canPassToImpl;
  }
}

export class IDLAsyncSequenceType<Element extends IDLType = IDLType> extends Type {
  kind = 'async-sequence' as const;
  elementType: Element;

  constructor(elementType: Element, attributes: ExtendedAttribute[] = []) {
    super(attributes);
    this.elementType = elementType;
  }
}

export class IDLFrozenArrayType<Element extends IDLType = IDLType> extends Type {
  kind = 'frozen-array' as const;
  // JS-to-IDL conversion has already projected and frozen the element array.
  override canPassToImpl = true;
  elementType: Element;

  constructor(elementType: Element, attributes: ExtendedAttribute[] = []) {
    super(attributes);
    this.elementType = elementType;
  }
}

export class IDLObservableArrayType<Element extends IDLType = IDLType> extends Type {
  kind = 'observable-array' as const;
  elementType: Element;

  constructor(elementType: Element, attributes: ExtendedAttribute[] = []) {
    super(attributes);
    this.elementType = elementType;
  }
}

export class IDLRecordType<Value extends IDLType = IDLType> extends Type {
  kind = 'record' as const;
  keyType: IDLStringType;
  valueType: Value;

  constructor(keyType: IDLStringType, valueType: Value, attributes: ExtendedAttribute[] = []) {
    super(attributes);
    this.keyType = keyType;
    this.valueType = valueType;
  }
}

export class IDLPromiseType<Result extends IDLType = IDLType> extends Type {
  kind = 'promise' as const;
  resultType: Result;

  constructor(resultType: Result, attributes: ExtendedAttribute[] = []) {
    super(attributes);
    this.resultType = resultType;
  }
}

export class IDLInterfaceType extends Type {
  kind = 'interface' as const;
  // JS-to-IDL conversion has already unwrapped the platform object.
  override canPassToImpl = true;
  assembled: AssembledInterface;

  constructor(assembled: AssembledInterface, attributes: ExtendedAttribute[] = []) {
    super(attributes);
    this.assembled = assembled;
  }
}

export class IDLDictionaryType extends Type {
  kind = 'dictionary' as const;
  assembled: AssembledDictionary;

  constructor(assembled: AssembledDictionary, attributes: ExtendedAttribute[] = []) {
    super(attributes);
    this.assembled = assembled;
  }
}

export class IDLEnumerationType extends PrimitiveType {
  kind = 'enumeration' as const;
  assembled: AssembledEnumeration;

  constructor(assembled: AssembledEnumeration, attributes: ExtendedAttribute[] = []) {
    super(attributes);
    this.assembled = assembled;
  }
}

export class IDLCallbackFunctionType extends Type {
  kind = 'callback-function' as const;
  assembled: AssembledCallbackFunction;

  constructor(assembled: AssembledCallbackFunction, attributes: ExtendedAttribute[] = []) {
    super(attributes);
    this.assembled = assembled;
  }
}

export class IDLCallbackInterfaceType extends Type {
  kind = 'callback-interface' as const;
  assembled: AssembledCallbackInterface;

  constructor(assembled: AssembledCallbackInterface, attributes: ExtendedAttribute[] = []) {
    super(attributes);
    this.assembled = assembled;
    this.canPassToImpl = !assembled.primary.toImpl;
  }
}

export class IDLProxyType extends Type {
  kind = 'proxy-object' as const;
  override canPassToImpl = true;
  assembled: AssembledProxyObject;

  constructor(assembled: AssembledProxyObject, attributes: ExtendedAttribute[] = []) {
    super(attributes);
    this.assembled = assembled;
  }
}

/** Branches used by union conversion and overload selection, retaining their exact type contracts. */
export class IDLTypeCandidates {
  /** Branches in declaration order, with nullable wrappers and nested unions removed. */
  types: FlattenedIDLType[] = [];
  /** Buffer branches indexed by their required engine buffer name. */
  buffers = new Map<BufferTypeName, IDLBufferType>();
  /** Interface and proxy branches that can recognize platform objects. */
  interfaces: UnionInterfaceCandidate[] = [];
  /** Presence flags for branches whose selection does not need additional type rules. */
  hasAny = false;
  hasBoolean = false;
  hasBigInt = false;
  hasSymbol = false;
  hasObject = false;
  hasUndefined = false;
  /** Whether a buffer branch accepts an ArrayBuffer or SharedArrayBuffer rather than a view. */
  hasArrayBuffer = false;
  /** Whether the type includes null through a nullable wrapper or branch. */
  hasNullable: boolean;
  /** Nullable wrappers encountered while flattening branches, excluding container contents. */
  nullableMemberCount: number;
  /** First numeric branch, excluding bigint, used by union conversion. */
  numeric: IDLIntegerType | IDLFloatType | undefined;
  /** The sole numeric or bigint branch, when an integer default has an unambiguous target. */
  soleNumeric: IDLIntegerType | IDLFloatType | IDLBigIntType | undefined;
  /** First string or enumeration branch. */
  string: IDLStringType | IDLEnumerationType | undefined;
  /** First sequence or frozen-array branch. */
  array: IDLSequenceType | IDLFrozenArrayType | undefined;
  /** First branch of each container or named conversion category. */
  sequence: IDLSequenceType | undefined;
  frozenArray: IDLFrozenArrayType | undefined;
  asyncSequence: IDLAsyncSequenceType | undefined;
  record: IDLRecordType | undefined;
  dictionary: IDLDictionaryType | undefined;
  callbackFunction: IDLCallbackFunctionType | undefined;
  callbackInterface: IDLCallbackInterfaceType | undefined;

  constructor(type: IDLType) {
    this.nullableMemberCount = appendCandidateTypes(type, this.types);
    this.hasNullable = type.kind === 'nullable' || this.nullableMemberCount === 1;
    let numericCount = 0;
    for (const candidate of this.types) {
      switch (candidate.kind) {
        case 'integer': case 'float':
          this.numeric ??= candidate;
          this.soleNumeric = candidate;
          numericCount++;
          break;
        case 'bigint':
          this.hasBigInt = true;
          this.soleNumeric = candidate;
          numericCount++;
          break;
        case 'string': case 'enumeration': this.string ??= candidate; break;
        case 'any': this.hasAny = true; break;
        case 'boolean': this.hasBoolean = true; break;
        case 'symbol': this.hasSymbol = true; break;
        case 'object': this.hasObject = true; break;
        case 'undefined': this.hasUndefined = true; break;
        case 'buffer-source':
          if (!this.buffers.has(candidate.name)) this.buffers.set(candidate.name, candidate);
          if (!candidate.isView) this.hasArrayBuffer = true;
          break;
        case 'interface': case 'proxy-object': this.interfaces.push(candidate); break;
        case 'sequence':
          this.sequence ??= candidate;
          this.array ??= candidate;
          break;
        case 'frozen-array':
          this.frozenArray ??= candidate;
          this.array ??= candidate;
          break;
        case 'async-sequence': this.asyncSequence ??= candidate; break;
        case 'record': this.record ??= candidate; break;
        case 'dictionary': this.dictionary ??= candidate; break;
        case 'callback-function': this.callbackFunction ??= candidate; break;
        case 'callback-interface': this.callbackInterface ??= candidate; break;
        // These types have no branch in union conversion or overload selection.
        case 'promise': case 'observable-array': break;
        default: assertNever(candidate);
      }
    }
    if (numericCount !== 1) this.soleNumeric = undefined;
  }
}

type FlattenedIDLType = Exclude<IDLType, IDLNullableType | IDLUnionType>;

/** Interface and proxy branches already linked to the definitions that recognize them. */
export type UnionInterfaceCandidate = IDLInterfaceType | IDLProxyType;

export type IntegerConversionMode = 'wrap' | 'clamp' | 'enforce-range';
export type IntegerTypeName = keyof typeof integerTypes;
type FloatTypeName = 'float' | 'unrestricted float' | 'double' | 'unrestricted double';

/** Integer representation and the bounds used by Clamp and EnforceRange. */
class IntegerFormat {
  bitLength: number;
  signed: boolean;
  /** Conversion bounds use the safe-integer range for 64-bit types. */
  lowerBound: number;
  upperBound: number;

  constructor(bitLength: number, signed: boolean) {
    this.bitLength = bitLength;
    this.signed = signed;
    this.lowerBound = bitLength === 64 ? signed ? -(2 ** 53) + 1 : 0 : signed ? -(2 ** (bitLength - 1)) : 0;
    this.upperBound = bitLength === 64 ? 2 ** 53 - 1 : signed ? 2 ** (bitLength - 1) - 1 : 2 ** bitLength - 1;
  }
}

/** One shared integer description per Web IDL integer name. */
export const integerTypes = {
  byte: new IntegerFormat(8, true),
  octet: new IntegerFormat(8, false),
  short: new IntegerFormat(16, true),
  'unsigned short': new IntegerFormat(16, false),
  long: new IntegerFormat(32, true),
  'unsigned long': new IntegerFormat(32, false),
  'long long': new IntegerFormat(64, true),
  'unsigned long long': new IntegerFormat(64, false),
};

/** The unannotated any type used for internal promise and iterator results. */
export const anyType = new IDLAnyType();

/** The return contract for callables that do not produce a value. */
export const undefinedType = new IDLUndefinedType();

// https://webidl.spec.whatwg.org/#dfn-flattened-union-member-types
function appendCandidateTypes(type: IDLType, types: FlattenedIDLType[]): number {
  if (type.kind === 'nullable') return 1 + appendCandidateTypes(type.innerType, types);
  if (type.kind === 'union') {
    let nullableCount = 0;
    for (const member of type.memberTypes) nullableCount += appendCandidateTypes(member, types);
    return nullableCount;
  }
  types.push(type);
  return 0;
}
