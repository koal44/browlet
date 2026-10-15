import type { WebIDLEnvironment } from '../environment';
import type { AssembledInterface, IDLAttribute } from '../assembly/index';

import type { BindingContext } from './world';

/** Specification-owned annotation behavior supplied when composing a binding world. */
export type ExtendedAttributeHooks<Env extends WebIDLEnvironment = WebIDLEnvironment> = {
  /** Prepare reflected accessors once, after type resolution, for each declaring or including interface. */
  prepareReflectedAttribute?: (
    attribute: IDLAttribute, owners: AssembledInterface[],
  ) => Map<AssembledInterface, AttributeBinding<Env>> | undefined;
};

/** Accessors receive the validated implementation receiver, converted values, and its binding context. */
export type AttributeBinding<Env = unknown, Receiver extends object | null = object | null> = {
  get: (this: Receiver, ctx: BindingContext<Env & WebIDLEnvironment>) => unknown;
  set?: (this: Receiver, ctx: BindingContext<Env & WebIDLEnvironment>, value: unknown) => void;
};
