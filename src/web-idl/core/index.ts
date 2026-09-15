// Project entry point for standalone declarations and DOM exceptions.
export {
  createDOMException, DOMExceptionCodes, DOMExceptionNames, throwDOMException,
  type DOMExceptionName,
} from './dom-exception';

export {
  defineInterface, definePartialInterface, defineInterfaceMixin, definePartialInterfaceMixin,
  defineIncludes, defineDictionary, definePartialDictionary, defineNamespace, definePartialNamespace,
  defineCallbackInterface, defineCallbackFunction, defineEnumeration, defineTypedef,
} from './declarations';
export type {
  InterfaceDefinition, PartialInterfaceDefinition, InterfaceMember, ConstructorMember,
  IterableMember, AsyncIterableMember, MaplikeMember, SetlikeMember,
  InterfaceMixinDefinition, PartialInterfaceMixinDefinition, MixinMember, IncludesDefinition,
  DictionaryDefinition, PartialDictionaryDefinition, DictionaryMember,
  NamespaceDefinition, PartialNamespaceDefinition, NamespaceMember,
  CallbackInterfaceDefinition, CallbackFunctionDefinition, Definition,
} from './declarations';

export {
  ctor, attr, roAttr, attrFn, op, staticOp, arg, dictMember, constant, stringifier,
  iter, asyncIter, maplike, setlike, indexedGetter, namedGetter,
  reference, nullable, union, sequence, asyncSequence, record, promise,
  frozenArray, observableArray, annotated,
  integer, decimal, xattr,
  impl, atArg, invokeWith, newBufferResult, unwrapArg, cbDict, onError,
} from './helpers';

export {
  idlType, positiveInfinity, negativeInfinity, notANumber,
  undefinedDefault, emptySequence, emptyDictionary,
} from './types';
export type {
  ConstantMember, AttributeMember, OperationMember, StringifierMember, ArgumentDefinition,
  WebIDLType, AnnotatedType, AsyncSequenceType, UnionType,
  SimpleTypeName, BufferTypeName, BufferViewTypeName, ConstantValue, DefaultValue,
  PositiveInfinity, NegativeInfinity, NotANumber, UndefinedDefault, EmptySequence, EmptyDictionary,
  Exposure, ExtendedAttribute, NamedArgumentsExtendedAttribute,
  ImplementationClass, InjectedArgument, CallbackExceptionBehavior,
  IndexedGetterDeclaration, SupportedPropertyNamesSteps,
} from './types';

export {
  serializeDefinition, serializeDefinitions, serializeExtendedAttribute, serializeMember, serializeType,
} from './serialize';
