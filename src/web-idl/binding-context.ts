import type { InternalPromise } from '../infra/promises';
import type { AssembledInterfaceDefinition } from './assembly';
import type { GlobalObjectAllocation, RealmBinding } from './realm-binding';
import type { ImplementationClass, WebIDLType } from './core/types';
import type { InterfaceDefinition } from './core/declarations';
import { convertToIDL, convertToJavaScript } from './conversion';
import type { WebIDLEnvironment } from './realm';
import {
  getImplementationRecord, getPlatformRecord, stampImplementation, type StampedImplInstance,
  type StampedPlatformObject, type PlatformRecord,
} from './platform-object';
import {
  adaptIDLToImpl, constructImplementationObject, resolveImplementationArguments,
} from './implementation-binding';
import { InternalError } from '../infra/internal-error';
import { createWebIDLPromiseConstructor } from './promise';

/** A realm's Web IDL operations and environment within one binding world. */
export class BindingContext<Env extends WebIDLEnvironment = WebIDLEnvironment> {
  realm: Env['realm'];
  Promise: typeof InternalPromise;
  #binding: RealmBinding<Env>;
  #env: Env | undefined;

  // Project helper: retain a realm binding and compose its environment.
  constructor(
    binding: RealmBinding<Env>,
    createEnvironment: (ctx: BindingContext<Env>) => Env,
  ) {
    this.realm = binding.realm;
    this.#binding = binding;
    this.Promise = createWebIDLPromiseConstructor(this);
    this.#env = createEnvironment(this);
    if (this.#env.realm !== this.realm) {
      throw new InternalError('The binding environment belongs to a different realm');
    }
  }

  /** The realm's original DOMException constructor, independent of its global property. */
  get DOMException(): typeof DOMException {
    return this.#binding.DOMException;
  }

  /** Install this realm's exposed definitions on the supplied global object. */
  install(target: object): void {
    this.#binding.install(target);
  }

  /** Project a global implementation, optionally adopting an engine allocation. */
  projectGlobalObject(
    implInst: object,
    interfaceName: string,
    allocation?: GlobalObjectAllocation,
  ): StampedPlatformObject {
    const primaryInterface = this.#binding.resolveInterface(interfaceName);
    return this.#binding.projectGlobalObject(implInst, primaryInterface, allocation).platformObject!;
  }

  /** Owning environment supplied by this realm's composition root. */
  getEnvironment(): Env {
    if (!this.#env) throw new InternalError('The binding environment is still being composed');
    return this.#env;
  }

  // Project helper: compose Web IDL §3.2 JavaScript type mapping with implementation adaptation.
  convertToImpl(value: unknown, type: WebIDLType): unknown {
    return adaptIDLToImpl(
      convertToIDL(value, type, this.#binding.defaultConversionContext),
      type,
      {},
      this,
      this.#binding,
    );
  }

  /** Convert a declared implementation result to its platform representation. */
  convertToJavaScript(value: unknown, type: WebIDLType): unknown {
    return convertToJavaScript(value, type, this.#binding.defaultConversionContext);
  }

  // Project helper: delegate exception realization to this realm binding.
  realizeException(value: unknown): unknown {
    return this.#binding.realizeException(value);
  }

  // Project helper: return our record for a newly created platform object.
  // Web IDL §3.8 Platform objects implementing interfaces:
  // delegates "create a new object implementing the interface".
  // Definition arguments select registered interfaces by identity. Their callbacks
  // are invoked only through that registration, not through this reference.
  createPlatformRecord(definition: InterfaceDefinition<never>): PlatformRecord {
    return this.#binding.createPlatformRecord(this.#resolveInterface(definition));
  }

  // Project helper: look up a registered interface definition by name.
  getInterface(interfaceName: string): InterfaceDefinition<never> | undefined {
    return this.#binding.definitions.getInterface(interfaceName)?.definition;
  }

  // Project helper: resolve the definition and delegate Web IDL §3.3.7 [Exposed] checks.
  isInterfaceExposed(definition: InterfaceDefinition<never>): boolean {
    return this.#binding.isExposed(this.#resolveInterface(definition));
  }

  /**
   * Project helper: find an instance's binding record in this world, through
   * either its implementation or its platform object. The record exists before
   * projection; its platformObject is populated when projection occurs.
   * This lookup does not allocate a platform object.
   */
  getObjectRecord(value: unknown): Readonly<PlatformRecord> | undefined {
    const record = getPlatformRecord(value) ?? getImplementationRecord(value);
    return record?.binding.world === this.#binding.world ? record : undefined;
  }

  // Project helper: construct an implementation with injected arguments and stamp its platform record.
  construct<T extends object>(
    implClass: ImplementationClass<T>,
    ...argumentsList: unknown[]
  ): StampedImplInstance<T> {
    const primaryInterface = this.#getImplementationInterface(implClass);
    const definition = primaryInterface.definition.implementation;
    const implInst = constructImplementationObject(
      implClass,
      resolveImplementationArguments(argumentsList, definition?.constructWith ?? [], this),
    );
    return stampImplementation(implInst, primaryInterface, this.#binding);
  }

  /** Return the stamped instance if the platform object implements the requested interface in this world. */
  unwrap<T extends object>(
    platformObject: unknown,
    implClass: ImplementationClass<T>,
  ): StampedImplInstance<T> | undefined {
    const primaryInterface = this.#getImplementationInterface(implClass);
    const record = getPlatformRecord(platformObject);
    return record?.binding.world === this.#binding.world &&
      record.implements(primaryInterface)
      ? record.implInst as StampedImplInstance<T>
      : undefined;
  }

  // Project helper: project an implementation through its registered interface.
  project<T extends object>(implClass: ImplementationClass<T>, implInst: T): StampedPlatformObject {
    return this.associate(implClass, implInst).project();
  }

  /** Establish an implementation's binding record without projection, preserving an existing owner. */
  associate<T extends object>(implClass: ImplementationClass<T>, implInst: T): PlatformRecord {
    if (getPlatformRecord(implInst)) {
      throw new InternalError('Expected an implementation target');
    }
    const record = this.#binding.associateImplementationObject(
      implInst,
      this.#getImplementationInterface(implClass),
    );
    if (!record) {
      throw new InternalError('Implementation target is associated with another interface');
    }
    return record;
  }

  // Project helper: resolve the interface registered for an implementation class.
  #getImplementationInterface(implClass: ImplementationClass): AssembledInterfaceDefinition {
    const primaryInterface = this.#binding.definitions.getInterfaceForImplClass(implClass);
    if (!primaryInterface) {
      throw new InternalError('No Web IDL interface is registered for this implementation');
    }
    return primaryInterface;
  }

  // Project helper: validate and resolve an exact interface definition identity.
  #resolveInterface(definition: InterfaceDefinition<never>): AssembledInterfaceDefinition {
    const primaryInterface = this.#binding.definitions.getInterface(definition.name);
    if (primaryInterface?.definition !== definition) {
      throw new InternalError(`Unknown Web IDL interface definition ${definition.name}`);
    }
    return primaryInterface;
  }
}
