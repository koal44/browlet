import { InternalError, type PromiseResult, type PromiseResultType, type ResultValue } from '../../infra/index';
import {
  hasExtendedAttribute, idlType, type BufferTypeName, type ExtendedAttribute, type WebIDLType,
  type IntegerLiteral, type Definition,
} from '../core/index';

import type {
  IDLType, IDLStringType, IDLBufferType, IDLUnionType, IDLNullableType,
  IDLPromiseType, IDLObservableArrayType, IDLIntegerType, IDLFloatType, IDLEnumerationType, IDLSequenceType,
  IDLFrozenArrayType, IDLAsyncSequenceType, IDLRecordType, IDLDictionaryType, IDLCallbackFunctionType,
  IDLCallbackInterfaceType, IDLInterfaceType, IDLProxyType,
} from './types';
import {
  AssembledInterfaces, AssembledCallbackInterfaces, AssembledCallbackFunctions, AssembledNamespaces,
  AssembledDictionaries, AssembledEnumerations, AssembledTypedefs, AssembledProxyObjects,
  type AssembledCallbackFunction, type AssemblySteps,
} from './assembled';

/**
 * Combines declarations for all realms in one binding world.
 * Definitions finish assembly during construction; type uses are assembled and cached on demand.
 * Declarations, including their members and types, must remain unchanged afterward.
 */
export class DefinitionAssembly {
  /** Interfaces indexed by IDL name and implementation constructor. */
  interfaces: AssembledInterfaces;
  /** Callback object contracts, including their named operations. */
  callbackInterfaces: AssembledCallbackInterfaces;
  /** Callback function contracts used for argument and result conversion. */
  callbackFunctions: AssembledCallbackFunctions;
  /** Namespace declarations combined with their partial members. */
  namespaces: AssembledNamespaces;
  /** Dictionaries with inherited and partial members in conversion order. */
  dictionaries: AssembledDictionaries;
  /** Named sets of strings declared by Web IDL enums. */
  enumerations: AssembledEnumerations;
  /** Named aliases resolved against this assembly. */
  typedefs: AssembledTypedefs;
  /** Proxy recognition and receiver selection, such as WindowProxy. */
  proxyObjects: AssembledProxyObjects;
  /** Compiled built-in contracts shared by member bindings and converters. */
  builtinTypes: { [Name in keyof typeof idlType]: TypeFromDeclaration<(typeof idlType)[Name]>; };

  /** Compiled contracts indexed by declaration identity at the assembly input boundary. */
  #types = new Map<WebIDLType, IDLType>();
  /** Named type inputs used by bindings without manufacturing declaration descriptors. */
  #namedTypes = new Map<string, IDLType>();
  /** Flattened candidates retaining the conversion rules of their assembled use. */
  #candidateTypes = new Map<IDLType, IDLType[]>();
  /** Category lookups used to select a union branch from an incoming value. */
  #unionCandidates = new Map<IDLType, UnionCandidates>();

  /** Type categories, nullability, and container element types computed on first inspection. */
  #typeAnalyses = new Map<IDLType, TypeAnalysis>();
  /** Completed JSON-type checks; incomplete recursive dictionary checks are not retained. */
  #jsonTypeResults = new Map<IDLType, boolean>();
  /** Whether IDL values can reach implementations without unpacking or callback binding. */
  #directImplTypes = new Map<IDLType, boolean>();
  /** Type comparison keys that ignore annotations for overload selection. */
  #overloadTypeKeys = new Map<IDLType, string>();
  /** Type comparison keys that retain conversion attributes and nested types. */
  #conversionTypeKeys = new Map<IDLType, string>();

  /** Derived sequence descriptors reused by aggregate and observable-array conversions. */
  #sequenceTypesByElementType = new Map<IDLType, IDLSequenceType>();
  /** Parsed integer literals; applying a member's numeric type still happens separately. */
  #integerLiteralValues = new Map<IntegerLiteral, bigint>();

  constructor(definitions: Definition[]) {
    const names = new Set<string>();
    for (const definition of definitions) {
      switch (definition.kind) {
        case 'includes': case 'partial-interface': case 'partial-interface-mixin':
        case 'partial-dictionary': case 'partial-namespace': continue;
      }
      if (names.has(definition.name)) throw new InternalError(`Duplicate Web IDL definition ${definition.name}`);
      names.add(definition.name);
    }

    // Member types can name later declarations or their own enclosing construct.
    // Index every named target before compiling those types; discard these steps afterward.
    const finish: AssemblySteps[] = [];
    this.interfaces = new AssembledInterfaces(definitions, finish);
    this.callbackInterfaces = new AssembledCallbackInterfaces(definitions, finish);
    this.callbackFunctions = new AssembledCallbackFunctions(definitions, finish);
    this.namespaces = new AssembledNamespaces(definitions, finish);
    this.dictionaries = new AssembledDictionaries(definitions, finish);
    this.enumerations = new AssembledEnumerations(definitions);
    this.typedefs = new AssembledTypedefs(definitions, finish);
    this.proxyObjects = new AssembledProxyObjects(definitions);
    this.builtinTypes = Object.fromEntries(Object.entries(idlType).map(([name, type]) =>
      [name, this.getIDLType(type)])) as DefinitionAssembly['builtinTypes'];
    for (const complete of finish) complete(this);
  }

  /** Assemble one declared use, sharing its type and conversion rules across realms. */
  getIDLType<Type extends WebIDLType>(type: Type): TypeFromDeclaration<Type> {
    const cached = this.#types.get(type);
    if (cached) return cached as TypeFromDeclaration<Type>;
    const assembled = this.#assembleType(type);
    this.#types.set(type, assembled);
    return assembled as TypeFromDeclaration<Type>;
  }

  /** Resolve a named binding input to its compiled contract. */
  getNamedType(name: string): IDLType {
    let type = this.#namedTypes.get(name);
    if (!type) {
      type = this.getIDLType({ kind: 'reference', name });
      this.#namedTypes.set(name, type);
    }
    return type;
  }

  /** Normalize a Promise result declared by a caller or retained by an earlier conversion. */
  getPromiseResultType(type: PromiseResultType<unknown>): IDLType {
    // Infra transports both contracts without importing Web IDL. Compiled types
    // always have attributes; declaration syntax uses extendedAttributes instead.
    return 'attributes' in type
      ? type as IDLType & PromiseResultType<unknown>
      : this.getIDLType(type as WebIDLType & PromiseResultType<unknown>);
  }

  /** Parse an immutable declaration's integer text once, before applying its member type. */
  getIntegerLiteralValue(literal: IntegerLiteral): bigint {
    const cached = this.#integerLiteralValues.get(literal);
    if (cached !== undefined) return cached;
    const negative = literal.value.startsWith('-');
    const unsigned = negative ? literal.value.slice(1) : literal.value;
    const integer = /^0[0-7]+$/.test(unsigned)
      ? BigInt(`0o${unsigned.slice(1)}`)
      : BigInt(unsigned);
    const value = negative ? -integer : integer;
    this.#integerLiteralValues.set(literal, value);
    return value;
  }

  /** Reuse a sequence descriptor for operations that collect values of an existing type. */
  getSequenceType(elementType: IDLType): IDLSequenceType {
    let type = this.#sequenceTypesByElementType.get(elementType);
    if (!type) {
      type = { kind: 'sequence', elementType, attributes: [] };
      this.#sequenceTypesByElementType.set(elementType, type);
    }
    return type;
  }

  /** Get assembled candidates without descending into container contents. */
  getCandidateTypes(type: IDLType): IDLType[] {
    return this.#getCandidateTypes(type);
  }

  /** Resolve union members, removing nullable wrappers and nested unions. */
  // https://webidl.spec.whatwg.org/#dfn-flattened-union-member-types
  getFlattenedMemberTypes(type: IDLUnionType): IDLType[] {
    return this.getCandidateTypes(type);
  }

  /** Retain the first assembled candidate in each union conversion category. */
  // https://webidl.spec.whatwg.org/#js-union
  getUnionCandidates(type: IDLType): UnionCandidates {
    const cached = this.#unionCandidates.get(type);
    if (cached) return cached;
    const candidates: UnionCandidates = {
      buffers: new Map(),
      hasBoolean: false,
      hasBigInt: false,
      hasObject: false,
      hasUndefined: false,
      interfaces: [],
      numeric: undefined,
      string: undefined,
      array: undefined,
      sequence: undefined,
      frozenArray: undefined,
      asyncSequence: undefined,
      record: undefined,
      dictionary: undefined,
      callbackFunction: undefined,
      callbackInterface: undefined,
    };
    for (const candidate of this.#getCandidateTypes(type)) {
      switch (candidate.kind) {
        case 'integer': case 'float': candidates.numeric ??= candidate; break;
        case 'string': candidates.string ??= candidate; break;
        case 'boolean': candidates.hasBoolean = true; break;
        case 'bigint': candidates.hasBigInt = true; break;
        case 'object': candidates.hasObject = true; break;
        case 'undefined': candidates.hasUndefined = true; break;
        case 'buffer-source':
          if (!candidates.buffers.has(candidate.name)) candidates.buffers.set(candidate.name, candidate);
          break;
        case 'enumeration': candidates.string ??= candidate; break;
        case 'dictionary': candidates.dictionary ??= candidate; break;
        case 'callback-function': candidates.callbackFunction ??= candidate; break;
        case 'callback-interface': candidates.callbackInterface ??= candidate; break;
        case 'interface': case 'proxy-object': candidates.interfaces.push(candidate); break;
        case 'sequence':
          candidates.sequence ??= candidate;
          candidates.array ??= candidate;
          break;
        case 'frozen-array':
          candidates.frozenArray ??= candidate;
          candidates.array ??= candidate;
          break;
        case 'async-sequence': candidates.asyncSequence ??= candidate; break;
        case 'record': candidates.record ??= candidate; break;
      }
    }
    this.#unionCandidates.set(type, candidates);
    return candidates;
  }

  /** Get an overload comparison key with aliases resolved and annotations ignored. */
  getOverloadTypeKey(type: IDLType): string {
    const cached = this.#overloadTypeKeys.get(type);
    if (cached !== undefined) return cached;
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
      case 'nullable': key = `${this.getOverloadTypeKey(type.innerType)}?`; break;
      case 'union': key = `(${type.memberTypes.map((member) => this.getOverloadTypeKey(member)).join(' or ')})`; break;
      case 'sequence': case 'async-sequence': case 'frozen-array': case 'observable-array':
        key = `${type.kind}<${this.getOverloadTypeKey(type.elementType)}>`;
        break;
      case 'promise': key = `promise<${this.getOverloadTypeKey(type.resultType)}>`; break;
      case 'record': key = `record<${this.getOverloadTypeKey(type.keyType)}, ${this.getOverloadTypeKey(type.valueType)}>`; break;
    }
    this.#overloadTypeKeys.set(type, key);
    return key;
  }

  /** Compare result descriptors, including conversion attributes and nested types. */
  getConversionTypeKey(type: IDLType): string {
    const cached = this.#conversionTypeKeys.get(type);
    if (cached !== undefined) return cached;
    let parts: string[];
    switch (type.kind) {
      case 'any': case 'undefined': case 'boolean': case 'bigint': case 'object': case 'symbol':
        parts = [];
        break;
      case 'integer': case 'float': case 'string': case 'buffer-source': parts = [type.name]; break;
      case 'interface': case 'dictionary': case 'enumeration': case 'callback-function':
      case 'callback-interface': case 'proxy-object': parts = [type.assembled.primary.name]; break;
      case 'union': parts = type.memberTypes.map((member) => this.getConversionTypeKey(member)).sort(); break;
      case 'record': parts = [this.getConversionTypeKey(type.keyType), this.getConversionTypeKey(type.valueType)]; break;
      case 'nullable': parts = [this.getConversionTypeKey(type.innerType)]; break;
      case 'promise': parts = [this.getConversionTypeKey(type.resultType)]; break;
      default: parts = [this.getConversionTypeKey(type.elementType)];
    }
    const key = JSON.stringify([
      type.kind, parts, type.attributes.map((attribute) => JSON.stringify(attribute)).sort(),
    ]);
    this.#conversionTypeKeys.set(type, key);
    return key;
  }

  /** Whether every candidate produces a primitive value, including enumerations and null. */
  isPrimitiveType(type: IDLType): boolean {
    return this.getCandidateTypes(type).every((candidate) =>
      candidate.kind === 'integer' || candidate.kind === 'float' || candidate.kind === 'string' ||
      candidate.kind === 'enumeration' || candidate.kind === 'undefined' || candidate.kind === 'boolean' ||
      candidate.kind === 'bigint' || candidate.kind === 'symbol');
  }

  /** Whether values of this type can pass directly from IDL to implementation code. */
  // Only primitives and sequences of primitives bypass inspection. References,
  // records, and other objects can need unwrapping, binding, or nested conversion.
  canPassToImpl(type: IDLType): boolean {
    const cached = this.#directImplTypes.get(type);
    if (cached !== undefined) return cached;
    const direct = this.getCandidateTypes(type).every((candidate) => {
      if (candidate.kind === 'sequence') return this.canPassToImpl(candidate.elementType);
      return this.isPrimitiveType(candidate);
    });
    this.#directImplTypes.set(type, direct);
    return direct;
  }

  /** Whether an overload candidate includes a string or enumeration type. */
  hasStringCandidate(type: IDLType): boolean {
    return this.#getTypeAnalysis(type).hasString;
  }

  /** Whether an overload candidate includes a numeric type, excluding bigint. */
  hasNumericCandidate(type: IDLType): boolean {
    return this.#getTypeAnalysis(type).hasNumeric;
  }

  /** Match a buffer type through nullable wrappers and unions. */
  hasBufferCandidate(type: IDLType, name: BufferTypeName): boolean {
    return this.#getTypeAnalysis(type).bufferNames.has(name);
  }

  /** Whether an overload candidate includes ArrayBuffer or SharedArrayBuffer. */
  hasArrayBufferCandidate(type: IDLType): boolean {
    const { bufferNames } = this.#getTypeAnalysis(type);
    return bufferNames.has('ArrayBuffer') || bufferNames.has('SharedArrayBuffer');
  }

  /** Match a type kind through aliases, nullable wrappers, and unions. */
  hasCandidateKind(type: IDLType, kind: IDLType['kind']): boolean {
    return this.#getTypeAnalysis(type).kinds.has(kind);
  }

  /** Whether an overload candidate includes a sequence or frozen array. */
  hasSequenceCandidate(type: IDLType): boolean {
    const { kinds } = this.#getTypeAnalysis(type);
    return kinds.has('sequence') || kinds.has('frozen-array');
  }

  /** Count nullable members through aliases and nested unions. */
  // https://webidl.spec.whatwg.org/#dfn-number-of-nullable-member-types
  getNumberOfNullableMemberTypes(type: IDLUnionType): number {
    return this.#getTypeAnalysis(type).nullableMemberCount;
  }

  /** Whether null is included directly or through a union member. */
  // https://webidl.spec.whatwg.org/#dfn-includes-a-nullable-type
  includesNullableType(type: IDLType): boolean {
    return this.#getTypeAnalysis(type).includesNullable;
  }

  /** Whether undefined is included directly or through a union member. */
  // https://webidl.spec.whatwg.org/#dfn-includes-undefined
  includesUndefined(type: IDLType): boolean {
    return this.#getTypeAnalysis(type).kinds.has('undefined');
  }

  /** Find the single numeric or bigint candidate used to materialize an integer default. */
  getSoleNumericTypeName(type: IDLType): NumericTypeName | undefined {
    return this.#getTypeAnalysis(type).soleNumericTypeName;
  }

  /** Find a sequence's element type through aliases, nullable wrappers, and unions. */
  findSequenceElementType(type: IDLType): IDLType | undefined {
    return this.#getTypeAnalysis(type).sequenceElementType;
  }

  /** Find a record's value type through aliases, nullable wrappers, and unions. */
  findRecordValueType(type: IDLType): IDLType | undefined {
    return this.#getTypeAnalysis(type).recordValueType;
  }

  /** Resolve aliases and annotations before selecting an observable array's element type. */
  getObservableArrayElementType(type: IDLType): IDLType | undefined {
    return type.kind === 'observable-array'
      ? type.elementType
      : undefined;
  }

  /** The nullable callback whose attribute assignment accepts non-callable objects. */
  // https://webidl.spec.whatwg.org/#LegacyTreatNonObjectAsNull
  getNullableLegacyCallback(type: IDLType): AssembledCallbackFunction | null {
    if (type.kind !== 'nullable' || type.innerType.kind !== 'callback-function') return null;
    const assembled = type.innerType.assembled;
    return assembled.treatsNonObjectAsNull() ? assembled : null;
  }

  /** Whether the declared type can contribute values to a default toJSON operation. */
  // https://webidl.spec.whatwg.org/#dfn-json-types
  isJSONType(type: IDLType, seen?: Set<string>): boolean {
    if (!seen) {
      const cached = this.#jsonTypeResults.get(type);
      if (cached !== undefined) return cached;
      // Recursive checks depend on the current dictionary path; retain only completed root answers.
      const result = this.isJSONType(type, new Set());
      this.#jsonTypeResults.set(type, result);
      return result;
    }
    switch (type.kind) {
      case 'integer': case 'float': case 'string': case 'boolean': case 'object':
        return true;
      case 'nullable': return this.isJSONType(type.innerType, seen);
      case 'sequence': case 'frozen-array': return this.isJSONType(type.elementType, seen);
      case 'union': return type.memberTypes.every((member) => this.isJSONType(member, seen));
      case 'record': return this.isJSONType(type.valueType, seen);
      case 'enumeration': return true;
      case 'interface': return type.assembled.hasToJSON();
      case 'dictionary': {
        const name = type.assembled.primary.name;
        if (seen.has(name)) return false;
        return type.assembled.isJSONType(this, new Set(seen).add(name));
      }
      default: return false;
    }
  }

  #assembleType(type: WebIDLType, inheritedAttributes?: ExtendedAttribute[]): IDLType {
    const extendedAttributes = inheritedAttributes ? [...inheritedAttributes] : [];
    const resolved = this.typedefs.resolve(type, extendedAttributes);
    const origin = { attributes: extendedAttributes };
    switch (resolved.kind) {
      case 'simple': {
        const { name } = resolved;
        switch (name) {
          case 'byte': case 'octet': case 'short': case 'unsigned short':
          case 'long': case 'unsigned long': case 'long long': case 'unsigned long long':
            return {
              ...origin, kind: 'integer', name,
              integerMode: hasExtendedAttribute(extendedAttributes, 'EnforceRange') ? 'enforce-range'
                : hasExtendedAttribute(extendedAttributes, 'Clamp') ? 'clamp' : 'wrap',
            };
          case 'float': case 'unrestricted float': case 'double': case 'unrestricted double':
            return { ...origin, kind: 'float', name };
          case 'DOMString': case 'ByteString': case 'USVString':
            return {
              ...origin, kind: 'string', name,
              nullToEmptyString: hasExtendedAttribute(extendedAttributes, 'LegacyNullToEmptyString'),
            };
          case 'any': case 'undefined': case 'boolean': case 'bigint': case 'object': case 'symbol':
            return { ...origin, kind: name };
          default:
            return {
              ...origin, kind: 'buffer-source', name,
              allowShared: hasExtendedAttribute(extendedAttributes, 'AllowShared'),
              allowResizable: hasExtendedAttribute(extendedAttributes, 'AllowResizable'),
            };
        }
      }
      case 'interface':
        return { ...origin, kind: 'interface', assembled: this.interfaces.getType(resolved.implClass).assembled };
      case 'reference': {
        const name = resolved.name;
        const assembled = this.interfaces.get(name);
        if (assembled) return { ...origin, kind: 'interface', assembled };
        const dictionary = this.dictionaries.get(name);
        if (dictionary) return { ...origin, kind: 'dictionary', assembled: dictionary };
        const enumeration = this.enumerations.get(name);
        if (enumeration) return { ...origin, kind: 'enumeration', assembled: enumeration };
        const callbackFunction = this.callbackFunctions.get(name);
        if (callbackFunction) return { ...origin, kind: 'callback-function', assembled: callbackFunction };
        const callbackInterface = this.callbackInterfaces.get(name);
        if (callbackInterface) return { ...origin, kind: 'callback-interface', assembled: callbackInterface };
        const proxy = this.proxyObjects.get(name);
        if (proxy) return { ...origin, kind: 'proxy-object', assembled: proxy };
        throw new InternalError(this.namespaces.has(name)
          ? `${name} is not a value type` : `Unknown Web IDL type ${name}`);
      }
      case 'nullable':
        return {
          ...origin, kind: 'nullable', innerType: extendedAttributes.length
          ? this.#assembleType(resolved.type, extendedAttributes) : this.getIDLType(resolved.type),
        };
      case 'union':
        return {
          ...origin, kind: 'union', memberTypes: resolved.types.map((member) => extendedAttributes.length
          ? this.#assembleType(member, extendedAttributes) : this.getIDLType(member)),
        };
      case 'sequence': case 'async-sequence': case 'frozen-array': case 'observable-array':
        return { ...origin, kind: resolved.kind, elementType: this.getIDLType(resolved.type) };
      case 'promise':
        return { ...origin, kind: 'promise', resultType: this.getIDLType(resolved.type) };
      case 'record':
        return {
          ...origin, kind: 'record',
          // The declaration contract restricts record keys to the three string types.
          keyType: this.getIDLType(resolved.key),
          valueType: this.getIDLType(resolved.value),
        };
    }
  }

  #getCandidateTypes(type: IDLType): IDLType[] {
    const cached = this.#candidateTypes.get(type);
    if (cached) return cached;
    let candidates: IDLType[];
    if (type.kind === 'nullable') {
      candidates = this.#getCandidateTypes(type.innerType);
    } else if (type.kind === 'union') {
      candidates = [];
      for (const member of type.memberTypes) candidates.push(...this.#getCandidateTypes(member));
    } else {
      candidates = [type];
    }
    this.#candidateTypes.set(type, candidates);
    return candidates;
  }

  // Prepare fixed classification and implementation-conversion answers without inspecting container contents.
  #getTypeAnalysis(type: IDLType): TypeAnalysis {
    const cached = this.#typeAnalyses.get(type);
    if (cached) return cached;
    const analysis: TypeAnalysis = {
      bufferNames: new Set(),
      kinds: new Set(),
      hasString: false,
      hasNumeric: false,
      includesNullable: false,
      nullableMemberCount: 0,
      soleNumericTypeName: undefined,
      sequenceElementType: undefined,
      recordValueType: undefined,
    };
    let numericCount = 0;
    for (const candidate of this.getCandidateTypes(type)) {
      analysis.kinds.add(candidate.kind);
      switch (candidate.kind) {
        case 'integer': case 'float':
          analysis.hasNumeric = true;
          numericCount++;
          analysis.soleNumericTypeName = candidate.name;
          break;
        case 'bigint':
          numericCount++;
          analysis.soleNumericTypeName = 'bigint';
          break;
        case 'string': case 'enumeration': analysis.hasString = true; break;
        case 'buffer-source': analysis.bufferNames.add(candidate.name); break;
        case 'record':
          analysis.recordValueType ??= candidate.valueType;
          break;
        case 'sequence':
          analysis.sequenceElementType ??= candidate.elementType;
          break;
      }
    }
    if (numericCount !== 1) analysis.soleNumericTypeName = undefined;

    if (type.kind === 'union') {
      for (let memberType of type.memberTypes) {
        if (memberType.kind === 'nullable') {
          analysis.nullableMemberCount++;
          memberType = memberType.innerType;
        }
        if (memberType.kind === 'union') {
          analysis.nullableMemberCount += this.#getTypeAnalysis(memberType).nullableMemberCount;
        }
      }
    }
    analysis.includesNullable = type.kind === 'nullable' || analysis.nullableMemberCount === 1;
    this.#typeAnalyses.set(type, analysis);
    return analysis;
  }
}

/** Fixed choices used to select a union branch from an incoming value. */
type UnionCandidates = {
  buffers: Map<BufferTypeName, IDLBufferType>;
  hasBoolean: boolean;
  hasBigInt: boolean;
  hasObject: boolean;
  hasUndefined: boolean;
  interfaces: UnionInterfaceCandidate[];
  numeric: IDLIntegerType | IDLFloatType | undefined;
  string: IDLStringType | IDLEnumerationType | undefined;
  array: IDLSequenceType | IDLFrozenArrayType | undefined;
  sequence: IDLSequenceType | undefined;
  frozenArray: IDLFrozenArrayType | undefined;
  asyncSequence: IDLAsyncSequenceType | undefined;
  record: IDLRecordType | undefined;
  dictionary: IDLDictionaryType | undefined;
  callbackFunction: IDLCallbackFunctionType | undefined;
  callbackInterface: IDLCallbackInterfaceType | undefined;
};

/** Interface and proxy branches already linked to the definitions that recognize them. */
export type UnionInterfaceCandidate = IDLInterfaceType | IDLProxyType;

/** Answers that depend only on a descriptor and this assembly's declarations. */
type TypeAnalysis = {
  bufferNames: Set<BufferTypeName>;
  kinds: Set<IDLType['kind']>;
  hasString: boolean;
  hasNumeric: boolean;
  includesNullable: boolean;
  nullableMemberCount: number;
  soleNumericTypeName: NumericTypeName | undefined;
  sequenceElementType: IDLType | undefined;
  recordValueType: IDLType | undefined;
};

type NumericTypeName = IDLIntegerType['name'] | IDLFloatType['name'] | 'bigint';

/** Static counterpart of declaration assembly; this mapping is confined to the input boundary. */
type TypeFromDeclaration<Type extends WebIDLType> =
  WebIDLType extends Type ? IDLType
    : Type extends { kind: 'annotated'; type: infer Inner extends WebIDLType; } ? TypeFromDeclaration<Inner>
      : Type extends { kind: 'simple'; name: infer Name; } ? (
        Name extends IDLIntegerType['name'] ? IDLIntegerType & { name: Name; }
          : Name extends IDLFloatType['name'] ? IDLFloatType & { name: Name; }
            : Name extends IDLStringType['name'] ? IDLStringType & { name: Name; }
              : Name extends IDLBufferType['name'] ? IDLBufferType & { name: Name; } & ResultValue<PromiseResult<Type>>
                : Extract<IDLType, { kind: Name; }>
      )
        : Type extends { kind: 'interface'; } ? IDLInterfaceType & ResultValue<PromiseResult<Type>>
          : Type extends { kind: 'nullable'; } ? IDLNullableType
            : Type extends { kind: 'union'; } ? IDLUnionType
              : Type extends { kind: 'sequence'; } ? IDLSequenceType
                : Type extends { kind: 'async-sequence'; } ? IDLAsyncSequenceType
                  : Type extends { kind: 'frozen-array'; } ? IDLFrozenArrayType
                    : Type extends { kind: 'observable-array'; } ? IDLObservableArrayType
                      : Type extends { kind: 'record'; } ? IDLRecordType
                        : Type extends { kind: 'promise'; } ? IDLPromiseType
                          : IDLType;
