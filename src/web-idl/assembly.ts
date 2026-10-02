import type {
  AnnotatedType, UnionType, SimpleTypeName, SequenceType, ExtendedAttribute, WebIDLType, IntegerLiteral,
} from './core/types';
import { sequence } from './core/helpers';
import type { Definition } from './core/declarations';
import {
  AssembledInterfaces, AssembledCallbackInterfaces, AssembledCallbackFunctions, AssembledNamespaces,
  AssembledDictionaries, AssembledEnumerations, AssembledTypedefs, AssembledProxyObjects,
  type AssembledDictionary, type AssembledCallbackFunction, type AssembledCallbackInterface,
  type AssembledInterface, type AssembledProxyObject,
} from './assembled';

/**
 * Combines declarations for all realms in one binding world.
 * Assembly finishes during construction; subsequent lookups do not build definitions.
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

  /** Alias-resolved descriptors with outer annotations removed. */
  #unannotatedTypes = new Map<WebIDLType, UnannotatedType>();
  /** Alias-resolved descriptors with the conversion attributes collected along the alias chain. */
  #conversionTypes = new Map<WebIDLType, ConversionType>();
  /** Flattened union candidates with nullable wrappers and annotations removed. */
  #candidateTypes = new Map<WebIDLType, WebIDLType[]>();
  /** Flattened union candidates retaining their conversion attributes. */
  #conversionCandidates = new Map<WebIDLType, ConversionType[]>();
  /** Category lookups used to select a union branch from an incoming value. */
  #unionCandidates = new Map<WebIDLType, UnionCandidates>();

  /** Type categories, nullability, and container element types computed on first inspection. */
  #typeAnalyses = new Map<WebIDLType, TypeAnalysis>();
  /** Completed JSON-type checks; incomplete recursive dictionary checks are not retained. */
  #jsonTypeResults = new Map<WebIDLType, boolean>();
  /** Conservative carrier checks, including containers that need unpacking. */
  #carrierTypes = new Map<WebIDLType, boolean>();
  /** Type comparison keys that ignore annotations for overload selection. */
  #overloadTypeKeys = new Map<WebIDLType, string>();
  /** Type comparison keys that retain conversion attributes and nested types. */
  #conversionTypeKeys = new Map<WebIDLType, string>();

  /** Derived sequence descriptors reused by aggregate and observable-array conversions. */
  #sequenceTypesByElementType = new Map<WebIDLType, SequenceType>();
  /** Parsed integer literals; applying a member's numeric type still happens separately. */
  #integerLiteralValues = new Map<IntegerLiteral, bigint>();

  constructor(definitions: Definition[]) {
    this.interfaces = new AssembledInterfaces(definitions);
    this.callbackInterfaces = new AssembledCallbackInterfaces(definitions);
    this.callbackFunctions = new AssembledCallbackFunctions(definitions);
    this.namespaces = new AssembledNamespaces(definitions);
    this.dictionaries = new AssembledDictionaries(definitions);
    this.enumerations = new AssembledEnumerations(definitions);
    this.typedefs = new AssembledTypedefs(definitions);
    this.proxyObjects = new AssembledProxyObjects(definitions);
  }

  // Member types retain declaration references; queries resolve those names within this assembly.
  /** Follow aliases and discard annotations when inspecting a type's shape. */
  getUnannotatedType(type: WebIDLType): UnannotatedType {
    const cached = this.#unannotatedTypes.get(type);
    if (cached) return cached;
    const resolved = this.typedefs.resolve(type);
    const unannotated = resolved.kind === 'interface'
      ? this.interfaces.getReference(resolved.implClass)
      : resolved;
    this.#unannotatedTypes.set(type, unannotated);
    return unannotated;
  }

  /** Follow aliases while collecting conversion attributes from outermost to innermost. */
  getConversionType(type: WebIDLType, extendedAttributes?: ExtendedAttribute[]): ConversionType {
    let cached = this.#conversionTypes.get(type);
    if (!cached) {
      const attributes: ExtendedAttribute[] = [];
      let resolved = this.typedefs.resolve(type, attributes);
      while (resolved.kind === 'interface') {
        resolved = this.typedefs.resolve(this.interfaces.getReference(resolved.implClass), attributes);
      }
      cached = { extendedAttributes: attributes, type: resolved };
      this.#conversionTypes.set(type, cached);
    }
    if (!extendedAttributes?.length) return cached;
    return {
      type: cached.type,
      extendedAttributes: [...extendedAttributes, ...cached.extendedAttributes],
    };
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
  getSequenceType(elementType: WebIDLType): SequenceType {
    let type = this.#sequenceTypesByElementType.get(elementType);
    if (!type) {
      type = sequence(elementType);
      this.#sequenceTypesByElementType.set(elementType, type);
    }
    return type;
  }

  /** Get candidates without descending into sequence elements or other container contents. */
  getCandidateTypes(type: WebIDLType): WebIDLType[] {
    const cached = this.#candidateTypes.get(type);
    if (cached) return cached;
    const inner = this.getUnannotatedType(type);
    let candidates: WebIDLType[];
    if (inner.kind === 'nullable') {
      candidates = this.getCandidateTypes(inner.type);
    } else if (inner.kind === 'union') {
      candidates = this.getFlattenedMemberTypes(inner);
    } else {
      candidates = [inner];
    }
    this.#candidateTypes.set(type, candidates);
    return candidates;
  }

  /** Resolve union members, removing nullable wrappers and nested unions. */
  // https://webidl.spec.whatwg.org/#dfn-flattened-union-member-types
  getFlattenedMemberTypes(type: UnionType | AnnotatedUnionType): WebIDLType[] {
    const unionType = type.kind === 'annotated' ? type.type : type;
    const cached = this.#candidateTypes.get(unionType);
    if (cached) return cached;
    const flattenedMemberTypes: WebIDLType[] = [];

    for (let memberType of unionType.types) {
      memberType = this.getUnannotatedType(memberType);
      if (memberType.kind === 'nullable') {
        memberType = this.getUnannotatedType(memberType.type);
      }
      if (memberType.kind === 'union') {
        flattenedMemberTypes.push(...this.getFlattenedMemberTypes(memberType));
      } else {
        flattenedMemberTypes.push(memberType);
      }
    }

    this.#candidateTypes.set(unionType, flattenedMemberTypes);
    return flattenedMemberTypes;
  }

  /** Flatten conversion candidates while retaining each member's inherited conversion attributes. */
  getConversionCandidates(type: WebIDLType, extendedAttributes?: ExtendedAttribute[]): ConversionType[] {
    let cached = this.#conversionCandidates.get(type);
    if (!cached) {
      const conversionType = this.getConversionType(type);
      if (conversionType.type.kind === 'nullable') {
        cached = this.getConversionCandidates(conversionType.type.type, conversionType.extendedAttributes);
      } else if (conversionType.type.kind === 'union') {
        const candidates: ConversionType[] = [];
        for (const member of conversionType.type.types) {
          candidates.push(...this.getConversionCandidates(member, conversionType.extendedAttributes));
        }
        cached = candidates;
      } else {
        cached = [conversionType];
      }
      this.#conversionCandidates.set(type, cached);
    }
    // Attributes supplied by an invocation must not become part of the descriptor's cached result.
    if (!extendedAttributes?.length) return cached;
    return cached.map((candidate) => ({
      type: candidate.type,
      extendedAttributes: [...extendedAttributes, ...candidate.extendedAttributes],
    }));
  }

  /** Retain the first candidate in each conversion category, resolving names within this assembly. */
  // https://webidl.spec.whatwg.org/#js-union
  getUnionCandidates(type: WebIDLType): UnionCandidates {
    const cached = this.#unionCandidates.get(type);
    if (cached) return cached;
    const candidates: UnionCandidates = {
      simpleTypes: new Map(),
      typesByKind: new Map(),
      interfaces: [],
      numeric: undefined,
      string: undefined,
      array: undefined,
      dictionary: undefined,
      callbackFunction: undefined,
      callbackInterface: undefined,
    };
    for (const candidate of this.getConversionCandidates(type)) {
      const inner = candidate.type;
      if (!candidates.typesByKind.has(inner.kind)) candidates.typesByKind.set(inner.kind, candidate);
      switch (inner.kind) {
        case 'simple':
          if (!candidates.simpleTypes.has(inner.name)) candidates.simpleTypes.set(inner.name, candidate);
          if (numericTypeNames.has(inner.name)) candidates.numeric ??= candidate;
          if (stringTypeNames.has(inner.name)) candidates.string ??= candidate;
          break;
        case 'reference': {
          candidates.dictionary ??= this.dictionaries.get(inner.name);
          candidates.callbackFunction ??= this.callbackFunctions.get(inner.name);
          candidates.callbackInterface ??= this.callbackInterfaces.get(inner.name);
          if (this.enumerations.has(inner.name)) candidates.string ??= candidate;
          const assembled = this.interfaces.get(inner.name);
          if (assembled) {
            candidates.interfaces.push({ type: candidate, assembled });
          } else {
            const proxy = this.proxyObjects.get(inner.name);
            if (proxy) candidates.interfaces.push({ type: candidate, proxy });
          }
          break;
        }
        case 'sequence':
        case 'frozen-array':
          candidates.array ??= candidate;
          break;
      }
    }
    this.#unionCandidates.set(type, candidates);
    return candidates;
  }

  /** Get an overload comparison key with aliases resolved and annotations ignored. */
  getOverloadTypeKey(type: WebIDLType): string {
    const cached = this.#overloadTypeKeys.get(type);
    if (cached !== undefined) return cached;
    const inner = this.getUnannotatedType(type);
    let key: string;
    switch (inner.kind) {
      case 'simple':
        key = inner.name;
        break;
      case 'reference':
        key = `reference:${inner.name}`;
        break;
      case 'nullable':
        key = `${this.getOverloadTypeKey(inner.type)}?`;
        break;
      case 'union':
        key = `(${inner.types.map((member) =>
          this.getOverloadTypeKey(member)).join(' or ')})`;
        break;
      case 'sequence':
      case 'async-sequence':
      case 'promise':
      case 'frozen-array':
      case 'observable-array':
        key = `${inner.kind}<${this.getOverloadTypeKey(inner.type)}>`;
        break;
      case 'record':
        key = `record<${this.getOverloadTypeKey(inner.key)}, ${
          this.getOverloadTypeKey(inner.value)
        }>`;
        break;
    }
    this.#overloadTypeKeys.set(type, key);
    return key;
  }

  /** Compare result descriptors, including conversion attributes and nested types. */
  getConversionTypeKey(type: WebIDLType): string {
    const cached = this.#conversionTypeKeys.get(type);
    if (cached !== undefined) return cached;
    const { type: unannotated, extendedAttributes } = this.getConversionType(type);
    let parts: string[];
    switch (unannotated.kind) {
      case 'simple':
      case 'reference': parts = [unannotated.name]; break;
      case 'union': parts = unannotated.types.map((member) => this.getConversionTypeKey(member)).sort(); break;
      case 'record':
        parts = [this.getConversionTypeKey(unannotated.key), this.getConversionTypeKey(unannotated.value)];
        break;
      default: parts = [this.getConversionTypeKey(unannotated.type)];
    }
    const key = JSON.stringify([
      unannotated.kind, parts, extendedAttributes.map((attribute) => JSON.stringify(attribute)).sort(),
    ]);
    this.#conversionTypeKeys.set(type, key);
    return key;
  }

  /** Whether every candidate produces a primitive value, including enumerations and null. */
  isPrimitiveType(type: WebIDLType): boolean {
    return this.getCandidateTypes(type).every((candidate) => {
      if (candidate.kind === 'reference') return this.enumerations.has(candidate.name);
      return candidate.kind === 'simple' && (
        numericTypeNames.has(candidate.name) || stringTypeNames.has(candidate.name) ||
        candidate.name === 'boolean' || candidate.name === 'bigint' || candidate.name === 'undefined' ||
        candidate.name === 'symbol'
      );
    });
  }

  /** Whether a type may carry an intermediate value, directly or inside a container. */
  // Only primitives and sequences of primitives bypass unpacking. This is a
  // conservative check: record Maps also need unpacking, while ordinary objects
  // pass through unchanged when inspected by idlToImpl.
  mayContainCarrier(type: WebIDLType): boolean {
    const cached = this.#carrierTypes.get(type);
    if (cached !== undefined) return cached;
    const mayContainCarrier = this.getCandidateTypes(type).some((candidate) => {
      if (candidate.kind === 'sequence') return this.mayContainCarrier(candidate.type);
      return !this.isPrimitiveType(candidate);
    });
    this.#carrierTypes.set(type, mayContainCarrier);
    return mayContainCarrier;
  }

  /** Whether an overload candidate includes a string or enumeration type. */
  hasStringCandidate(type: WebIDLType): boolean {
    return this.#getTypeAnalysis(type).hasString;
  }

  /** Whether an overload candidate includes a numeric type, excluding bigint. */
  hasNumericCandidate(type: WebIDLType): boolean {
    return this.#getTypeAnalysis(type).hasNumeric;
  }

  /** Match a simple type through aliases, nullable wrappers, and unions. */
  hasSimpleCandidate(type: WebIDLType, name: SimpleTypeName): boolean {
    return this.#getTypeAnalysis(type).simpleNames.has(name);
  }

  /** Whether an overload candidate includes ArrayBuffer or SharedArrayBuffer. */
  hasArrayBufferCandidate(type: WebIDLType): boolean {
    const { simpleNames } = this.#getTypeAnalysis(type);
    return simpleNames.has('ArrayBuffer') || simpleNames.has('SharedArrayBuffer');
  }

  /** Match a type kind through aliases, nullable wrappers, and unions. */
  hasCandidateKind(type: WebIDLType, kind: WebIDLType['kind']): boolean {
    return this.#getTypeAnalysis(type).kinds.has(kind);
  }

  /** Whether an overload candidate includes a sequence or frozen array. */
  hasSequenceCandidate(type: WebIDLType): boolean {
    const { kinds } = this.#getTypeAnalysis(type);
    return kinds.has('sequence') || kinds.has('frozen-array');
  }

  /** Count nullable members through aliases and nested unions. */
  // https://webidl.spec.whatwg.org/#dfn-number-of-nullable-member-types
  getNumberOfNullableMemberTypes(type: UnionType | AnnotatedUnionType): number {
    return this.#getTypeAnalysis(type).nullableMemberCount;
  }

  /** Whether null is included directly or through a union member. */
  // https://webidl.spec.whatwg.org/#dfn-includes-a-nullable-type
  includesNullableType(type: WebIDLType): boolean {
    return this.#getTypeAnalysis(type).includesNullable;
  }

  /** Whether undefined is included directly or through a union member. */
  // https://webidl.spec.whatwg.org/#dfn-includes-undefined
  includesUndefined(type: WebIDLType): boolean {
    return this.#getTypeAnalysis(type).simpleNames.has('undefined');
  }

  /** Find the single numeric or bigint candidate used to materialize an integer default. */
  getSoleNumericTypeName(type: WebIDLType): SimpleTypeName | undefined {
    return this.#getTypeAnalysis(type).soleNumericTypeName;
  }

  /** Find a sequence's element type through aliases, nullable wrappers, and unions. */
  findSequenceElementType(type: WebIDLType): WebIDLType | undefined {
    return this.#getTypeAnalysis(type).sequenceElementType;
  }

  /** Find a record's value type through aliases, nullable wrappers, and unions. */
  findRecordValueType(type: WebIDLType): WebIDLType | undefined {
    return this.#getTypeAnalysis(type).recordValueType;
  }

  /** Resolve aliases and annotations before selecting an observable array's element type. */
  getObservableArrayElementType(type: WebIDLType): WebIDLType | undefined {
    const resolved = this.getUnannotatedType(type);
    return resolved.kind === 'observable-array'
      ? resolved.type
      : undefined;
  }

  /** Whether attribute assignment uses nullable [LegacyTreatNonObjectAsNull] callback rules. */
  // https://webidl.spec.whatwg.org/#LegacyTreatNonObjectAsNull
  isNullableLegacyCallback(type: WebIDLType): boolean {
    const nullableType = this.getConversionType(type).type;
    if (nullableType.kind !== 'nullable') return false;
    const callbackType = this.getConversionType(nullableType.type).type;
    if (callbackType.kind !== 'reference') return false;
    const assembled = this.callbackFunctions.get(callbackType.name);
    return assembled?.treatsNonObjectAsNull() ?? false;
  }

  /** Whether the declared type can contribute values to a default toJSON operation. */
  // https://webidl.spec.whatwg.org/#dfn-json-types
  isJSONType(type: WebIDLType, seen?: Set<string>): boolean {
    if (!seen) {
      const cached = this.#jsonTypeResults.get(type);
      if (cached !== undefined) return cached;
      // Recursive checks depend on the current dictionary path; retain only completed root answers.
      const result = this.isJSONType(type, new Set());
      this.#jsonTypeResults.set(type, result);
      return result;
    }
    const unannotated = this.getUnannotatedType(type);
    switch (unannotated.kind) {
      case 'simple':
        return jsonSimpleTypeNames.has(unannotated.name);
      case 'nullable':
      case 'sequence':
      case 'frozen-array':
        return this.isJSONType(unannotated.type, seen);
      case 'union':
        return unannotated.types.every((member) => this.isJSONType(member, seen));
      case 'record':
        return this.isJSONType(unannotated.value, seen);
      case 'reference': {
        if (seen.has(unannotated.name)) return false;
        if (this.enumerations.has(unannotated.name)) return true;
        const assembled = this.dictionaries.get(unannotated.name);
        if (assembled) return assembled.isJSONType(this, new Set(seen).add(unannotated.name));
        return this.interfaces.get(unannotated.name)?.hasToJSON() ?? false;
      }
      default:
        return false;
    }
  }

  // Prepare fixed classification and implementation-conversion answers without inspecting container contents.
  #getTypeAnalysis(type: WebIDLType): TypeAnalysis {
    const cached = this.#typeAnalyses.get(type);
    if (cached) return cached;
    const analysis: TypeAnalysis = {
      simpleNames: new Set(),
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
        case 'simple': {
          analysis.simpleNames.add(candidate.name);
          analysis.hasString ||= stringTypeNames.has(candidate.name);
          const numeric = numericTypeNames.has(candidate.name);
          analysis.hasNumeric ||= numeric;
          if (numeric || candidate.name === 'bigint') {
            numericCount++;
            analysis.soleNumericTypeName = candidate.name;
          }
          break;
        }
        case 'reference':
          analysis.hasString ||= this.enumerations.has(candidate.name);
          break;
        case 'record':
          analysis.recordValueType ??= candidate.value;
          break;
        case 'sequence':
          analysis.sequenceElementType ??= candidate.type;
          break;
      }
    }
    if (numericCount !== 1) analysis.soleNumericTypeName = undefined;

    const inner = this.getUnannotatedType(type);
    if (inner.kind === 'union') {
      for (let memberType of inner.types) {
        memberType = this.getUnannotatedType(memberType);
        if (memberType.kind === 'nullable') {
          analysis.nullableMemberCount++;
          memberType = this.getUnannotatedType(memberType.type);
        }
        if (memberType.kind === 'union') {
          analysis.nullableMemberCount += this.#getTypeAnalysis(memberType).nullableMemberCount;
        }
      }
    }
    analysis.includesNullable = inner.kind === 'nullable' || analysis.nullableMemberCount === 1;
    this.#typeAnalyses.set(type, analysis);
    return analysis;
  }
}

/** A type with aliases resolved and its ordered conversion attributes retained. */
export type ConversionType = {
  extendedAttributes: ExtendedAttribute[];
  type: UnannotatedType;
};

/** Fixed choices used by union conversion; recognizing the incoming value remains a binding operation. */
type UnionCandidates = {
  simpleTypes: Map<SimpleTypeName, ConversionType>;
  typesByKind: Map<UnannotatedType['kind'], ConversionType>;
  interfaces: UnionInterfaceCandidate[];
  numeric: ConversionType | undefined;
  string: ConversionType | undefined;
  array: ConversionType | undefined;
  dictionary: AssembledDictionary | undefined;
  callbackFunction: AssembledCallbackFunction | undefined;
  callbackInterface: AssembledCallbackInterface | undefined;
};

/** An interface or proxy candidate paired with its resolved declaration. */
export type UnionInterfaceCandidate = { type: ConversionType; } & (
  { assembled: AssembledInterface; } | { proxy: AssembledProxyObject; }
);

type UnannotatedType = Exclude<WebIDLType, { kind: 'annotated' | 'interface'; }>;
type AnnotatedUnionType = AnnotatedType<UnionType>;

/** Answers that depend only on a descriptor and this assembly's declarations. */
type TypeAnalysis = {
  simpleNames: Set<SimpleTypeName>;
  kinds: Set<WebIDLType['kind']>;
  hasString: boolean;
  hasNumeric: boolean;
  includesNullable: boolean;
  nullableMemberCount: number;
  soleNumericTypeName: SimpleTypeName | undefined;
  sequenceElementType: WebIDLType | undefined;
  recordValueType: WebIDLType | undefined;
};

const jsonSimpleTypeNames = new Set([
  'boolean', 'byte', 'octet', 'short', 'unsigned short', 'long',
  'unsigned long', 'long long', 'unsigned long long', 'float',
  'unrestricted float', 'double', 'unrestricted double', 'DOMString',
  'ByteString', 'USVString', 'object',
]);

const numericTypeNames = new Set<SimpleTypeName>([
  'byte', 'octet', 'short', 'unsigned short', 'long', 'unsigned long',
  'long long', 'unsigned long long', 'float', 'unrestricted float',
  'double', 'unrestricted double',
]);

const stringTypeNames = new Set<SimpleTypeName>([
  'DOMString', 'ByteString', 'USVString',
]);
