import type { ObservableArrayHandle } from '../shared/observable-array';
import type { AssembledInterface } from './assembly';
import type { AttributeMember } from './declaration/index';
import type { WebIDLRealmHost } from './javascript-realm';

export class PlatformObjectRegistry {
  // One registry belongs to one binding world. A separate world can therefore
  // associate its own platform object without weakening this identity boundary.
  #implementationOrigins = new WeakMap<object, PlatformImplementationOrigin>();
  #implementationRecords = new WeakMap<object, PlatformObjectRecord>();
  #objectRecords = new WeakMap<object, PlatformObjectRecord>();
  #realmProjectors = new WeakMap<WebIDLRealmHost, PlatformObjectProjector>();

  registerRealm(
    realm: WebIDLRealmHost,
    project: PlatformObjectProjector,
  ): void {
    if (this.#realmProjectors.has(realm)) {
      throw new TypeError('Realm already has a platform-object projector');
    }
    this.#realmProjectors.set(realm, project);
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
    const project = this.#realmProjectors.get(origin.realm);
    if (!project) {
      throw new TypeError('Implementation origin has no registered realm');
    }
    return project(implementation, origin.primaryInterface);
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

export function ordinarySetWithOwnDescriptor(
  target: object,
  property: PropertyKey,
  value: unknown,
  receiver: unknown,
  ownDescriptor: PropertyDescriptor | undefined,
): boolean {
  if (!ownDescriptor) {
    const parent = Reflect.getPrototypeOf(target);
    if (parent) return Reflect.set(parent, property, value, receiver);
    ownDescriptor = {
      configurable: true,
      enumerable: true,
      value: undefined,
      writable: true,
    };
  }

  if (isDataDescriptor(ownDescriptor)) {
    if (!ownDescriptor.writable || !isObject(receiver)) return false;
    const existing = Reflect.getOwnPropertyDescriptor(receiver, property);
    if (existing) {
      if (isAccessorDescriptor(existing) || existing.writable === false) {
        return false;
      }
      return Reflect.defineProperty(receiver, property, { value });
    }
    return Reflect.defineProperty(receiver, property, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }

  if (!ownDescriptor.set) return false;
  // eslint-disable-next-line @typescript-eslint/unbound-method -- the descriptor's receiver is supplied explicitly
  Reflect.apply(ownDescriptor.set, receiver, [value]);
  return true;
}

function isDataDescriptor(descriptor: PropertyDescriptor): boolean {
  return Object.hasOwn(descriptor, 'value') ||
    Object.hasOwn(descriptor, 'writable');
}

function isAccessorDescriptor(descriptor: PropertyDescriptor): boolean {
  return Object.hasOwn(descriptor, 'get') || Object.hasOwn(descriptor, 'set');
}

function isObject(value: unknown): value is object {
  return value !== null && (
    typeof value === 'object' || typeof value === 'function'
  );
}
