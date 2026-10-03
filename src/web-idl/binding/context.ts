import type { InternalPromise } from '../../infra/promises';
import type { AssembledInterface } from '../assembled';
import type { GlobalObjectAllocation, RealmBinding } from './realm';
import type { ImplementationClass, ImplementationType, WebIDLType } from '../core/types';
import { jsToIDL, idlToJS } from '../conversion';
import type { WebIDLEnvironment } from '../environment';
import {
  getImplementationRecord, getPlatformRecord, stampImplementation, type StampedImplInstance,
  type StampedPlatformObject, type PlatformRecord,
} from './platform-object';
import {
  constructImplementationObject, resolveImplementationArguments,
} from '../constructs/implementation';
import { InternalError } from '../../infra/internal-error';
import { createWebIDLPromiseConstructor } from '../constructs/promise';

/** A realm's Web IDL operations and environment within one binding world. */
export class BindingContext<Env extends WebIDLEnvironment = WebIDLEnvironment> {
  realm: Env['realm'];
  /** InternalPromise constructor whose results use this realm's Web IDL conversion. */
  Promise: typeof InternalPromise;
  #binding: RealmBinding<Env>;
  #env: Env | undefined;

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
    const assembled = this.#binding.resolveInterface(interfaceName);
    return this.#binding.projectGlobalObject(implInst, assembled, allocation).platformObject!;
  }

  /** Owning environment supplied by this realm's composition root. */
  getEnvironment(): Env {
    if (!this.#env) throw new InternalError('The binding environment is still being composed');
    return this.#env;
  }

  /** Convert an author value through IDL to the representation consumed by implementations. */
  // https://webidl.spec.whatwg.org/#js-type-mapping
  jsToImpl<T>(value: unknown, type: ImplementationType<T>): T;
  jsToImpl(value: unknown, type: WebIDLType): unknown;
  jsToImpl(value: unknown, type: WebIDLType): unknown {
    return this.#binding.implementationConverter.idlToImpl(
      jsToIDL(value, this.#binding.getConversionContext(type)),
      type,
      {},
      this,
    );
  }

  /** Convert a declared implementation result to its author-facing representation. */
  implToJS(value: unknown, type: WebIDLType): unknown {
    return idlToJS(value, this.#binding.getConversionContext(type));
  }

  /** Turn an internal exception request into a realm-owned error, preserving any prior realization. */
  realizeException(value: unknown): unknown {
    return this.#binding.realizeException(value);
  }

  /** Create a platform object by interface name; return undefined if unknown or unexposed. */
  // https://webidl.spec.whatwg.org/#new
  createPlatformRecord(interfaceName: string): PlatformRecord | undefined {
    const assembled = this.#binding.assembly.interfaces.get(interfaceName);
    if (!assembled || !this.#binding.isExposed(assembled)) return;
    return this.#binding.createPlatformRecord(assembled);
  }

  /**
   * Find this world's binding record from either object identity without projecting.
   * The record's platformObject remains absent until projection.
   */
  getObjectRecord(value: unknown): Readonly<PlatformRecord> | undefined {
    const record = getPlatformRecord(value) ?? getImplementationRecord(value);
    return record?.binding.world === this.#binding.world ? record : undefined;
  }

  /** Construct and associate an implementation using its declared injected arguments. */
  construct<T extends object>(
    implClass: ImplementationClass<T>,
    ...argumentsList: unknown[]
  ): StampedImplInstance<T> {
    const assembled = this.#getImplementationInterface(implClass);
    const definition = assembled.primary.implementation;
    const implInst = constructImplementationObject(
      implClass,
      resolveImplementationArguments(argumentsList, definition?.constructWith ?? [], this),
    );
    return stampImplementation(implInst, assembled, this.#binding);
  }

  /** Return the stamped instance if the platform object implements the requested interface in this world. */
  unwrap<T extends object>(
    platformObject: unknown,
    implClass: ImplementationClass<T>,
  ): StampedImplInstance<T> | undefined {
    const assembled = this.#getImplementationInterface(implClass);
    const record = getPlatformRecord(platformObject);
    return record?.binding.world === this.#binding.world &&
      record.implements(assembled)
      ? record.implInst as StampedImplInstance<T>
      : undefined;
  }

  /** Retrieve or create the platform object for an implementation through its registered interface. */
  project<T extends object>(implClass: ImplementationClass<T>, implInst: T): StampedPlatformObject {
    return this.associate(implClass, implInst).project();
  }

  /** Establish an implementation's binding record without projection, preserving an existing owner. */
  associate<T extends object>(implClass: ImplementationClass<T>, implInst: T): PlatformRecord<T> {
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

  #getImplementationInterface(implClass: ImplementationClass): AssembledInterface {
    const assembled = this.#binding.assembly.interfaces.get(implClass);
    if (!assembled) {
      throw new InternalError('No Web IDL interface is registered for this implementation');
    }
    return assembled;
  }
}
