import type { WebIDLEnvironment, WebIDLRealm } from './environment';
import type { BindingContext } from './binding/world';

export * from './core/index';

export type { BindingContext };
export { BindingWorld, type BindingWorldOptions } from './binding/world';
export type {
  AttributeBinding, ExtendedAttributeHooks, HTMLConstructorBinding, SecurityCheckBinding,
} from './binding/extended-attributes';
export type { AssembledInterface, IDLAttribute, IDLFrozenArrayType, IDLInterfaceType, IDLType } from './assembly/index';
export { matchesExposure } from './assembly/index';
export type { WebIDLEnvironment, WebIDLRealm };
export type { CallbackHooks } from './environment';
export type { GlobalObjectAllocation, SecurityCheckType } from './binding/realm';
export { isArrayIndex } from './binding/realm/legacy';
export {
  isStampedImplInstance, isStampedPlatformObject, getImplementationObject,
  type StampedImplInstance, type StampedPlatformObject, type PlatformRecord,
} from './binding/platform';
