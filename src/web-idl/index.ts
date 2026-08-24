export * from './declaration/index';

export { bind } from './projection';
export { registerInterfaceBindings } from './registration';
export type {
  InterfaceBindingDomain, RegisteredRealmInterfaceBindings,
} from './registration';
export type { WebIDLRealmHost } from './javascript-realm';
