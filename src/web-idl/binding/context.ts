import {
  InternalError, InternalPromise, type InternalPromiseWithResolvers, type PromiseResultType,
} from '../../infra/index';
import type { ImplementationClass, ImplementationType, InjectedArgument, WebIDLType } from '../core/index';

import type { WebIDLEnvironment } from '../environment';
import { IDLPromise } from '../values/index';
import {
  getImplementationRecord, getPlatformRecord, stampImplementation, type StampedImplInstance,
  type StampedPlatformObject, type PlatformRecord,
} from './platform';
import type { GlobalObjectAllocation, RealmBinding } from './realm';

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
    this.Promise = createWebIDLPromiseConstructor(this, binding);
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
    const compiled = this.#binding.assembly.getIDLType(type);
    return this.#binding.implementationConverter.idlToImpl(
      this.#binding.getConverter(compiled).jsToIDL(value),
      compiled,
      {},
      this,
    );
  }

  /** Convert a declared implementation result to its author-facing representation. */
  implToJS(value: unknown, type: WebIDLType): unknown {
    return this.#binding.getConverter(this.#binding.assembly.getIDLType(type)).idlToJS(value);
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
    const assembled = this.#binding.resolveInterface(implClass);
    const definition = assembled.primary.implementation;
    const implInst: T = Reflect.construct(
      implClass as new (...argumentsList: unknown[]) => T,
      this.resolveArguments(argumentsList, definition?.constructWith ?? []),
    );
    return stampImplementation(implInst, assembled, this.#binding);
  }

  /** Merge converted arguments with dependencies resolved against receiver and method contexts. */
  resolveArguments(
    argumentsList: unknown[],
    injectedArguments: InjectedArgument[],
    methodContext: BindingContext = this,
  ): unknown[] {
    if (injectedArguments.length === 0) return argumentsList;

    const result: unknown[] = [];
    for (const { index, resolve } of injectedArguments) {
      if (Object.hasOwn(result, index)) {
        throw new InternalError(`Injected argument ${index} is declared more than once`);
      }
      result[index] = resolve(this, methodContext);
    }

    let index = 0;
    for (const value of argumentsList) {
      while (Object.hasOwn(result, index)) index++;
      result[index++] = value;
    }
    return result;
  }

  /** Return the stamped instance if the platform object implements the requested interface in this world. */
  unwrap<T extends object>(
    platformObject: unknown,
    implClass: ImplementationClass<T>,
  ): StampedImplInstance<T> | undefined {
    const assembled = this.#binding.resolveInterface(implClass);
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
    return this.#binding.associate(implClass, implInst);
  }
}

/** Add this binding's result conversion to the realm's implementation Promise constructor. */
function createWebIDLPromiseConstructor(context: BindingContext, binding: RealmBinding): typeof InternalPromise {
  return class WebIDLPromise<T> extends context.realm.Promise<T> {
    static override withResolvers<T>(type: PromiseResultType<T>): InternalPromiseWithResolvers<T> {
      if (type.kind === 'implementation') return super.withResolvers(type);
      const resultType = binding.assembly.getPromiseResultType(type);
      const converter = binding.getConverter(resultType);
      const toImpl = binding.implementationConverter.createConverter(resultType, {});
      const idlPromise = new IDLPromise(resultType, context.realm, (value) => context.realizeException(value));
      const promise = new this(idlPromise.promise, resultType as typeof resultType & PromiseResultType<T>, (value) =>
        toImpl(converter.jsToIDL(value), context) as T);
      return {
        promise,
        get isResolved() { return idlPromise.resolved; },
        resolve(value) {
          try {
            if (value instanceof InternalPromise) {
              idlPromise.resolve(value.backing);
            } else {
              // Conversion precedes the native resolving function, including reentrant resolution.
              idlPromise.resolve(converter.idlToJS(value));
            }
          } catch (error) { idlPromise.reject(error); }
        },
        reject(reason) { idlPromise.reject(reason); },
      };
    }
  };
}
