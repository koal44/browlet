// Project entry point for standalone declarations and DOM exceptions.
export {
  DOMExceptionCodes, DOMExceptionNames,
  DOMExceptionImpl, DOMExceptionStamper, QuotaExceededErrorImpl, domExceptionIDL, isDOMException,
  quotaExceededErrorIDL, quotaExceededErrorOptionsIDL,
  type DOMExceptionName,
} from './dom-exception';

export {
  allowSharedBufferSourceIDL, arrayBufferViewIDL, bufferSourceIDL,
  functionIDL, voidFunctionIDL, webIDLCommonDefinitions,
  type BufferSource, type VoidFunction,
} from './common';

export {
  defineInterface, definePartialInterface, defineInterfaceMixin, definePartialInterfaceMixin,
  defineIncludes, defineDictionary, definePartialDictionary, defineNamespace, definePartialNamespace,
  defineCallbackInterface, defineCallbackFunction, defineEnumeration, defineTypedef, defineProxyObject,
} from './declarations';
export type {
  PrimaryInterfaceDefinition, PartialInterfaceDefinition,
  InterfaceMixinDefinition, PartialInterfaceMixinDefinition, IncludesDefinition,
  DictionaryDefinition, PartialDictionaryDefinition,
  NamespaceDefinition, PartialNamespaceDefinition,
  CallbackInterfaceDefinition, CallbackFunctionDefinition, ProxyObjectDefinition, Definition,
  EnumerationDefinition, TypedefDefinition,
} from './declarations';

export type {
  InterfaceMember, MixinMember, NamespaceMember, ConstructorMember,
  ConstantMember, AttributeMember, AttributeFunctionSteps, OperationMember, StringifierMember,
  IterableMember, AsyncIterableMember, MaplikeMember, SetlikeMember,
  DictionaryMember, ArgumentDefinition, IndexedGetterDeclaration, SupportedPropertyNamesSteps,
} from './members';

export {
  ctor, attr, roAttr, attrFn, op, staticOp, arg, dictMember, constant, stringifier,
  iter, asyncIter, maplike, setlike, indexedGetter, namedGetter,
  reference, implementationType, nullable, union, sequence, asyncSequence, record, promise,
  frozenArray, observableArray, annotated,
  integer, decimal, xattr,
  impl, atArg, invokeWith, unwrapArg, cbDict, onError, hasExtendedAttribute,
} from './helpers';

export {
  idlType, positiveInfinity, negativeInfinity, notANumber,
  undefinedDefault, emptySequence, emptyDictionary,
} from './types';
export type {
  WebIDLType, AnnotatedType, AsyncSequenceType, NullableType, UnionType,
  SimpleType, StringType, ReferenceType, SequenceType, FrozenArrayType, RecordType, PromiseType, IntegerLiteral,
  SimpleTypeName, BufferTypeName, BufferViewTypeName, ConstantValue, DefaultValue,
  PositiveInfinity, NegativeInfinity, NotANumber, UndefinedDefault, EmptySequence, EmptyDictionary,
  Exposed, ExtendedAttribute, NamedArgumentsExtendedAttribute,
  ImplementationClass, ImplementationType, InjectedArgument, CallbackExceptionBehavior,
} from './types';

export {
  serializeDefinition, serializeDefinitions, serializeExtendedAttribute, serializeMember, serializeType,
} from './serialize';

export type {
  SerialSteps, TransferSteps, StructuredDataRecord,
  SerializationContext, DeserializationContext,
} from './structured-data';
