import type { JSFunction } from '../../js-engine/index';

import type { WebIDLEnvironment } from '../environment';
import type { AssembledInterface, IDLAttribute } from '../assembly/index';
import type { PlatformRecord } from './platform';

import type { BindingContext } from './world';
import type { SecurityCheckType } from './realm';

/** Specification-owned annotation behavior supplied when composing a binding world. */
export type ExtendedAttributeHooks<Env extends WebIDLEnvironment = WebIDLEnvironment> = {
  /** Prepare reflected accessors once, after type resolution, for each declaring or including interface. */
  prepareReflectedAttribute?: (
    attribute: IDLAttribute, owners: AssembledInterface[],
  ) => Map<AssembledInterface, AttributeBinding<Env>> | undefined;
  /** Prepare HTML's overridden constructor steps for an annotated interface. */
  prepareHTMLConstructor?: (owner: AssembledInterface) => HTMLConstructorBinding<Env> | undefined;
  /** Prepare an annotated interface's invocation policy, selected by the actual receiver. */
  prepareSecurityCheck?: (owner: AssembledInterface) => SecurityCheckBinding<Env> | undefined;
};

/** A security check receives the invoked function's binding and the actual platform receiver's record. */
export type SecurityCheckBinding<Env extends WebIDLEnvironment = WebIDLEnvironment> = (
  ctx: BindingContext<Env>, receiver: Readonly<PlatformRecord>, identifier: string, type: SecurityCheckType,
) => void;

/** HTML receives the invoking realm's binding and ECMAScript constructor identities. */
export type HTMLConstructorBinding<Env extends WebIDLEnvironment = WebIDLEnvironment> = (
  ctx: BindingContext<Env>, newTarget: JSFunction | undefined, activeFunction: JSFunction,
) => object;

/** Accessors receive the validated receiver and its binding; getters also receive the method binding. */
export type AttributeBinding<Env = unknown, Receiver extends object | null = object | null> = {
  get: (
    this: Receiver, ctx: BindingContext<Env & WebIDLEnvironment>, methodCtx: BindingContext<Env & WebIDLEnvironment>,
  ) => unknown;
  set?: (this: Receiver, ctx: BindingContext<Env & WebIDLEnvironment>, value: unknown) => void;
};
