import { isObject, type JSRealm, type PromiseValue } from '../js-engine/index';
import type { ObservableArrayHandle } from '../infra/observable-array';
import type { AssembledInterfaceDefinition } from './assembly';
import type { AsyncIteratorRecord } from './async-iterable';
import type { RealmBinding } from './binding';
import type { AttributeMember, WebIDLType } from './core/index';
import type { WebIDLRealmHost } from './js-realm';
import type { IDLPromise } from './promise-value';
import type { BindingContext } from './binding-context';

/**
 * Instance associations shared by the realms in one binding world. Each
 * projected platform object and its implementation point to one shared record.
 * Interface constructor functions and prototypes are cached by RealmBinding.
 */
export class PlatformObjectRegistry {
  // One registry belongs to one binding world. A separate world can therefore
  // associate its own platform object without weakening this identity boundary.
  /** Realm/interface selection retained until the implementation is projected. */
  #implementationOrigins = new WeakMap<object, PlatformImplementationOrigin>();
  /** Completed implementation/platform pairs, indexed by the implementation. */
  #implementationRecords = new WeakMap<object, PlatformObjectRecord>();
  #objectRecords = new WeakMap<object, PlatformObjectRecord>();
  #realmBindings = new WeakMap<JSRealm, RealmPlatformBinding>();

  readonly asyncIterators = new WeakMap<object, AsyncIteratorRecord>();

  // Retained promises share a projection per result type and realm in this world.
  promiseProjections?: WeakMap<Promise<unknown> | PromiseValue<unknown>, PromiseProjection[]>;

  // Project helper: register the binding and context used to project into a realm.
  registerRealm(
    binding: RealmBinding,
    context: BindingContext,
  ): void {
    if (this.#realmBindings.has(binding.realm)) {
      throw new TypeError('Realm already has a registered binding');
    }
    this.#realmBindings.set(binding.realm, { context, binding });
  }

  // Project helper: retain an implementation's interface and realm before projection.
  associateOrigin(
    implementation: object,
    primaryInterface: AssembledInterfaceDefinition,
    realm: WebIDLRealmHost,
  ): void {
    if (
      this.#objectRecords.has(implementation) ||
      this.#implementationRecords.has(implementation) ||
      this.#implementationOrigins.has(implementation)
    ) {
      throw new TypeError('Implementation object is already associated');
    }
    this.#implementationOrigins.set(implementation, {
      primaryInterface,
      realm,
    });
  }

  // Project helper: project an implementation using its recorded origin.
  projectFromOrigin(implementation: object): object {
    const origin = this.#implementationOrigins.get(implementation);
    if (!origin) throw new TypeError('Implementation object has no origin');
    const registration = this.#realmBindings.get(origin.realm);
    if (!registration) {
      throw new TypeError('Implementation origin has no registered realm');
    }
    return registration.binding.projectPlatformObject(
      implementation, origin.primaryInterface,
    ).platformObject;
  }

  // Project helper: pair implementation and platform identities in our record.
  // Web IDL §3.8 Platform objects implementing interfaces defines [[Realm]] and [[PrimaryInterface]].
  associate(
    platformObject: object,
    implementation: object,
    primaryInterface: AssembledInterfaceDefinition,
    realm: WebIDLRealmHost,
  ): PlatformObjectRecord {
    if (
      this.#objectRecords.has(platformObject) ||
      this.#implementationRecords.has(platformObject) ||
      this.#implementationOrigins.has(platformObject) ||
      this.#objectRecords.has(implementation) ||
      this.#implementationRecords.has(implementation)
    ) {
      throw new TypeError('Platform object is already associated');
    }

    const origin = this.#implementationOrigins.get(implementation);
    if (origin && (
      origin.primaryInterface !== primaryInterface ||
      origin.realm !== realm
    )) {
      throw new TypeError('Implementation object has another originating realm');
    }

    const record = {
      implementation,
      platformObject,
      primaryInterface,
      realm,
    };
    this.#implementationOrigins.delete(implementation);
    this.#implementationRecords.set(implementation, record);
    this.#objectRecords.set(platformObject, record);
    return record;
  }

  // Project helper: find our record for a platform object.
  getRecord(value: unknown): PlatformObjectRecord | undefined {
    return isObject(value)
      ? this.#objectRecords.get(value)
      : undefined;
  }

  // Project helper: find our record for an implementation object.
  getImplementationRecord(value: unknown): PlatformObjectRecord | undefined {
    return isObject(value)
      ? this.#implementationRecords.get(value)
      : undefined;
  }

  // Project helper: look up an implementation's origin before projection.
  getImplementationOrigin(
    value: unknown,
  ): PlatformImplementationOrigin | undefined {
    return isObject(value)
      ? this.#implementationOrigins.get(value)
      : undefined;
  }

  // Project helper: look up a realm's binding context.
  getBindingContext(realm: WebIDLRealmHost): BindingContext | undefined {
    return this.#realmBindings.get(realm)?.context;
  }

  // Project helper: look up a realm's binding.
  getRealmBinding(realm: JSRealm): RealmBinding | undefined {
    return this.#realmBindings.get(realm)?.binding;
  }

  // Project helper: retrieve the implementation paired with a platform object.
  getImplementationObject(value: unknown): object | undefined {
    return this.getRecord(value)?.implementation;
  }

  // Project helper: retrieve the platform object paired with an implementation.
  getPlatformObject(value: unknown): object | undefined {
    return this.getImplementationRecord(value)?.platformObject;
  }

  // Project helper: update the realm in our existing platform-object record.
  changeRealm(
    value: object,
    realm: WebIDLRealmHost,
  ): void {
    const record = this.getRecord(value);
    if (!record) throw new TypeError('Value is not a platform object');
    record.realm = realm;
  }

  // Project helper: recognize objects registered in this binding world.
  // Web IDL §2.12 Objects implementing interfaces leaves recognition implementation-specific.
  isPlatformObject(value: unknown): boolean {
    return this.getRecord(value) !== undefined;
  }

  // Project helper: look up a platform object and apply the interface-membership rule below.
  implements(value: unknown, interface_: AssembledInterfaceDefinition): boolean {
    const record = this.getRecord(value);
    return record ? this.recordImplements(record, interface_) : false;
  }

  // Project helper: apply the interface-membership rule to a record's primary interface.
  recordImplements(
    record: PlatformObjectRecord,
    interface_: AssembledInterfaceDefinition,
  ): boolean {
    return this.interfaceImplements(record.primaryInterface, interface_);
  }

  // Web IDL §3.8 Platform objects implementing interfaces — "implements" rule.
  // Test the primary interface and its inherited interfaces using our assembled definitions.
  interfaceImplements(
    primaryInterface: AssembledInterfaceDefinition,
    interface_: AssembledInterfaceDefinition,
  ): boolean {
    let current: AssembledInterfaceDefinition | undefined = primaryInterface;

    while (current) {
      if (current.definition === interface_.definition) return true;
      current = current.parent;
    }

    return false;
  }
}

export type PlatformImplementationOrigin = {
  primaryInterface: AssembledInterfaceDefinition;
  realm: WebIDLRealmHost;
};

type RealmPlatformBinding = {
  context: BindingContext;
  binding: RealmBinding;
};

/** One projected instance and its implementation, with interface and realm metadata. */
export type PlatformObjectRecord = {
  implementation: object;
  // Per-object IDL state follows the object when its associated realm changes.
  mapEntries?: Map<unknown, unknown>;
  platformObject: object;
  observableArrays?: WeakMap<
    AttributeMember,
    ObservableArrayHandle<unknown, unknown>
  >;
  primaryInterface: AssembledInterfaceDefinition;
  realm: WebIDLRealmHost;
  setEntries?: Set<unknown>;
};

type PromiseProjection = {
  realm: WebIDLRealmHost;
  type: WebIDLType;
  promise: IDLPromise;
  newBufferResult: boolean;
};
