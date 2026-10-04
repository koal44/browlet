import { InternalError, Stamper, type ObservableArrayHandle } from '../../infra/index';
import { isObject } from '../../js-engine/index';
import { DOMExceptionImpl, DOMExceptionStamper, type ImplementationClass } from '../core/index';

import type { WebIDLRealm } from '../environment';
import type { IDLAttribute, AssembledInterface } from '../assembly/index';
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
  declare observableArrays?: Map<IDLAttribute, ObservableArrayHandle<unknown, unknown>>;
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
      this.attachPlatformObject(this.binding.allocatePlatformObject(this.implInst, this.assembled));
  }

  /** Attach a fresh or validated platform object and initialize its per-object binding state. */
  attachPlatformObject(platformObject: object): StampedPlatformObject {
    if (this.platformObject) {
      throw new InternalError('Implementation object is already associated with another owner or platform object');
    }
    this.platformObject = PlatformObjectStamper.stamp(platformObject, this);
    const { assembled, binding } = this;
    const implInst: StampedImplInstance = this.implInst;
    const member = assembled.getCollectionMember(true);
    if (member?.kind === 'maplike') this.mapEntries ??= new Map();
    else if (member?.kind === 'setlike') this.setEntries ??= new Set();
    for (const ancestorAssembled of assembled.getInheritanceChain()) {
      // Use the declaration's class identity without probing implementation Proxy prototypes.
      if (ancestorAssembled.primary.implementation?.implClass === DOMExceptionImpl) {
        DOMExceptionStamper.stamp(platformObject, implInst as StampedImplInstance<DOMExceptionImpl>);
      }
      // https://webidl.spec.whatwg.org/#js-platform-objects
      // Copy each interface's unforgeable properties onto the new platform object.
      const descriptors = binding.getImplementationBinding(ancestorAssembled).getUnforgeableDescriptors();
      if (descriptors) Object.defineProperties(platformObject, descriptors);
    }
    return this.platformObject;
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
