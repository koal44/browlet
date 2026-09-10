export * from './declaration/index';

export { bind, bindingContext, runtimeContext } from './projection';
export type { BindingContext } from './projection';
export {
  defineCapability, type Capability, type CapabilityRegistration,
  type CapabilityOptions,
} from './capability';
export { createBindings } from './registration';
export type {
  BindingOptions, BindingWorld, RealmBindingOptions, RealmBindings,
} from './registration';
export type { WebIDLRealmHost } from './javascript-realm';
export type { GlobalObjectAllocation } from './binding';
