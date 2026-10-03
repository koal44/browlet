// Project entry point for standalone declarations and DOM exceptions.
export {
  createDOMException, DOMExceptionCodes, DOMExceptionNames, throwDOMException,
  DOMExceptionImpl, DOMExceptionStamper, QuotaExceededErrorImpl, domExceptionIDL, isDOMException,
  quotaExceededErrorIDL, quotaExceededErrorOptionsIDL,
  type DOMExceptionName,
} from './dom-exception';

export {
  allowSharedBufferSourceIDL, arrayBufferViewIDL, bufferSourceIDL,
  functionIDL, voidFunctionIDL, webIDLCommonDefinitions,
} from './common';

export {
  defineInterface, definePartialInterface, defineInterfaceMixin, definePartialInterfaceMixin,
  defineIncludes, defineDictionary, definePartialDictionary, defineNamespace, definePartialNamespace,
  defineCallbackInterface, defineCallbackFunction, defineEnumeration, defineTypedef, defineProxyObject,
} from './declarations';
export type {
  PrimaryInterfaceDefinition, PartialInterfaceDefinition, InterfaceMember, ConstructorMember,
  IterableMember, AsyncIterableMember, MaplikeMember, SetlikeMember,
  InterfaceMixinDefinition, PartialInterfaceMixinDefinition, MixinMember, IncludesDefinition,
  DictionaryDefinition, PartialDictionaryDefinition, DictionaryMember,
  NamespaceDefinition, PartialNamespaceDefinition, NamespaceMember,
  CallbackInterfaceDefinition, CallbackFunctionDefinition, ProxyObjectDefinition, Definition,
  EnumerationDefinition, TypedefDefinition,
} from './declarations';

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
  ConstantMember, AttributeMember, AttributeFunctionSteps, OperationMember, StringifierMember, ArgumentDefinition,
  WebIDLType, AnnotatedType, AsyncSequenceType, NullableType, UnionType,
  SimpleType, StringType, ReferenceType, SequenceType, FrozenArrayType, RecordType, PromiseType, IntegerLiteral,
  SimpleTypeName, BufferTypeName, BufferViewTypeName, ConstantValue, DefaultValue,
  PositiveInfinity, NegativeInfinity, NotANumber, UndefinedDefault, EmptySequence, EmptyDictionary,
  Exposure, ExtendedAttribute, NamedArgumentsExtendedAttribute,
  ImplementationClass, ImplementationType, InjectedArgument, CallbackExceptionBehavior,
  IndexedGetterDeclaration, SupportedPropertyNamesSteps,
} from './types';

export {
  serializeDefinition, serializeDefinitions, serializeExtendedAttribute, serializeMember, serializeType,
} from './serialize';

export type {
  SerialSteps, TransferSteps, StructuredDataRecord,
  SerializationContext, DeserializationContext,
} from './structured-data';
