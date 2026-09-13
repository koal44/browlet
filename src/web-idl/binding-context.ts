import type { Promises } from '../js-engine/promises';
import type { RuntimeContext } from '../js-engine/runtime-context';
import type { AssembledInterfaceDefinition } from './assembly';
import type { GlobalObjectAllocation, RealmBinding } from './binding';
import type { Capability } from './capability';
import type { ImplementationClass } from './core/binding';
import type { WebIDLType } from './core/definition';
import type { InterfaceDefinition } from './core/definitions/interface';
import { convertToIDL } from './conversion';
import type { WebIDLRealmHost } from './js-realm';
import type { PlatformObjectRecord } from './platform-object';
import {
  adaptIDLToImpl, constructImplementationObject, resolveImplementationArguments,
} from './projection';

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
    value: object,
    interfaceName: string,
    allocation?: GlobalObjectAllocation,
  ): object {
    return this.#binding.projectGlobalObject(value, interfaceName, allocation).platformObject;
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
  createPlatformObject(definition: InterfaceDefinition<never>): Readonly<PlatformObjectRecord> {
    const object = this.#binding.createPlatformObject(this.#resolveInterface(definition));
    const record = this.#binding.getPlatformObjectRecord(object);
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
  getInterface(name: string): InterfaceDefinition<never> | undefined {
    return this.#binding.definitions.getInterface(name)?.definition;
  }

  // Project helper: resolve the definition and delegate Web IDL §3.3.7 [Exposed] checks.
  isInterfaceExposed(definition: InterfaceDefinition<never>): boolean {
    return this.#binding.isExposed(this.#resolveInterface(definition));
  }

  /**
   * Project helper: find an existing platform/implementation association in this
   * binding world. Either member of the pair retrieves the same record, which
   * includes both objects, their primary interface, and the object's realm.
   *
   * This lookup does not project an implementation. An implementation with only
   * a recorded origin, or no association at all, returns undefined.
   */
  getObjectRecord(value: unknown): Readonly<PlatformObjectRecord> | undefined {
    return this.#binding.platformObjects.getRecord(value) ??
      this.#binding.platformObjects.getImplementationRecord(value);
  }

  // Project helper: construct an implementation with injected arguments and record its origin.
  construct<T extends object>(
    implementation: ImplementationClass<T>,
    ...argumentsList: unknown[]
  ): T {
    const interface_ = this.#getImplementationInterface(implementation);
    const definition = interface_.definition.implementation;
    const value = constructImplementationObject(
      implementation,
      resolveImplementationArguments(argumentsList, definition?.constructWith ?? [], this),
    );
    this.#binding.platformObjects.associateOrigin(value, interface_, this.realm);
    return value;
  }

  // Project helper: unwrap a platform object as a registered implementation class.
  unwrap<T extends object>(
    value: unknown,
    implementation: ImplementationClass<T>,
  ): T | undefined {
    const interface_ = this.#getImplementationInterface(implementation);
    const record = this.#binding.getPlatformObjectRecord(value);
    return record && this.#binding.platformObjects.recordImplements(record, interface_)
      ? record.implementation as T
      : undefined;
  }

  // Project helper: project an implementation through its registered interface.
  project<T extends object>(implementation: ImplementationClass<T>, value: T): object {
    if (this.#binding.getPlatformObjectRecord(value)) {
      throw new TypeError('Expected an implementation target');
    }
    const object = this.#binding.projectImplementationObject(
      value,
      this.#getImplementationInterface(implementation),
    );
    if (!object) {
      throw new TypeError('Implementation target is associated with another interface');
    }
    return object;
  }

  // Project helper: resolve the interface registered for an implementation class.
  #getImplementationInterface(implementation: ImplementationClass): AssembledInterfaceDefinition {
    const interface_ = this.#binding.implementations.getInterfaceForImplementation(implementation);
    if (!interface_) {
      throw new Error('No Web IDL interface is registered for this implementation');
    }
    return interface_;
  }

  // Project helper: validate and resolve an exact interface definition identity.
  #resolveInterface(definition: InterfaceDefinition<never>): AssembledInterfaceDefinition {
    const interface_ = this.#binding.definitions.getInterface(definition.name);
    if (interface_?.definition !== definition) {
      throw new TypeError(`Unknown Web IDL interface definition ${definition.name}`);
    }
    return interface_;
  }
}
