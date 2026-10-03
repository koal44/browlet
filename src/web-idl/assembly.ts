import { annotated, hasExtendedAttribute, sequence } from './core/index';
import type {
  AnnotatedType, UnionType, SimpleTypeName, SequenceType, ExtendedAttribute, WebIDLType, IntegerLiteral,
  Definition,
} from './core/index';

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
  #unannotatedTypes = new Map<WebIDLType, ResolvedType>();
  /** Conversion rules and annotated nullable/union branches prepared for each type descriptor. */
  #conversionRules = new Map<WebIDLType, ConversionRules>();
  /** Flattened union candidates with nullable wrappers and annotations removed. */
  #candidateTypes = new Map<WebIDLType, WebIDLType[]>();
  /** Flattened union candidates retaining their conversion attributes. */
  #conversionCandidates = new Map<WebIDLType, ConversionRules[]>();
  /** Category lookups used to select a union branch from an incoming value. */
  #unionCandidates = new Map<WebIDLType, UnionCandidates>();

  /** Type categories, nullability, and container element types computed on first inspection. */
  #typeAnalyses = new Map<WebIDLType, TypeAnalysis>();
  /** Completed JSON-type checks; incomplete recursive dictionary checks are not retained. */
  #jsonTypeResults = new Map<WebIDLType, boolean>();
  /** Whether IDL values can reach implementations without unpacking or callback binding. */
  #directImplTypes = new Map<WebIDLType, boolean>();
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
  getUnannotatedType(type: WebIDLType): ResolvedType {
    const cached = this.#unannotatedTypes.get(type);
    if (cached) return cached;
    const resolved = this.typedefs.resolve(type);
    const unannotated = resolved.kind === 'interface'
      ? this.interfaces.getReference(resolved.implClass)
      : resolved;
    this.#unannotatedTypes.set(type, unannotated);
    return unannotated;
  }

  /** Resolve aliases and prepare fixed conversion rules, including inherited branch annotations. */
  getConversionRules<Type extends WebIDLType>(type: Type): ConversionRules<Type> {
    const cached = this.#conversionRules.get(type);
    if (cached) return cached as ConversionRules<Type>;
    const extendedAttributes: ExtendedAttribute[] = [];
    let resolved = this.typedefs.resolve(type, extendedAttributes);
    while (resolved.kind === 'interface') {
      resolved = this.typedefs.resolve(this.interfaces.getReference(resolved.implClass), extendedAttributes);
    }

    // Nullable and union conversion inherit the enclosing annotations. Retain
    // these use-specific descriptors once; container contents keep their own types.
    if (extendedAttributes.length) {
      if (resolved.kind === 'nullable') {
        resolved = { kind: 'nullable', type: annotated(resolved.type, { extendedAttributes }) };
      } else if (resolved.kind === 'union') {
        const types: UnionType['types'] = [...resolved.types];
        let index = 0;
        for (const member of resolved.types) {
          types[index++] = annotated(member, { extendedAttributes });
        }
        resolved = { kind: 'union', types };
      }
    }
    const rules: ConversionRules<Type> = {
      declaredType: type,
      resolvedType: resolved,
      extendedAttributes,
      integerMode: hasExtendedAttribute(extendedAttributes, 'EnforceRange') ? 'enforce-range'
        : hasExtendedAttribute(extendedAttributes, 'Clamp') ? 'clamp' : 'wrap',
      allowShared: hasExtendedAttribute(extendedAttributes, 'AllowShared'),
      allowResizable: hasExtendedAttribute(extendedAttributes, 'AllowResizable'),
      nullToEmptyString: hasExtendedAttribute(extendedAttributes, 'LegacyNullToEmptyString'),
    };
    this.#conversionRules.set(type, rules);
    return rules;
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
  getConversionCandidates(type: WebIDLType): ConversionRules[] {
    const cached = this.#conversionCandidates.get(type);
    if (cached) return cached;
    const rules = this.getConversionRules(type);
    let candidates: ConversionRules[];
    if (rules.resolvedType.kind === 'nullable') {
      candidates = this.getConversionCandidates(rules.resolvedType.type);
    } else if (rules.resolvedType.kind === 'union') {
      candidates = [];
      for (const member of rules.resolvedType.types) {
        candidates.push(...this.getConversionCandidates(member));
      }
    } else {
      candidates = [rules];
    }
    this.#conversionCandidates.set(type, candidates);
    return candidates;
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
      const inner = candidate.resolvedType;
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
            candidates.interfaces.push({ rules: candidate, assembled });
          } else {
            const proxy = this.proxyObjects.get(inner.name);
            if (proxy) candidates.interfaces.push({ rules: candidate, proxy });
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
    const unannotated = this.getUnannotatedType(type);
    const { extendedAttributes } = this.getConversionRules(type);
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

  /** Whether values of this type can pass directly from IDL to implementation code. */
  // Only primitives and sequences of primitives bypass inspection. References,
  // records, and other objects can need unwrapping, binding, or nested conversion.
  canPassToImpl(type: WebIDLType): boolean {
    const cached = this.#directImplTypes.get(type);
    if (cached !== undefined) return cached;
    const direct = this.getCandidateTypes(type).every((candidate) => {
      if (candidate.kind === 'sequence') return this.canPassToImpl(candidate.type);
      return this.isPrimitiveType(candidate);
    });
    this.#directImplTypes.set(type, direct);
    return direct;
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

  /** The nullable callback whose attribute assignment accepts non-callable objects. */
  // https://webidl.spec.whatwg.org/#LegacyTreatNonObjectAsNull
  getNullableLegacyCallback(type: WebIDLType): AssembledCallbackFunction | null {
    const nullableType = this.getConversionRules(type).resolvedType;
    if (nullableType.kind !== 'nullable') return null;
    const callbackType = this.getConversionRules(nullableType.type).resolvedType;
    if (callbackType.kind !== 'reference') return null;
    const assembled = this.callbackFunctions.get(callbackType.name);
    return assembled?.treatsNonObjectAsNull() ? assembled : null;
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

/** A declared type's fixed conversion rules, shared by converters across bindings and realms. */
export interface ConversionRules<Type extends WebIDLType = WebIDLType> {
  /** Descriptor whose aliases and annotations produced these rules. */
  declaredType: Type;
  /** Type after resolving outer aliases and annotations; nested branches retain their own rules. */
  resolvedType: ResolvedType;
  /** Ordered annotations retained for descriptor comparison and diagnostics. */
  extendedAttributes: ExtendedAttribute[];
  /** Integer overflow and rounding behavior selected by Clamp or EnforceRange. */
  integerMode: IntegerConversionMode;
  /** Whether buffer conversion accepts shared backing memory. */
  allowShared: boolean;
  /** Whether buffer conversion accepts resizable or growable backing memory. */
  allowResizable: boolean;
  /** Whether string conversion maps null to the empty string. */
  nullToEmptyString: boolean;
}

/** Outer aliases and annotations are resolved, and implementation classes become named references. */
export type ResolvedType = Exclude<WebIDLType, { kind: 'annotated' | 'interface'; }>;

/** How an integer conversion handles values outside its declared range. */
export type IntegerConversionMode = 'wrap' | 'clamp' | 'enforce-range';

/** Fixed choices used by union conversion; recognizing the incoming value remains a binding operation. */
type UnionCandidates = {
  simpleTypes: Map<SimpleTypeName, ConversionRules>;
  typesByKind: Map<ResolvedType['kind'], ConversionRules>;
  interfaces: UnionInterfaceCandidate[];
  numeric: ConversionRules | undefined;
  string: ConversionRules | undefined;
  array: ConversionRules | undefined;
  dictionary: AssembledDictionary | undefined;
  callbackFunction: AssembledCallbackFunction | undefined;
  callbackInterface: AssembledCallbackInterface | undefined;
};

/** An interface or proxy candidate paired with its resolved declaration. */
export type UnionInterfaceCandidate = { rules: ConversionRules; } & (
  { assembled: AssembledInterface; } | { proxy: AssembledProxyObject; }
);

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
