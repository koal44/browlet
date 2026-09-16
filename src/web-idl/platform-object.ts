import { isObject } from '../js-engine/index';
import type { ObservableArrayHandle } from '../infra/observable-array';
import { Stamper } from '../infra/stamper';
import type { AssembledInterfaceDefinition } from './assembly';
import type { RealmBinding } from './realm-binding';
import type { AttributeMember } from './core/index';
import type { WebIDLRealmHost } from './realm-host';

/** An implementation instance stamped with its private platform record. */
export type StampedImplInstance<T extends object = object> = T & ImplementationStamper;

/** A platform object stamped with the same record as its implementation instance. */
export type StampedPlatformObject<T extends object = object> = T & PlatformObjectStamper;

/** Recognize an implementation stamp, regardless of its owning binding world. */
export function isStampedImplInstance(implInst: unknown): implInst is StampedImplInstance {
  return ImplementationStamper.get(implInst) !== undefined;
}

/** Recognize a platform stamp, regardless of its owning binding world. */
export function isStampedPlatformObject(platformObject: unknown): platformObject is StampedPlatformObject {
  return PlatformObjectStamper.get(platformObject) !== undefined;
}

/** The shared record for an implementation instance and its eventual platform object. */
export class PlatformRecord<T extends object = object> {
  readonly implInst: StampedImplInstance<T>;
  readonly primaryInterface: AssembledInterfaceDefinition;
  binding: RealmBinding;
  platformObject?: StampedPlatformObject;
  // Lazily allocated storage for maplike, setlike, and observable-array members.
  declare mapEntries?: Map<unknown, unknown>;
  declare observableArrays?: Map<AttributeMember, ObservableArrayHandle<unknown, unknown>>;
  declare setEntries?: Set<unknown>;

  constructor(
    implInst: T,
    primaryInterface: AssembledInterfaceDefinition,
    binding: RealmBinding,
  ) {
    this.primaryInterface = primaryInterface;
    this.binding = binding;
    binding.initializeImplementation(implInst, primaryInterface);
    this.implInst = ImplementationStamper.stamp(implInst, this);
  }

  get realm(): WebIDLRealmHost { return this.binding.realm; }

  project(): StampedPlatformObject {
    return this.platformObject ??
      this.binding.projectPlatformObject(this.implInst, this.primaryInterface).platformObject!;
  }

  // Project helper: apply interface membership to this record's primary interface.
  implements(primaryInterface: AssembledInterfaceDefinition): boolean {
    return interfaceImplements(this.primaryInterface, primaryInterface);
  }
}

// Project helper: stamp the implementation with its owner before its first projection.
export function stampImplementation<T extends object>(
  implInst: T,
  primaryInterface: AssembledInterfaceDefinition,
  binding: RealmBinding,
): StampedImplInstance<T> {
  if (isStampedPlatformObject(implInst) || isStampedImplInstance(implInst)) {
    throw new TypeError('Implementation object is already stamped or is a platform object');
  }
  return new PlatformRecord(implInst, primaryInterface, binding).implInst;
}

// Project helper: pair implementation and platform identities in our record.
// Web IDL §3.8 Platform objects implementing interfaces defines [[Realm]] and [[PrimaryInterface]].
export function associatePlatformObject<T extends object>(
  platformObject: object,
  implInst: T,
  primaryInterface: AssembledInterfaceDefinition,
  binding: RealmBinding,
): PlatformRecord<T> {
  if (platformObject === implInst) {
    throw new TypeError('Implementation and platform objects must be distinct');
  }
  if (
    isStampedPlatformObject(platformObject) ||
    isStampedPlatformObject(implInst) ||
    isStampedImplInstance(platformObject)
  ) {
    throw new TypeError('Platform object is already associated');
  }

  const record = (ImplementationStamper.get(implInst) ??
    new PlatformRecord(implInst, primaryInterface, binding)) as PlatformRecord<T>;
  if (record.binding !== binding ||
    record.primaryInterface !== primaryInterface || record.platformObject) {
    throw new TypeError('Implementation object is already associated with another owner or platform object');
  }
  record.platformObject = PlatformObjectStamper.stamp(platformObject, record);
  return record;
}

// Project helper: read the platform object's attached record.
export function getPlatformRecord(platformObject: unknown): PlatformRecord | undefined {
  return PlatformObjectStamper.get(platformObject);
}

// Project helper: read the implementation instance's attached record.
export function getImplementationRecord<T extends object>(
  implInst: T,
): PlatformRecord<T> | undefined;
export function getImplementationRecord(
  implInst: unknown,
): PlatformRecord | undefined;
export function getImplementationRecord(
  implInst: unknown,
): PlatformRecord | undefined {
  return ImplementationStamper.get(implInst);
}

// Project helper: retrieve the implementation paired with a platform object.
export function getImplementationObject(
  platformObject: unknown,
): StampedImplInstance | undefined {
  return getPlatformRecord(platformObject)?.implInst;
}

// Project helper: retrieve the platform object paired with an implementation.
export function getPlatformObject(
  implInst: unknown,
): StampedPlatformObject | undefined {
  return getImplementationRecord(implInst)?.platformObject;
}

// Web IDL §3.8 Platform objects implementing interfaces — "implements" rule.
// Test the primary interface and its inherited interfaces using our assembled definitions.
export function interfaceImplements(
  primaryInterface: AssembledInterfaceDefinition,
  expectedInterface: AssembledInterfaceDefinition,
): boolean {
  let current: AssembledInterfaceDefinition | undefined = primaryInterface;

  while (current) {
    if (current.definition === expectedInterface.definition) return true;
    current = current.parent;
  }
  return false;
}

class ImplementationStamper extends Stamper {
  #record: PlatformRecord;

  private constructor(implInst: object, record: PlatformRecord) {
    super(implInst);
    this.#record = record;
  }

  static stamp<T extends object>(implInst: T, record: PlatformRecord<T>): StampedImplInstance<T> {
    new ImplementationStamper(implInst, record);
    return implInst as StampedImplInstance<T>;
  }

  static get(implInst: unknown): PlatformRecord | undefined {
    return isObject(implInst) && #record in implInst ? implInst.#record : undefined;
  }
}

class PlatformObjectStamper extends Stamper {
  #record: PlatformRecord;

  private constructor(platformObject: object, record: PlatformRecord) {
    super(platformObject);
    this.#record = record;
  }

  static stamp<T extends object>(platformObject: T, record: PlatformRecord): StampedPlatformObject<T> {
    new PlatformObjectStamper(platformObject, record);
    return platformObject as StampedPlatformObject<T>;
  }

  static get(platformObject: unknown): PlatformRecord | undefined {
    return isObject(platformObject) && #record in platformObject ? platformObject.#record : undefined;
  }
}
