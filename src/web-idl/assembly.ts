import type {
  AnnotatedType, UnionType, BufferTypeName, SimpleTypeName, RecordType, ExtendedAttribute, WebIDLType,
} from './core/types';
import type { Definition } from './core/declarations';
import {
  AssembledInterfaces, AssembledCallbackInterfaces, AssembledCallbackFunctions, AssembledNamespaces,
  AssembledDictionaries, AssembledEnumerations, AssembledTypedefs, AssembledProxyObjects,
  type AssembledDictionary,
} from './assembled';

/**
 * Combines declarations for all realms in one binding world.
 * Assembly finishes during construction; subsequent lookups do not build definitions.
 * Declarations, including their members and types, must remain unchanged afterward.
 */
export class DefinitionAssembly {
  interfaces: AssembledInterfaces;
  callbackInterfaces: AssembledCallbackInterfaces;
  callbackFunctions: AssembledCallbackFunctions;
  namespaces: AssembledNamespaces;
  dictionaries: AssembledDictionaries;
  enumerations: AssembledEnumerations;
  typedefs: AssembledTypedefs;
  proxyObjects: AssembledProxyObjects;

  // A descriptor's aliases and interface references resolve within this assembly.
  // Argument conversion also supplies temporary annotated descriptors, which these caches must not retain.
  #unannotatedTypes = new WeakMap<WebIDLType, UnannotatedType>();
  #conversionTypes = new WeakMap<WebIDLType, ConversionType>();
  #candidateTypes = new WeakMap<WebIDLType, WebIDLType[]>();
  #conversionCandidates = new WeakMap<WebIDLType, ConversionType[]>();
  #overloadTypeKeys = new WeakMap<WebIDLType, string>();
  #conversionTypeKeys = new WeakMap<WebIDLType, string>();

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

  /** Whether the declared type can contribute values to a default toJSON operation. */
  // https://webidl.spec.whatwg.org/#dfn-json-types
  isJSONType(type: WebIDLType, seen = new Set<string>()): boolean {
    const unannotated = this.getUnannotatedType(type);
    switch (unannotated.kind) {
      case 'simple':
        return jsonSimpleTypes.has(unannotated.name);
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

  /** Count nullable members through aliases and nested unions. */
  // https://webidl.spec.whatwg.org/#dfn-number-of-nullable-member-types
  getNumberOfNullableMemberTypes(type: UnionType | AnnotatedUnionType): number {
    const unionType = type.kind === 'annotated' ? type.type : type;
    let numberOfNullableMemberTypes = 0;

    for (let memberType of unionType.types) {
      memberType = this.getUnannotatedType(memberType);
      if (memberType.kind === 'nullable') {
        numberOfNullableMemberTypes++;
        memberType = this.getUnannotatedType(memberType.type);
      }
      if (memberType.kind === 'union') {
        numberOfNullableMemberTypes += this.getNumberOfNullableMemberTypes(memberType);
      }
    }

    return numberOfNullableMemberTypes;
  }

  /** Whether null is included directly or through a union member. */
  // https://webidl.spec.whatwg.org/#dfn-includes-a-nullable-type
  includesNullableType(type: WebIDLType): boolean {
    const innerType = this.getUnannotatedType(type);
    if (innerType.kind === 'nullable') return true;
    return innerType.kind === 'union' &&
      this.getNumberOfNullableMemberTypes(innerType) === 1;
  }

  /** Whether undefined is included directly or through a union member. */
  // https://webidl.spec.whatwg.org/#dfn-includes-undefined
  includesUndefined(type: WebIDLType): boolean {
    const innerType = this.getUnannotatedType(type);
    if (
      innerType.kind === 'simple' &&
      innerType.name === 'undefined'
    ) return true;
    if (innerType.kind === 'nullable') {
      return this.includesUndefined(innerType.type);
    }
    if (innerType.kind === 'union') {
      return innerType.types.some(
        (memberType) => this.includesUndefined(memberType),
      );
    }
    return false;
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

  /** Whether an overload candidate includes a string or enumeration type. */
  hasStringCandidate(type: WebIDLType): boolean {
    return this.getCandidateTypes(type).some((candidate) =>
      candidate.kind === 'simple'
        ? stringTypeNames.has(candidate.name)
        : candidate.kind === 'reference' &&
          this.enumerations.has(candidate.name));
  }

  /** Whether an overload candidate includes a numeric type, excluding bigint. */
  hasNumericCandidate(type: WebIDLType): boolean {
    return this.getCandidateTypes(type).some((candidate) =>
      candidate.kind === 'simple' && numericTypeNames.has(candidate.name));
  }

  /** Match a simple type through aliases, nullable wrappers, and unions. */
  hasSimpleCandidate(type: WebIDLType, name: SimpleTypeName): boolean {
    return this.getCandidateTypes(type).some((candidate) =>
      candidate.kind === 'simple' && candidate.name === name);
  }

  /** Whether an overload candidate includes ArrayBuffer or SharedArrayBuffer. */
  hasArrayBufferCandidate(type: WebIDLType): boolean {
    return this.getCandidateTypes(type).some((candidate) =>
      candidate.kind === 'simple' &&
      arrayBufferTypeNames.has(candidate.name as BufferTypeName));
  }

  /** Match a type kind through aliases, nullable wrappers, and unions. */
  hasCandidateKind(type: WebIDLType, kind: WebIDLType['kind']): boolean {
    return this.getCandidateTypes(type).some((candidate) =>
      candidate.kind === kind);
  }

  /** Whether an overload candidate includes a sequence or frozen array. */
  hasSequenceCandidate(type: WebIDLType): boolean {
    return this.getCandidateTypes(type).some((candidate) =>
      candidate.kind === 'sequence' || candidate.kind === 'frozen-array');
  }

  /** Find a candidate after resolving aliases and flattening nullable types and unions. */
  findCandidateType(
    type: WebIDLType,
    predicate: (candidate: WebIDLType) => boolean,
  ): WebIDLType | undefined {
    return this.getCandidateTypes(type).find(predicate);
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

  /** Whether a resolved conversion candidate is a string or enumeration. */
  isStringCandidate(candidate: ConversionType): boolean {
    return candidate.type.kind === 'simple'
      ? stringTypeNames.has(candidate.type.name)
      : candidate.type.kind === 'reference' &&
        this.enumerations.has(candidate.type.name);
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

  /** Find the single numeric or bigint candidate used to materialize an integer default. */
  getSoleNumericTypeName(type: WebIDLType): SimpleTypeName | undefined {
    const numericTypes = this.getConversionCandidates(type)
      .filter((candidate) => candidate.type.kind === 'simple' && (
        candidate.type.name === 'bigint' ||
        numericTypeNames.has(candidate.type.name)
      ));
    const numericType = numericTypes.length === 1
      ? numericTypes[0]?.type
      : undefined;
    return numericType?.kind === 'simple' ? numericType.name : undefined;
  }

  /** Find a sequence's element type through aliases, nullable wrappers, and unions. */
  findSequenceElementType(type: WebIDLType): WebIDLType | undefined {
    const innerType = this.getUnannotatedType(type);
    switch (innerType.kind) {
      case 'nullable':
        return this.findSequenceElementType(innerType.type);
      case 'union':
        for (const memberType of innerType.types) {
          const elementType = this.findSequenceElementType(memberType);
          if (elementType) return elementType;
        }
        return undefined;
      case 'sequence':
        return innerType.type;
      default:
        return undefined;
    }
  }

  /** Find an assembled dictionary or record type for a converted Map value. */
  findDictionaryOrRecord(type: WebIDLType): AssembledDictionary | RecordType | undefined {
    const innerType = this.getUnannotatedType(type);
    switch (innerType.kind) {
      case 'nullable':
        return this.findDictionaryOrRecord(innerType.type);
      case 'union':
        for (const memberType of innerType.types) {
          const candidate = this.findDictionaryOrRecord(memberType);
          if (candidate) return candidate;
        }
        return undefined;
      case 'record':
        return innerType;
      case 'reference':
        return this.dictionaries.get(innerType.name);
      default:
        return undefined;
    }
  }

  /** Resolve aliases and annotations before selecting an observable array's element type. */
  getObservableArrayElementType(type: WebIDLType): WebIDLType | undefined {
    const resolved = this.getUnannotatedType(type);
    return resolved.kind === 'observable-array'
      ? resolved.type
      : undefined;
  }
}

/** A type with aliases resolved and its ordered conversion attributes retained. */
export type ConversionType = {
  extendedAttributes: ExtendedAttribute[];
  type: UnannotatedType;
};

type UnannotatedType = Exclude<WebIDLType, { kind: 'annotated' | 'interface'; }>;
type AnnotatedUnionType = AnnotatedType<UnionType>;

const jsonSimpleTypes = new Set([
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

const arrayBufferTypeNames = new Set<BufferTypeName>([
  'ArrayBuffer', 'SharedArrayBuffer',
]);
