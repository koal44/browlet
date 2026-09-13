// Project entry point for standalone declarations and exception requests.
export {
  createDOMException, DOMExceptionCodes, DOMExceptionNames, throwDOMException,
  type DOMExceptionName,
} from './dom-exception-core';

export {
  defineInterface, definePartialInterface, impl, constructWith, ctor,
  iter, asyncIter, maplike, setlike, indexedGetter, namedGetter,
} from './definitions/interface';
export type {
  InterfaceDefinition, PartialInterfaceDefinition, InterfaceMember,
  ImplementationOptions, ConstructorMember, IterableMember, AsyncIterableMember,
  MaplikeMember, SetlikeMember, IndexedGetterDeclaration, IndexedPropertySupport,
  SupportedPropertyNamesSteps,
} from './definitions/interface';
export { defineInterfaceMixin, definePartialInterfaceMixin } from './definitions/interface-mixin';
export type {
  InterfaceMixinDefinition, PartialInterfaceMixinDefinition, MixinMember,
} from './definitions/interface-mixin';
export { defineCallbackInterface } from './definitions/callback-interface';
export type { CallbackInterfaceDefinition } from './definitions/callback-interface';
export { defineNamespace, definePartialNamespace } from './definitions/namespace';
export type {
  NamespaceDefinition, PartialNamespaceDefinition, NamespaceMember,
} from './definitions/namespace';
export { defineDictionary, definePartialDictionary, dictMember } from './definitions/dictionary';
export type {
  DictionaryDefinition, PartialDictionaryDefinition, DictionaryMember,
} from './definitions/dictionary';
export { defineEnumeration } from './definitions/enumeration';
export { defineCallbackFunction } from './definitions/callback-function';
export type { CallbackFunctionDefinition } from './definitions/callback-function';
export { defineTypedef } from './definitions/typedef';
export { defineIncludes } from './definitions/includes';
export type { IncludesDefinition } from './definitions/includes';

export {
  annotated, arg, asyncSequence, attr, constant, decimal, emptyDictionary, emptySequence,
  frozenArray, idlType, integer, negativeInfinity, notANumber, nullable, observableArray, op,
  positiveInfinity, promise, roAttr, record, reference, sequence, staticOp, stringifier, undefinedDefault,
  union, xattr,
} from './definition';
export type {
  AnnotatedType, ArgumentDefinition, AsyncSequenceType, AttributeMember, BufferTypeName,
  BufferViewTypeName, ConstantMember, ConstantValue, DefaultValue, Definition, Exposure,
  ExtendedAttribute, NamedArgumentsExtendedAttribute, OperationMember, SimpleTypeName,
  StringifierMember, UnionType, WebIDLType,
} from './definition';
export {
  atArg, attrFn, callbackDictionary, invokeWith, newBufferResult, onError, unwrapArg,
} from './binding';
export type {
  CallbackExceptionBehavior, ImplementationClass, InjectedArgument,
} from './binding';
export {
  serializeDefinition, serializeDefinitions, serializeExtendedAttribute, serializeMember, serializeType,
} from './serialize';
