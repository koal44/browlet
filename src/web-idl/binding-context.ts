import type { Promises } from '../js-engine/promises';
import type { RuntimeContext } from '../js-engine/runtime-context';
import type { AssembledInterfaceDefinition } from './assembly';
import type { GlobalObjectAllocation, RealmBinding } from './realm-binding';
import type { Capability } from './capability';
import type { ImplementationClass, WebIDLType } from './core/types';
import type { InterfaceDefinition } from './core/declarations';
import { convertToIDL } from './conversion';
import type { WebIDLRealmHost } from './realm-host';
import {
  getImplementationRecord, getPlatformRecord, stampImplementation, type StampedImplInstance,
  type StampedPlatformObject, type PlatformRecord,
} from './platform-object';
import {
  adaptIDLToImpl, constructImplementationObject, resolveImplementationArguments,
} from './implementation-binding';

/** A realm's Web IDL operations and implementation runtime within one binding world. */
export class BindingContext<Realm extends WebIDLRealmHost = WebIDLRealmHost> {
  readonly realm: Realm;
  readonly promises: Promises;
  readonly #binding: RealmBinding<Realm>;
  readonly #runtime: RuntimeContext | undefined;

  // Project helper: retain a realm binding and compose its implementation runtime.
  constructor(
    binding: RealmBinding<Realm>,
    createRuntime?: (ctx: BindingContext<Realm>) => RuntimeContext,
  ) {
    this.realm = binding.realm;
    this.promises = binding.realm.promises;
    this.#binding = binding;
    this.#runtime = createRuntime?.(this);
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

  // Project helper: retrieve the configured implementation runtime.
  getRuntime(): RuntimeContext {
    if (!this.#runtime) throw new Error('The binding realm has no implementation runtime');
    return this.#runtime;
  }

  // Project helper: compose Web IDL §3.2 JavaScript type mapping with implementation adaptation.
  convertToImpl(value: unknown, type: WebIDLType): unknown {
    return adaptIDLToImpl(
      convertToIDL(value, type, this.#binding),
      type,
      {},
      this,
      this.#binding,
    );
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
  createPlatformObject(definition: InterfaceDefinition<never>): PlatformRecord {
    const object = this.#binding.createPlatformObject(this.#resolveInterface(definition));
    const record = getPlatformRecord(object);
    if (!record) throw new Error('Created platform object has no record');
    return record;
  }

  // Project helper: retrieve a capability for an exact registered interface definition.
  getCapability<Value>(
    definition: InterfaceDefinition<never>,
    capability: Capability<Value>,
  ): Value | undefined {
    this.#resolveInterface(definition);
    return this.#binding.capabilities.get(definition, capability);
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
    return record?.binding.platformObjects === this.#binding.platformObjects ? record : undefined;
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
    return record?.binding.platformObjects === this.#binding.platformObjects &&
      record.implements(primaryInterface)
      ? record.implInst as StampedImplInstance<T>
      : undefined;
  }

  // Project helper: project an implementation through its registered interface.
  project<T extends object>(implClass: ImplementationClass<T>, implInst: T): StampedPlatformObject {
    if (getPlatformRecord(implInst)) {
      throw new TypeError('Expected an implementation target');
    }
    const object = this.#binding.projectImplementationObject(
      implInst,
      this.#getImplementationInterface(implClass),
    );
    if (!object) {
      throw new TypeError('Implementation target is associated with another interface');
    }
    return object;
  }

  // Project helper: resolve the interface registered for an implementation class.
  #getImplementationInterface(implClass: ImplementationClass): AssembledInterfaceDefinition {
    const primaryInterface = this.#binding.implementations.getInterfaceForImplementation(implClass);
    if (!primaryInterface) {
      throw new Error('No Web IDL interface is registered for this implementation');
    }
    return primaryInterface;
  }

  // Project helper: validate and resolve an exact interface definition identity.
  #resolveInterface(definition: InterfaceDefinition<never>): AssembledInterfaceDefinition {
    const primaryInterface = this.#binding.definitions.getInterface(definition.name);
    if (primaryInterface?.definition !== definition) {
      throw new TypeError(`Unknown Web IDL interface definition ${definition.name}`);
    }
    return primaryInterface;
  }
}
