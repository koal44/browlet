import { InternalError, type PromiseResult, type PromiseResultType, type ResultValue } from '../../infra/index';
import {
  hasExtendedAttribute, idlType, type ExtendedAttribute, type WebIDLType,
  type IntegerLiteral, type Definition,
} from '../core/index';

import {
  type IDLType, IDLAnyType, IDLUndefinedType, IDLBooleanType, IDLBigIntType, IDLObjectType, IDLSymbolType,
  IDLStringType, IDLBufferType, IDLUnionType, IDLNullableType,
  IDLPromiseType, IDLObservableArrayType, IDLIntegerType, IDLFloatType, IDLEnumerationType, IDLSequenceType,
  IDLFrozenArrayType, IDLAsyncSequenceType, IDLRecordType, IDLDictionaryType, IDLCallbackFunctionType,
  IDLCallbackInterfaceType, IDLInterfaceType, IDLProxyType,
} from './types';
import { AssembledInterfaces } from './interface';
import { AssembledCallbackInterfaces, AssembledCallbackFunctions } from './callback';
import { AssembledNamespaces } from './namespace';
import { AssembledDictionaries } from './dictionary';
import { AssembledEnumerations } from './enumeration';
import { AssembledTypedefs } from './typedef';
import { AssembledProxyObjects } from './proxy-object';

/**
 * Combines declarations for all realms in one binding world.
 * Definitions finish assembly during construction; type uses are assembled and cached on demand.
 * Inputs must be valid declarations; validateDefinitions() checks them separately during development.
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

  /** Derived sequence descriptors reused by aggregate and observable-array conversions. */
  #sequenceTypesByElementType = new Map<IDLType, IDLSequenceType>();
  /** Parsed integer literals; applying a member's numeric type still happens separately. */
  #integerLiteralValues = new Map<IntegerLiteral, bigint>();

  constructor(definitions: Definition[]) {
    // Member types can name later declarations or their own enclosing construct.
    // Index every named target before compiling those types; discard these steps afterward.
    const finish: AssemblySteps[] = [];
    this.interfaces = new AssembledInterfaces(definitions, finish);
    this.callbackInterfaces = new AssembledCallbackInterfaces(definitions, finish);
    this.callbackFunctions = new AssembledCallbackFunctions(definitions, finish);
    this.namespaces = new AssembledNamespaces(definitions, finish);
    this.dictionaries = new AssembledDictionaries(definitions, finish);
    this.enumerations = new AssembledEnumerations(definitions);
    this.typedefs = new AssembledTypedefs(definitions);
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
      type = new IDLSequenceType(elementType);
      this.#sequenceTypesByElementType.set(elementType, type);
    }
    return type;
  }

  /** Resolve aliases and annotations before selecting an observable array's element type. */
  getObservableArrayElementType(type: IDLType): IDLType | undefined {
    return type.kind === 'observable-array'
      ? type.elementType
      : undefined;
  }

  #assembleType(type: WebIDLType, inheritedAttributes?: ExtendedAttribute[]): IDLType {
    const attributes = inheritedAttributes ? [...inheritedAttributes] : [];
    const resolved = this.typedefs.resolve(type, attributes);
    switch (resolved.kind) {
      case 'simple': {
        const { name } = resolved;
        switch (name) {
          case 'byte': case 'octet': case 'short': case 'unsigned short':
          case 'long': case 'unsigned long': case 'long long': case 'unsigned long long':
            return new IDLIntegerType(name,
              hasExtendedAttribute(attributes, 'EnforceRange') ? 'enforce-range'
                : hasExtendedAttribute(attributes, 'Clamp') ? 'clamp' : 'wrap', attributes);
          case 'float': case 'unrestricted float': case 'double': case 'unrestricted double':
            return new IDLFloatType(name, attributes);
          case 'DOMString': case 'ByteString': case 'USVString':
            return new IDLStringType(name, hasExtendedAttribute(attributes, 'LegacyNullToEmptyString'), attributes);
          case 'any': return new IDLAnyType(attributes);
          case 'undefined': return new IDLUndefinedType(attributes);
          case 'boolean': return new IDLBooleanType(attributes);
          case 'bigint': return new IDLBigIntType(attributes);
          case 'object': return new IDLObjectType(attributes);
          case 'symbol': return new IDLSymbolType(attributes);
          default:
            return new IDLBufferType(name, hasExtendedAttribute(attributes, 'AllowShared'),
              hasExtendedAttribute(attributes, 'AllowResizable'), attributes);
        }
      }
      case 'interface':
        return new IDLInterfaceType(this.interfaces.getType(resolved.implClass).assembled, attributes);
      case 'reference': {
        const name = resolved.name;
        const assembled = this.interfaces.get(name);
        if (assembled) return new IDLInterfaceType(assembled, attributes);
        const dictionary = this.dictionaries.get(name);
        if (dictionary) return new IDLDictionaryType(dictionary, attributes);
        const enumeration = this.enumerations.get(name);
        if (enumeration) return new IDLEnumerationType(enumeration, attributes);
        const callbackFunction = this.callbackFunctions.get(name);
        if (callbackFunction) return new IDLCallbackFunctionType(callbackFunction, attributes);
        const callbackInterface = this.callbackInterfaces.get(name);
        if (callbackInterface) return new IDLCallbackInterfaceType(callbackInterface, attributes);
        const proxy = this.proxyObjects.get(name);
        if (proxy) return new IDLProxyType(proxy, attributes);
        throw new InternalError(this.namespaces.has(name)
          ? `${name} is not a value type` : `Unknown Web IDL type ${name}`);
      }
      case 'nullable':
        return new IDLNullableType(attributes.length
          ? this.#assembleType(resolved.type, attributes) : this.getIDLType(resolved.type), attributes);
      case 'union':
        return new IDLUnionType(resolved.types.map((member) => attributes.length
          ? this.#assembleType(member, attributes) : this.getIDLType(member)), attributes);
      case 'sequence': return new IDLSequenceType(this.getIDLType(resolved.type), attributes);
      case 'async-sequence': return new IDLAsyncSequenceType(this.getIDLType(resolved.type), attributes);
      case 'frozen-array': return new IDLFrozenArrayType(this.getIDLType(resolved.type), attributes);
      case 'observable-array': return new IDLObservableArrayType(this.getIDLType(resolved.type), attributes);
      case 'promise': return new IDLPromiseType(this.getIDLType(resolved.type), attributes);
      case 'record':
        // The declaration contract restricts record keys to the three string types.
        return new IDLRecordType(this.getIDLType(resolved.key), this.getIDLType(resolved.value), attributes);
    }
  }
}

/** Construction work held only until the assembly has indexed all named definitions. */
export type AssemblySteps = (assembly: DefinitionAssembly) => void;

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
          : Type extends { kind: 'nullable'; type: infer Inner extends WebIDLType; } ? IDLNullableType<TypeFromDeclaration<Inner>>
            : Type extends { kind: 'union'; types: (infer Member extends WebIDLType)[]; } ? IDLUnionType<TypeFromDeclaration<Member>>
              : Type extends { kind: 'sequence'; type: infer Element extends WebIDLType; } ? IDLSequenceType<TypeFromDeclaration<Element>>
                : Type extends { kind: 'async-sequence'; type: infer Element extends WebIDLType; } ? IDLAsyncSequenceType<TypeFromDeclaration<Element>>
                  : Type extends { kind: 'frozen-array'; type: infer Element extends WebIDLType; } ? IDLFrozenArrayType<TypeFromDeclaration<Element>>
                    : Type extends { kind: 'observable-array'; } ? IDLObservableArrayType
                      : Type extends { kind: 'record'; value: infer Value extends WebIDLType; } ? IDLRecordType<TypeFromDeclaration<Value>>
                        : Type extends { kind: 'promise'; type: infer Result extends WebIDLType; } ? IDLPromiseType<TypeFromDeclaration<Result>>
                          : IDLType;
