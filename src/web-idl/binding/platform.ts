import { InternalError, type ObservableArrayHandle, Stamper } from '../../infra/index';

import { isObject } from '../../js-engine/index';

import type { AttributeMember, ImplementationClass } from '../core/index';

import type { AssembledInterface } from '../assembled';
import type { WebIDLRealm } from '../environment';

import type { RealmBinding } from './realm';

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
  implInst: StampedImplInstance<T>;
  /** The object's interface with its inheritance, partials, and mixins assembled. */
  assembled: AssembledInterface;
  binding: RealmBinding;
  platformObject?: StampedPlatformObject;
  // Lazily allocated storage for maplike, setlike, and observable-array members.
  declare mapEntries?: Map<unknown, unknown>;
  declare observableArrays?: Map<AttributeMember, ObservableArrayHandle<unknown, unknown>>;
  declare setEntries?: Set<unknown>;

  constructor(
    implInst: T,
    assembled: AssembledInterface,
    binding: RealmBinding,
  ) {
    this.assembled = assembled;
    this.binding = binding;
    binding.initializeImplementation(implInst, assembled);
    this.implInst = ImplementationStamper.stamp(implInst, this);
  }

  get realm(): WebIDLRealm { return this.binding.realm; }

  project(): StampedPlatformObject {
    return this.platformObject ??
      this.binding.projectPlatformObject(this.implInst, this.assembled).platformObject!;
  }

  /** Associate another implementation with this owner, preserving any existing owner. */
  associateWithOwner<Impl extends object>(implClass: ImplementationClass<Impl>, implInst: Impl): PlatformRecord<Impl> {
    return this.binding.associate(implClass, implInst);
  }

  /** Whether this object's interface is the requested interface or inherits from it. */
  implements(assembled: AssembledInterface): boolean {
    return this.assembled.implements(assembled);
  }
}

// Project helper: stamp the implementation with its owner before its first projection.
export function stampImplementation<T extends object>(
  implInst: T,
  assembled: AssembledInterface,
  binding: RealmBinding,
): StampedImplInstance<T> {
  if (isStampedPlatformObject(implInst) || isStampedImplInstance(implInst)) {
    throw new InternalError('Implementation object is already stamped or is a platform object');
  }
  return new PlatformRecord(implInst, assembled, binding).implInst;
}

// Project helper: pair implementation and platform identities in our record.
// Web IDL §3.8 Platform objects implementing interfaces defines [[Realm]] and [[PrimaryInterface]].
export function associatePlatformObject<T extends object>(
  platformObject: object,
  implInst: T,
  assembled: AssembledInterface,
  binding: RealmBinding,
): PlatformRecord<T> {
  if (platformObject === implInst) {
    throw new InternalError('Implementation and platform objects must be distinct');
  }
  if (
    isStampedPlatformObject(platformObject) ||
    isStampedPlatformObject(implInst) ||
    isStampedImplInstance(platformObject)
  ) {
    throw new InternalError('Platform object is already associated');
  }

  const record = (ImplementationStamper.get(implInst) ??
    new PlatformRecord(implInst, assembled, binding)) as PlatformRecord<T>;
  if (record.binding !== binding ||
    record.assembled !== assembled || record.platformObject) {
    throw new InternalError('Implementation object is already associated with another owner or platform object');
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

/** Recognize a stamped platform object or a declared proxy object in this binding world. */
// https://webidl.spec.whatwg.org/#idl-objects
export function isPlatformObject(
  value: unknown,
  binding: RealmBinding,
): boolean {
  if (getPlatformRecord(value)?.binding.world === binding.world) return true;
  return binding.assembly.proxyObjects.is(value);
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
