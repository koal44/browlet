import { isObject } from '../js-engine/index';
import type { ObservableArrayHandle } from '../infra/observable-array';
import type { AssembledInterface } from './assembly';
import type { AttributeMember } from './declaration/index';
import type { WebIDLRealmHost } from './js-realm';
import type { BindingContext } from './projection';

export class PlatformObjectRegistry {
  // One registry belongs to one binding world. A separate world can therefore
  // associate its own platform object without weakening this identity boundary.
  #implementationOrigins = new WeakMap<object, PlatformImplementationOrigin>();
  #implementationRecords = new WeakMap<object, PlatformObjectRecord>();
  #objectRecords = new WeakMap<object, PlatformObjectRecord>();
  #realmBindings = new WeakMap<WebIDLRealmHost, RealmPlatformBinding>();

  registerRealm(
    realm: WebIDLRealmHost,
    context: BindingContext,
    project: PlatformObjectProjector,
  ): void {
    if (this.#realmBindings.has(realm)) {
      throw new TypeError('Realm already has a platform-object projector');
    }
    this.#realmBindings.set(realm, { context, project });
  }

  associateOrigin(
    implementation: object,
    primaryInterface: AssembledInterface,
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

  projectImplementationOrigin(implementation: object): object {
    const origin = this.#implementationOrigins.get(implementation);
    if (!origin) throw new TypeError('Implementation object has no origin');
    const binding = this.#realmBindings.get(origin.realm);
    if (!binding) {
      throw new TypeError('Implementation origin has no registered realm');
    }
    return binding.project(implementation, origin.primaryInterface);
  }

  associate(
    platformObject: object,
    implementation: object,
    primaryInterface: AssembledInterface,
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

  getRecord(value: unknown): PlatformObjectRecord | undefined {
    return isObject(value)
      ? this.#objectRecords.get(value)
      : undefined;
  }

  getImplementationRecord(value: unknown): PlatformObjectRecord | undefined {
    return isObject(value)
      ? this.#implementationRecords.get(value)
      : undefined;
  }

  getImplementationOrigin(
    value: unknown,
  ): PlatformImplementationOrigin | undefined {
    return isObject(value)
      ? this.#implementationOrigins.get(value)
      : undefined;
  }

  getBindingContext(realm: WebIDLRealmHost): BindingContext | undefined {
    return this.#realmBindings.get(realm)?.context;
  }

  getImplementationObject(value: unknown): object | undefined {
    return this.getRecord(value)?.implementation;
  }

  getPlatformObject(value: unknown): object | undefined {
    return this.getImplementationRecord(value)?.platformObject;
  }

  changeRealm(
    value: object,
    realm: WebIDLRealmHost,
  ): void {
    const record = this.getRecord(value);
    if (!record) throw new TypeError('Value is not a platform object');
    record.realm = realm;
  }

  isPlatformObject(value: unknown): boolean {
    return this.getRecord(value) !== undefined;
  }

  implements(value: unknown, interface_: AssembledInterface): boolean {
    const record = this.getRecord(value);
    return record ? this.recordImplements(record, interface_) : false;
  }

  recordImplements(
    record: PlatformObjectRecord,
    interface_: AssembledInterface,
  ): boolean {
    return this.interfaceImplements(record.primaryInterface, interface_);
  }

  interfaceImplements(
    primaryInterface: AssembledInterface,
    interface_: AssembledInterface,
  ): boolean {
    let current: AssembledInterface | undefined = primaryInterface;

    while (current) {
      if (current.definition === interface_.definition) return true;
      current = current.parent;
    }

    return false;
  }
}

export type PlatformImplementationOrigin = {
  primaryInterface: AssembledInterface;
  realm: WebIDLRealmHost;
};

type PlatformObjectProjector = (
  implementation: object,
  primaryInterface: AssembledInterface,
) => object;

type RealmPlatformBinding = {
  context: BindingContext;
  project: PlatformObjectProjector;
};

export type PlatformObjectRecord = {
  implementation: object;
  // Per-object IDL state follows the object when its associated realm changes.
  mapEntries?: Map<unknown, unknown>;
  platformObject: object;
  observableArrays?: WeakMap<
    AttributeMember,
    ObservableArrayHandle<unknown, unknown>
  >;
  primaryInterface: AssembledInterface;
  realm: WebIDLRealmHost;
  setEntries?: Set<unknown>;
};
