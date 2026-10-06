import {
  ExceptionRequestStamper, InternalError, InternalPromise, Stamper,
  type InternalPromiseWithResolvers, type PromiseResultType,
} from '../../infra/index';
import { getAssociatedRealm, isObject } from '../../js-engine/index';
import {
  DOMExceptionImpl, type DOMExceptionConstructor,
  type ImplementationClass, type ImplementationType, type InjectedArgument, type WebIDLType,
} from '../core/index';

import type { WebIDLEnvironment, WebIDLRealm } from '../environment';
import {
  AssembledInterface, type IDLType, type IDLDictionaryType, type IDLAttribute,
  type AssembledDictionary, type DefinitionAssembly,
} from '../assembly/index';
import { IDLPromise, type IDLMapEntries, type IDLSetEntries } from '../values/index';
import {
  createConverter, DictionaryConverter, ImplementationConverter, type Converter, type ConverterFor,
} from '../converters/index';

import {
  getImplementationRecord, getPlatformRecord, isStampedImplInstance, isStampedPlatformObject, PlatformRecord,
  stampImplementation, type StampedImplInstance, type StampedPlatformObject,
} from './platform';
import {
  AsyncIterableBinding, CallbackBinding, MaplikeBinding, SetlikeBinding, GlobalPlatformObjectBinding,
  ImplementationBinding, SynchronousIterableBinding, LegacyPlatformObjectBinding, ObservableArrayBinding,
  invalidReceiver, type BoundConstruct, type IDLMember, type ConstructorBehavior, type MemberBinding,
  type MemberOwner,
} from './realm/index';
import type { BindingContext, BindingWorld } from './world';

/** Realm-wide identity, allocation, conversion, and receiver services used by construct bindings. */
export class RealmBinding<Env extends WebIDLEnvironment = WebIDLEnvironment> {
  assembly: DefinitionAssembly;
  world: BindingWorld;
  /** Project DOMExceptions and realize Infra exception requests once; preserve other values. */
  realizeException: (value: unknown) => unknown;
  realm: Env['realm'];
  /** InternalPromise constructor whose results use this realm's Web IDL conversion. */
  Promise: typeof InternalPromise;
  implementationConverter: ImplementationConverter;
  /** Construct-specific services share this realm's allocation and receiver facilities. */
  callbacks: CallbackBinding;
  maplikes: MaplikeBinding;
  setlikes: SetlikeBinding;
  asyncIterables: AsyncIterableBinding;
  globalPlatformObjects: GlobalPlatformObjectBinding;
  iterables: SynchronousIterableBinding;
  legacyPlatformObjects: LegacyPlatformObjectBinding;
  observableArrays: ObservableArrayBinding;

  /** The projected global and any engine-supplied objects reserved for its prototype chain. */
  globalObject: PlatformRecord | undefined;
  globalAllocation: GlobalObjectAllocation | undefined;

  /** Owning environment, unavailable until its composition factory returns. */
  #env: Env | undefined;
  /** Each assembled construct has one implementation binding in this realm. */
  #implementationBindings = new Map<BoundConstruct, ImplementationBinding>();
  /** Type converters for this binding, without keeping discarded conversion realms alive. */
  #converters = new WeakMap<WebIDLRealm, Map<IDLType, Converter>>();
  /** Dictionary conversion plans are shared across invocations in the same conversion realm. */
  #dictionaryConverters = new WeakMap<WebIDLRealm, Map<AssembledDictionary, DictionaryConverter>>();

  constructor(
    assembly: DefinitionAssembly,
    realm: Env['realm'],
    world: BindingWorld,
    createEnvironment: (ctx: BindingContext<Env>) => Env,
  ) {
    this.assembly = assembly;
    this.realm = realm;
    this.world = world;
    // Realize internal exceptions once and preserve the error across realms.
    // https://webidl.spec.whatwg.org/#js-creating-throwing-exceptions
    this.realizeException = (value) => {
      if (!isObject(value)) return value;
      if (DOMExceptionImpl.is(value)) {
        // An already-owned exception keeps its platform identity, even when
        // delivered through another world; do not associate it a second time.
        return getImplementationRecord(value)?.project() ?? this.project(DOMExceptionImpl, value);
      }
      const request = ExceptionRequestStamper.get(value);
      if (!request) return value;
      const existing = ExceptionRealizationStamper.get(value);
      if (existing) return existing;
      let error: object;
      switch (request.type) {
        case 'TypeError':
          error = new this.realm.intrinsics.typeError(request.exception.message);
          break;
        case 'RangeError':
          error = new this.realm.intrinsics.rangeError(request.exception.message);
          break;
        case 'SyntaxError':
          error = new this.realm.intrinsics.syntaxError(request.exception.message);
          break;
      }
      void ExceptionRealizationStamper.stamp(value, error);
      return error;
    };
    this.callbacks = new CallbackBinding(this);
    this.asyncIterables = new AsyncIterableBinding(this);
    this.maplikes = new MaplikeBinding(this);
    this.setlikes = new SetlikeBinding(this);
    this.globalPlatformObjects = new GlobalPlatformObjectBinding(this);
    this.iterables = new SynchronousIterableBinding(this);
    this.legacyPlatformObjects = new LegacyPlatformObjectBinding(this);
    this.observableArrays = new ObservableArrayBinding(this);
    this.implementationConverter = new ImplementationConverter(this);
    this.Promise = createWebIDLPromiseConstructor(this);
    this.#env = createEnvironment(this);
    if (this.#env.realm !== this.realm) {
      throw new InternalError('The binding environment belongs to a different realm');
    }
  }

  /** The realm's original DOMException constructor, independent of its global property. */
  get DOMException(): DOMExceptionConstructor {
    const binding = this.getImplementationBinding(this.resolveInterface('DOMException'));
    return binding.getInterfaceObject() as unknown as DOMExceptionConstructor;
  }

  /** Install this realm's exposed definitions on the supplied global object. */
  install(target: object): void {
    this.installDefinitions(target);
  }

  /** Project a global implementation, optionally adopting an engine allocation. */
  projectGlobalObject(
    implInst: object,
    interfaceName: string,
    allocation?: GlobalObjectAllocation,
  ): StampedPlatformObject {
    const assembled = this.resolveInterface(interfaceName);
    return this.projectGlobalRecord(implInst, assembled, allocation).platformObject!;
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
    const compiled = this.assembly.getIDLType(type);
    return this.implementationConverter.idlToImpl(
      this.getConverter(compiled).jsToIDL(value),
      compiled,
      {},
      this,
    );
  }

  /** Convert a declared implementation result to its author-facing representation. */
  implToJS(value: unknown, type: WebIDLType): unknown {
    return this.getConverter(this.assembly.getIDLType(type)).idlToJS(value);
  }

  /** Create a platform object by interface name; return undefined if unknown or unexposed. */
  // https://webidl.spec.whatwg.org/#new
  createPlatformRecord(interfaceName: string): PlatformRecord | undefined {
    const assembled = this.assembly.interfaces.get(interfaceName);
    if (!assembled || !assembled.isExposed(this.realm)) return;
    return this.allocatePlatformRecord(assembled);
  }

  /**
   * Find this world's binding record from either object identity without projecting.
   * The record's platformObject remains absent until projection.
   */
  getObjectRecord(value: unknown): Readonly<PlatformRecord> | undefined {
    const record = getPlatformRecord(value) ?? getImplementationRecord(value);
    return record?.binding.world === this.world ? record : undefined;
  }

  /** Construct and associate an implementation using its declared injected arguments. */
  construct<T extends object>(
    implClass: ImplementationClass<T>,
    argumentsList: unknown[] = [],
  ): StampedImplInstance<T> {
    const assembled = this.resolveInterface(implClass);
    const definition = assembled.primary.implementation;
    const implInst: T = Reflect.construct(
      implClass as new (...argumentsList: unknown[]) => T,
      this.resolveArguments(argumentsList, definition?.constructWith ?? []),
    );
    return stampImplementation(implInst, assembled, this);
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
    const assembled = this.resolveInterface(implClass);
    const record = getPlatformRecord(platformObject);
    return record?.binding.world === this.world &&
      record.implements(assembled)
      ? record.implInst as StampedImplInstance<T>
      : undefined;
  }

  /** Retrieve or create the platform object for an implementation through its registered interface. */
  project<T extends object>(implClass: ImplementationClass<T>, implInst: T): StampedPlatformObject {
    return this.associate(implClass, implInst).project();
  }

  /** Resolve an interface name or implementation class to its assembled definition. */
  resolveInterface(nameOrClass: string | ImplementationClass): AssembledInterface {
    const assembled = this.assembly.interfaces.get(nameOrClass);
    if (!assembled) {
      throw new InternalError(typeof nameOrClass === 'string'
        ? `Unknown Web IDL interface ${nameOrClass}`
        : 'No Web IDL interface is registered for this implementation');
    }
    return assembled;
  }

  /** Invoke implementation code and realize its exceptions as they cross into Binding. */
  callImplementation<This, Values extends unknown[], Result>(
    implementation: (this: This, ...values: Values) => Result,
    thisArgument: This,
    values: Values,
  ): Result {
    try {
      return Reflect.apply(implementation, thisArgument, values);
    } catch (exception) {
      throw this.realizeException(exception);
    }
  }

  /** Retrieve this realm's registered steps and platform objects for an assembled construct. */
  getImplementationBinding<Assembled extends BoundConstruct>(assembled: Assembled): ImplementationBinding<Assembled> {
    let binding = this.#implementationBindings.get(assembled);
    if (!binding) {
      binding = new ImplementationBinding(this, assembled);
      this.#implementationBindings.set(assembled, binding);
    }
    return binding as ImplementationBinding<Assembled>;
  }

  /** Reuse conversion machinery without resolving an already assembled type again. */
  getConverter<Type extends IDLType>(type: Type, realm: WebIDLRealm = this.realm): ConverterFor<Type> {
    let converters = this.#converters.get(realm);
    if (!converters) this.#converters.set(realm, converters = new Map<IDLType, Converter>());
    const cached = converters.get(type);
    // The assembled type used as the key determines the converter subclass and result contract.
    if (cached) return cached as ConverterFor<Type>;
    const converter = createConverter(type, this, realm);
    converters.set(type, converter);
    return converter;
  }

  /** Share dictionary member preparation while retaining each assembled type use. */
  getDictionaryConverter<Type extends IDLDictionaryType>(type: Type, realm: WebIDLRealm): DictionaryConverter<Type> {
    let converters = this.#dictionaryConverters.get(realm);
    if (!converters) this.#dictionaryConverters.set(realm, converters = new Map<AssembledDictionary, DictionaryConverter>());
    const shared = converters.get(type.assembled);
    const converter = new DictionaryConverter(type, this, realm, shared);
    if (!shared) converters.set(type.assembled, converter);
    return converter;
  }

  /** Find a member's binding on its including interface or an ancestor. */
  getMemberBinding(
    assembled: MemberOwner,
    member: IDLMember,
  ): MemberBinding | undefined {
    for (
      let currentAssembled: MemberOwner | undefined = assembled;
      currentAssembled;
      currentAssembled = currentAssembled instanceof AssembledInterface ? currentAssembled.parentAssembled : undefined
    ) {
      const binding = this.#implementationBindings.get(currentAssembled)?.members?.get(member);
      if (binding) return binding;
    }
  }

  // Project installer for Web IDL §3.8 Platform objects implementing interfaces — global property references.
  installDefinitions(
    target: object = this.globalObject?.platformObject ?? this.realm.global,
    isWindow = this.realm.globalNames.has('Window'),
  ): Map<string, object> {
    const installed = this.getExposedGlobalProperties(isWindow);

    for (const [name, object] of installed) {
      if (!Reflect.defineProperty(target, name, {
        configurable: true,
        enumerable: false,
        value: object,
        writable: true,
      })) throw new InternalError(`Could not define Web IDL property ${name}`);
    }
    return installed;
  }

  // Extracted from Web IDL §3.8 Platform objects implementing interfaces — define the global property
  // references.
  // Collect the references before installing them on a global object.
  getExposedGlobalProperties(
    isWindow = this.realm.globalNames.has('Window'),
  ): Map<string, object> {
    const installed = new Map<string, object>();
    const interfaces = this.assembly.interfaces.inInheritanceOrder((assembled) => assembled.isExposed(this.realm));

    for (const assembled of interfaces) {
      const definition = assembled.primary;
      const binding = this.getImplementationBinding(assembled);
      binding.getInterfacePrototypeObject();
      if (
        assembled.hasInterfaceObject() &&
        assembled.getLegacyNamespace() === undefined
      ) {
        const object = binding.getInterfaceObject();
        installed.set(definition.name, object);
        if (isWindow) {
          for (const alias of assembled.getLegacyWindowAliases()) {
            installed.set(alias, object);
          }
        }
      }
      for (const name of assembled.getLegacyFactoryNames()) {
        installed.set(name, binding.getLegacyFactoryFunction(name));
      }
    }
    for (const assembled of this.assembly.callbackInterfaces.withInterfaceObjects()) {
      const definition = assembled.primary;
      if (!assembled.isExposed(this.realm)) continue;
      installed.set(
        definition.name,
        this.getImplementationBinding(assembled).getLegacyCallbackInterfaceObject(),
      );
    }
    for (const assembled of this.assembly.namespaces.values()) {
      if (
        assembled.primary.exposed === undefined ||
        !assembled.isExposed(this.realm)
      ) continue;
      installed.set(
        assembled.primary.name,
        this.getImplementationBinding(assembled).getNamespaceObject(),
      );
    }
    return installed;
  }

  // Project adapter: preserve an existing owner or stamp a fresh result with this receiver binding.
  projectImplementationObject(
    implInst: object,
    expectedAssembled: AssembledInterface,
  ): StampedPlatformObject | undefined {
    return this.associateImplementationObject(implInst, expectedAssembled)?.project();
  }

  /** Establish an implementation's binding record without projection, preserving an existing owner. */
  associate<T extends object>(implClass: ImplementationClass<T>, implInst: T): PlatformRecord<T> {
    if (getPlatformRecord(implInst)) {
      throw new InternalError('Expected an implementation target');
    }
    const record = this.associateImplementationObject(implInst, this.resolveInterface(implClass));
    if (!record) {
      throw new InternalError('Implementation target is associated with another interface');
    }
    return record;
  }

  /** Associate an implementation with its interface and owner without allocating its platform object. */
  associateImplementationObject<T extends object>(
    implInst: T,
    expectedAssembled: AssembledInterface,
  ): PlatformRecord<T> | undefined {
    const existing = getImplementationRecord(implInst);
    if (existing) {
      if (existing.binding.world !== this.world) {
        throw new InternalError('Implementation instance belongs to another binding world');
      }
      return existing.assembled.implements(expectedAssembled)
        ? existing
        : undefined;
    }

    const assembled = this.assembly.interfaces.findForImplementation(implInst);
    if (
      !assembled ||
      !assembled.implements(expectedAssembled)
    ) return;
    return new PlatformRecord(implInst, assembled, this);
  }

  // Project allocation entry point for Web IDL §3.8 Platform objects implementing interfaces — create a new
  // object implementing the interface, returning its shared record.
  allocatePlatformRecord(
    assembled: AssembledInterface,
    newTarget?: object,
  ): PlatformRecord {
    if (!assembled.isExposed(this.realm)) {
      throw new InternalError(
        `Interface ${assembled.primary.name} is not exposed in this realm`,
      );
    }
    if (assembled.isGlobal()) {
      throw new InternalError(
        `Global interface ${assembled.primary.name} requires global exotic object machinery`,
      );
    }

    const prototype = this.#getPlatformObjectPrototype(assembled, newTarget);

    const createImplementation = this.getImplementationBinding(assembled).createImplementation;
    if (!createImplementation) {
      throw new InternalError(
        `Interface ${assembled.primary.name} has no implementation creation steps`,
      );
    }
    const implInst = createImplementation();
    const platformObject = this.allocatePlatformObject(implInst, assembled, prototype);
    return this.initializePlatformObject(platformObject, assembled, implInst);
  }

  // Project adapter: construct or initialize the implementation, then project its platform object.
  constructPlatformObject(
    assembled: AssembledInterface,
    behavior: ConstructorBehavior,
    values: unknown[],
    newTarget: object,
  ): StampedPlatformObject {
    if (behavior.kind === 'initialize') {
      const record = this.allocatePlatformRecord(assembled, newTarget);
      behavior.steps(record.implInst, values);
      return record.platformObject!;
    }

    const prototype = this.#getPlatformObjectPrototype(assembled, newTarget);
    const implInst = behavior.steps(values);
    const platformObject = this.allocatePlatformObject(implInst, assembled, prototype);
    return this.initializePlatformObject(platformObject, assembled, implInst).platformObject!;
  }

  // Extracted from Web IDL §3.8 Platform objects implementing interfaces — internally create a new object
  // implementing the interface: prototype selection.
  #getPlatformObjectPrototype(
    assembled: AssembledInterface,
    newTarget?: object,
  ): object {
    if (!newTarget) return this.getImplementationBinding(assembled).getInterfacePrototypeObject();

    const candidate: unknown = this.realm.intrinsics.reflectGet(newTarget, 'prototype');
    if (isObject(candidate)) return candidate;

    // Web IDL's interface-object fallback uses newTarget's function realm,
    // after reading prototype. The platform object still belongs to this realm.
    try {
      const realm = getAssociatedRealm(newTarget);
      const binding = realm === this.realm ? this :
        realm && this.world.getRealmBinding(realm);
      if (!binding) {
        return this.throwTypeError('newTarget realm has no registered Web IDL binding');
      }
      return binding.getImplementationBinding(binding.resolveInterface(assembled.primary.name)).getInterfacePrototypeObject();
    } catch (error) {
      throw this.realizeException(error);
    }
  }

  /** Allocate an ordinary or legacy platform object, leaving association to its record. */
  // Allocate before creating a new record: implementation initialization must follow allocation.
  allocatePlatformObject(
    implInst: object,
    assembled: AssembledInterface,
    prototype = this.getImplementationBinding(assembled).getInterfacePrototypeObject(),
  ): object {
    if (assembled.isGlobal()) {
      throw new InternalError(
        `Use projectGlobalObject for ${assembled.primary.name}`,
      );
    }
    let backingObject: object;
    if (implInst instanceof DOMExceptionImpl) {
      // https://webidl.spec.whatwg.org/#js-DOMException-specialness
      backingObject = new this.realm.intrinsics.error();
      Object.setPrototypeOf(backingObject, prototype);
    } else {
      backingObject = this.realm.createOrdinaryObject(prototype);
    }
    return this.legacyPlatformObjects.createObject(
      backingObject,
      implInst,
      this.getImplementationBinding(assembled).getLegacyPropertyMetadata(),
    );
  }

  // Project adapter for Web IDL §3.8 Platform objects implementing interfaces — allocation and members of a
  // [Global] object.
  projectGlobalRecord<T extends object>(
    implInst: T,
    assembled: AssembledInterface,
    allocation?: GlobalObjectAllocation,
  ): PlatformRecord<T> {
    if (!assembled.isGlobal()) {
      throw new InternalError(`${assembled.primary.name} is not a global interface`);
    }
    if (!assembled.isExposed(this.realm)) {
      throw new InternalError(
        `Interface ${assembled.primary.name} is not exposed in this realm`,
      );
    }
    if (this.globalObject) {
      throw new InternalError('This binding already has a projected global object');
    }
    if (assembled.findSpecialOperation('getter', 'unsigned long') !== undefined) {
      throw new InternalError('Global interfaces cannot use indexed properties');
    }
    this.getImplementationBinding(assembled).assertOrdinaryProjection();
    this.globalAllocation = allocation;
    if (allocation) {
      for (const interfaceName of allocation.prototypes.keys()) {
        const prototypeAssembled = this.resolveInterface(interfaceName);
        if (this.getImplementationBinding(prototypeAssembled).interfacePrototypeObject) {
          throw new InternalError(`Prototype ${interfaceName} was already created before global allocation`);
        }
      }
    }
    const prototype = this.getImplementationBinding(assembled).getInterfacePrototypeObject();
    if (allocation && Reflect.getPrototypeOf(allocation.object) !== prototype) {
      throw new InternalError('Allocated global object has the wrong prototype');
    }
    const platformObject = allocation?.object ?? this.globalPlatformObjects.createObject(
      this.realm.createOrdinaryObject(prototype),
    );
    const record = this.initializePlatformObject(
      platformObject,
      assembled,
      implInst,
    );
    this.globalObject = record;

    this.getImplementationBinding(assembled).defineOperations(platformObject, 'regular');
    this.getImplementationBinding(assembled).defineAttributes(platformObject, 'regular');
    this.getImplementationBinding(assembled).defineStringifier(platformObject, 'regular');
    this.getImplementationBinding(assembled).defineIterationMethods(platformObject);
    this.getImplementationBinding(assembled).defineAsyncIterationMethods(platformObject);
    this.getImplementationBinding(assembled).defineCollectionMembers(platformObject);
    const windowAssembled = this.assembly.interfaces.get('Window');
    this.installDefinitions(platformObject, Boolean(windowAssembled && record.implements(windowAssembled)));
    return record;
  }

  // Web IDL §3.8 Platform objects implementing interfaces — changing a platform object's associated realm.
  changePlatformObjectRealm(platformObject: object): void {
    const record = getPlatformRecord(platformObject);
    if (record?.binding.world !== this.world) {
      throw new InternalError('Value is not a platform object in this binding world');
    }

    const prototype = this.getImplementationBinding(record.assembled).getInterfacePrototypeObject();
    if (
      Reflect.getPrototypeOf(platformObject) !== prototype &&
      !Reflect.setPrototypeOf(platformObject, prototype)
    ) {
      throw new InternalError('Could not change the public platform object prototype');
    }
    record.binding = this;
  }

  /** Associate both identities and initialize exception recognition and per-object binding state. */
  initializePlatformObject<T extends object>(
    platformObject: object,
    assembled: AssembledInterface,
    implInst: T,
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

    const record = getImplementationRecord(implInst) ?? new PlatformRecord(implInst, assembled, this);
    if (record.binding !== this || record.assembled !== assembled) {
      throw new InternalError('Implementation object is already associated with another owner or platform object');
    }
    record.attachPlatformObject(platformObject);
    return record;
  }

  // Initialize the implementation before its record is stamped.
  initializeImplementation(
    implInst: object,
    assembled: AssembledInterface,
  ): void {
    for (const ancestorAssembled of assembled.getInheritanceChain()) {
      this.getImplementationBinding(ancestorAssembled).initializeImplementation?.(implInst);
    }
  }

  // Retrieve the implementation's retained map entries.
  getMapEntries(object: object): IDLMapEntries {
    const record = getPlatformRecord(object) ?? getImplementationRecord(object);
    return this.maplikes.getEntries(
      record?.binding.world === this.world ? record : undefined,
    );
  }

  // Retrieve the implementation's retained set entries.
  getSetEntries(object: object): IDLSetEntries {
    const record = getPlatformRecord(object) ?? getImplementationRecord(object);
    return this.setlikes.getEntries(
      record?.binding.world === this.world ? record : undefined,
    );
  }

  // Locate an observable-array member and retrieve its backing list.
  getObservableArrayBackingList(
    object: object,
    attribute: IDLAttribute,
  ): unknown[] {
    const record = getPlatformRecord(object);
    const elementType = this.assembly.getObservableArrayElementType(attribute.type);
    if (
      record?.binding.world !== this.world ||
      !elementType ||
      !record.assembled.includesMember(attribute)
    ) {
      throw new InternalError('Observable array attribute does not belong to object');
    }
    return this.observableArrays.getBackingList(
      record,
      attribute,
      elementType,
    );
  }

  /** Recognize this world's platform objects and values accepted by its proxy declarations. */
  // https://webidl.spec.whatwg.org/#idl-objects
  isPlatformObject(value: unknown): boolean {
    if (getPlatformRecord(value)?.binding.world === this.world) return true;
    return this.assembly.proxyObjects.is(value);
  }

  // Project delegate to Web IDL §3.8 Platform objects implementing interfaces — implements.
  implements(
    platformObject: unknown,
    assembled: AssembledInterface,
  ): boolean {
    const record = getPlatformRecord(platformObject);
    return record?.binding.world === this.world &&
      record.implements(assembled);
  }

  // Project adapter for the receiver and security checks in Web IDL §3.7.6 Attributes and §3.7.7 Operations.
  getReceiverRecord(
    thisArgument: unknown,
    assembled: AssembledInterface,
    identifier: string,
    type: 'getter' | 'method' | 'setter',
    lenient: false,
  ): PlatformRecord;
  getReceiverRecord(
    thisArgument: unknown,
    assembled: AssembledInterface,
    identifier: string,
    type: 'getter' | 'method' | 'setter',
    lenient: boolean,
  ): PlatformRecord | typeof invalidReceiver;
  getReceiverRecord(
    thisArgument: unknown,
    assembled: AssembledInterface,
    identifier: string,
    type: 'getter' | 'method' | 'setter',
    lenient: boolean,
  ): PlatformRecord | typeof invalidReceiver {
    const value = this.resolveThisValue(thisArgument);
    const record = this.#resolveReceiverRecord(value);
    if (record) {
      this.realm.performSecurityCheck(record.platformObject!, identifier, type);
    }
    if (!record || !record.implements(assembled)) {
      if (lenient) return invalidReceiver;
      return this.throwTypeError('Illegal invocation');
    }
    return record;
  }

  /** Require a direct platform receiver in this world, checking security before its interface. */
  // Shared receiver steps of Web IDL iterable, async iterable, maplike, and setlike declarations.
  getDirectReceiverRecord(
    value: unknown,
    assembled: AssembledInterface,
    identifier: string,
    type: 'getter' | 'method',
  ): PlatformRecord {
    if (!isObject(value)) this.throwTypeError('Illegal invocation');
    const record = getPlatformRecord(value);
    if (record?.binding.world !== this.world) this.throwTypeError('Illegal invocation');
    this.realm.performSecurityCheck(value, identifier, type);
    if (!record.implements(assembled)) this.throwTypeError('Illegal invocation');
    return record;
  }

  // Resolve direct platform receivers and proxy object receiver aliases.
  #resolveReceiverRecord(
    value: unknown,
  ): PlatformRecord | undefined {
    const direct = getPlatformRecord(value);
    if (direct?.binding.world === this.world) return direct;

    for (const platformObject of this.assembly.proxyObjects.resolveReceivers(value)) {
      const record = getPlatformRecord(platformObject);
      if (record?.binding.world === this.world) return record;
    }
    return undefined;
  }

  // Extracted from Web IDL §3.7.6 Attributes and §3.7.7 Operations — replace a null or undefined receiver with
  // the global object.
  resolveThisValue(thisArgument: unknown): unknown {
    return thisArgument ?? this.globalObject?.platformObject ?? this.realm.global;
  }

  // Throw a TypeError allocated in this binding's realm.
  throwTypeError(message: string): never {
    throw new this.realm.intrinsics.typeError(message);
  }
}

/** Add this binding's result conversion to the realm's implementation Promise constructor. */
function createWebIDLPromiseConstructor(binding: RealmBinding): typeof InternalPromise {
  return class WebIDLPromise<T> extends binding.realm.Promise<T> {
    static override withResolvers<T>(type: PromiseResultType<T>): InternalPromiseWithResolvers<T> {
      if (type.kind === 'implementation') return super.withResolvers(type);
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- Adopted values are observed through the destination constructor.
      const P = this;
      const resultType = binding.assembly.getPromiseResultType(type);
      const converter = binding.getConverter(resultType);
      const toImpl = binding.implementationConverter.createConverter(resultType, {});
      const idlPromise = new IDLPromise(resultType, binding.realm, (value) => binding.realizeException(value));
      const promise = new this(idlPromise.promise, resultType as typeof resultType & PromiseResultType<T>, (value) =>
        toImpl(converter.jsToIDL(value), binding) as T);
      return {
        promise,
        get isResolved() { return idlPromise.resolved; },
        resolve(value) {
          try {
            if (value instanceof InternalPromise) {
              if (value.backing === idlPromise.promise ||
                (!value.usesInternalStorage && value.type.kind !== 'implementation' &&
                  binding.assembly.getPromiseResultType(value.type).conversionKey === resultType.conversionKey)) {
                // Preserve native adoption, including identity and self-resolution rejection.
                idlPromise.resolve(value.backing);
              } else {
                idlPromise.adopt(P.fromInternal(value), converter.getIDLToJSSteps());
              }
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

/** Privately retain the realm-owned error for an internal failure. */
class ExceptionRealizationStamper extends Stamper {
  #realizedError: object;

  private constructor(exception: object, realizedError: object) {
    super(exception);
    this.#realizedError = realizedError;
  }

  static stamp<T extends object>(
    exception: T,
    realizedError: object,
  ): T & ExceptionRealizationStamper {
    new ExceptionRealizationStamper(exception, realizedError);
    return exception as T & ExceptionRealizationStamper;
  }

  static get(exception: object): object | undefined {
    return #realizedError in exception ? exception.#realizedError : undefined;
  }
}
/** Supply before projecting any object that needs these interface prototypes. */
export type GlobalObjectAllocation = {
  object: object;
  prototypes: ReadonlyMap<string, object>;
  namedProperties?: {
    object: object;
    setDelegate(delegate: object): void;
  };
};
