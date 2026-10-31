import type { JSFunction } from '../../js-engine/index';

import type { WebIDLEnvironment } from '../environment';
import type { AssembledInterface, IDLAttribute } from '../assembly/index';
import type { PlatformRecord } from './platform';

import type { BindingContext } from './world';
import type { SecurityCheckType } from './realm';

/** Specification-owned binding behavior supplied when composing a binding world. */
export type ExtendedAttributeHooks<Env extends WebIDLEnvironment = WebIDLEnvironment> = {
  /** Prepare accessors once, after type resolution, for each declaring or including interface. */
  prepareAttribute?: (
    attribute: IDLAttribute, owners: AssembledInterface[],
  ) => Map<AssembledInterface, AttributeBinding<Env>> | undefined;
  /** Prepare HTML's overridden constructor steps for an annotated interface. */
  prepareHTMLConstructor?: (owner: AssembledInterface) => HTMLConstructorBinding<Env> | undefined;
  /** Prepare an annotated interface's invocation policy, selected by the actual receiver. */
  prepareSecurityCheck?: (owner: AssembledInterface) => SecurityCheckBinding<Env> | undefined;
  /** Prepare additional creation steps after own IDL members, before platform identity is attached. */
  preparePlatformObject?: (owner: AssembledInterface) => PlatformObjectBinding<Env> | undefined;
};

/** Finish an allocation, optionally replacing it with a specification-owned exotic object. */
export type PlatformObjectBinding<Env extends WebIDLEnvironment = WebIDLEnvironment> = (
  ctx: BindingContext<Env>, object: object,
) => object;

/** A security check receives the invoked function's binding and the actual platform receiver's record. */
export type SecurityCheckBinding<Env extends WebIDLEnvironment = WebIDLEnvironment> = (
  ctx: BindingContext<Env>, receiver: Readonly<PlatformRecord>, identifier: string, type: SecurityCheckType,
) => void;

/** HTML receives the invoking realm's binding and ECMAScript constructor identities. */
export type HTMLConstructorBinding<Env extends WebIDLEnvironment = WebIDLEnvironment> = (
  ctx: BindingContext<Env>, newTarget: JSFunction | undefined, activeFunction: JSFunction,
) => object;

/** Prepared extended-attribute accessors, called after receiver validation and value conversion. */
export type AttributeBinding<Env = unknown, Receiver extends object | null = object | null> = {
  /** May forward a custom declaration getter, including its method and incumbent environments (ReflectSetter). */
  get: (
    this: Receiver, ctx: BindingContext<Env & WebIDLEnvironment>, methodCtx: BindingContext<Env & WebIDLEnvironment>,
    incumbentEnv: Env | undefined,
  ) => unknown;
  /** Runs the prepared reflection setter; custom declaration setters use AttributeMember.set instead. */
  set?: (this: Receiver, ctx: BindingContext<Env & WebIDLEnvironment>, value: unknown) => void;
};
