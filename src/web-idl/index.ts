export * from './declaration/index';

export { bind } from './projection';
export {
  defineCapability, type Capability, type CapabilityImplementation,
  type CapabilityOptions,
} from './capability';
export { createBindings } from './registration';
export type {
  Bindings, InterfaceRegistrationOptions, RealmBindings,
} from './registration';
export type { WebIDLRealmHost } from './javascript-realm';
