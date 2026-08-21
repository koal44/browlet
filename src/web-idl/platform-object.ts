import type { AssembledInterface } from './assembly';
import type { WebIDLRealmHost } from './javascript-realm';

export class PlatformObjectRegistry {
  #implementationRecords = new WeakMap<object, PlatformObjectRecord>();
  #objectRecords = new WeakMap<object, PlatformObjectRecord>();

  associate(
    object: object,
    implementation: object,
    primaryInterface: AssembledInterface,
    realm: WebIDLRealmHost,
  ): PlatformObjectRecord {
    if (
      this.#objectRecords.has(object) ||
      this.#implementationRecords.has(object) ||
      this.#objectRecords.has(implementation) ||
      this.#implementationRecords.has(implementation)
    ) {
      throw new TypeError('Platform object is already associated');
    }

    const record = { implementation, object, primaryInterface, realm };
    this.#implementationRecords.set(implementation, record);
    this.#objectRecords.set(object, record);
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

  getImplementationObject(value: unknown): object | undefined {
    return this.getRecord(value)?.implementation;
  }

  getPlatformObject(value: unknown): object | undefined {
    return this.getImplementationRecord(value)?.object;
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
    let current: AssembledInterface | undefined = record.primaryInterface;

    while (current) {
      if (current.definition === interface_.definition) return true;
      current = current.parent;
    }

    return false;
  }
}

/*
 * Platform-object identity crosses realm bindings. Production bindings share
 * this registry so methods borrowed from one realm can recognize platform
 * objects created in another. Isolated binding tests can still provide their
 * own registry explicitly.
 */
export const sharedPlatformObjects = new PlatformObjectRegistry();

export type PlatformObjectRecord = {
  implementation: object;
  object: object;
  primaryInterface: AssembledInterface;
  realm: WebIDLRealmHost;
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
