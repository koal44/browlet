import { getAssociatedRealm, isObject, type JSFunction } from '../js-engine/index';
import { ExceptionRequestStamper } from '../infra/exceptions';
import { Stamper } from '../infra/stamper';
import type { DefinitionAssembly } from './assembly';
import {
  AssembledInterface, type AssembledCallable, type AssembledCallbackInterface, type AssembledInterfaceMember,
  type AssembledDictionary, type AssembledNamespace, type AssembledNamespaceMember, type AssembledOverloads,
} from './assembled';
import { AsynchronousIterableBinding } from './async-iterable';
import {
  CollectionBinding, type IDLMapEntries, type IDLSetEntries,
} from './collection';
import {
  convertToJavaScript, createDictionaryConverter, createIDLConverter, createJavaScriptConverter, materializeDefaultValue,
  type ConversionContext, type DictionaryConverter,
} from './conversion';
import { hasExtendedAttribute } from './core/helpers';
import { idlType } from './core/types';
import type {
  AttributeMember, ConstantMember, Exposure, ExtendedAttribute,
  OperationMember, StringifierMember, WebIDLType,
} from './core/types';
import { GlobalPlatformObjectBinding } from './global-platform-object';
import {
  DefinitionBinding, type PlatformDefinition, type PlatformMemberDefinition, type ConstructorBehavior,
  type DefaultToJSONAttribute, type InterfaceObject, type MemberBinding, type MemberFunctionKind,
  type PlatformObjectAllocationSteps,
} from './definition-binding';
import { SynchronousIterableBinding } from './iterable';
import type { WebIDLEnvironment } from './realm';
import { BindingContext } from './binding-context';
import {
  LegacyPlatformObjectBinding, type LegacyPropertyMetadata,
} from './legacy-platform-object';
import { createOverloadResolver } from './overload';
import { ObservableArrayBinding } from './observable-array';
import {
  associatePlatformObject, getImplementationRecord, getPlatformRecord,
  PlatformRecord, type StampedPlatformObject,
} from './platform-object';
import type { BindingWorld } from './binding-world';
import { createRejectedPromise } from './promise';
import { InternalError } from '../infra/internal-error';

export class RealmBinding<Env extends WebIDLEnvironment = WebIDLEnvironment> {
  assembly: DefinitionAssembly;
  world: BindingWorld;
  realizeException: (value: unknown) => unknown;
  realm: Env['realm'];
  context: BindingContext<Env>;
  defaultConversionContext: ConversionContext;
  #collections: CollectionBinding;
  #asyncIterables: AsynchronousIterableBinding;
  #definitionBindings = new Map<PlatformDefinition, DefinitionBinding>();
  #dictionaryConverters = new Map<AssembledDictionary, DictionaryConverter>();
  #globalPlatformObjects: GlobalPlatformObjectBinding;
  #globalObject: PlatformRecord | undefined;
  #globalAllocation: GlobalObjectAllocation | undefined;
  #iterables: SynchronousIterableBinding;
  #legacyPlatformObjects: LegacyPlatformObjectBinding;
  #observableArrays: ObservableArrayBinding;

  // Project helper: compose this realm's definition records and binding machinery.
  constructor(
    assembly: DefinitionAssembly,
    realm: Env['realm'],
    world: BindingWorld,
    createEnvironment: (ctx: BindingContext<Env>) => Env,
  ) {
    this.assembly = assembly;
    this.realm = realm;
    this.world = world;
    this.defaultConversionContext = { binding: this, realm };
    // Project adapter: realize internal exceptions once and preserve the error across realms.
    // Web IDL §3.14.3 Creating and throwing exceptions supplies the realm-allocation rules.
    this.realizeException = (value) => {
      if (!isObject(value)) return value;
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
        case 'DOMException':
          error = new this.DOMException(request.exception.message, request.exception.name);
          break;
      }
      void ExceptionRealizationStamper.stamp(value, error);
      return error;
    };
    this.#asyncIterables = new AsynchronousIterableBinding(this);
    this.#collections = new CollectionBinding(this.defaultConversionContext);
    this.#globalPlatformObjects = new GlobalPlatformObjectBinding(this);
    this.#iterables = new SynchronousIterableBinding(this);
    this.#legacyPlatformObjects = new LegacyPlatformObjectBinding(this);
    this.#observableArrays = new ObservableArrayBinding(this);
    this.context = new BindingContext(this, createEnvironment);
  }

  // The constructor belongs to this realm's binding world and shares its interface-object cache.
  get DOMException(): typeof globalThis.DOMException {
    return this.#getInterfaceObject(
      this.resolveInterface('DOMException'),
    ) as unknown as typeof globalThis.DOMException;
  }

  // Project boundary: resolve an interface name before using its assembled definition.
  resolveInterface(interfaceName: string): AssembledInterface {
    const assembled = this.assembly.interfaces.get(interfaceName);
    if (!assembled) throw new InternalError(`Unknown Web IDL interface ${interfaceName}`);
    return assembled;
  }

  /** Retrieve this realm's adapters and generated objects for a definition. */
  getDefinitionBinding(assembled: PlatformDefinition): DefinitionBinding {
    let binding = this.#definitionBindings.get(assembled);
    if (!binding) {
      binding = new DefinitionBinding();
      this.#definitionBindings.set(assembled, binding);
    }
    return binding;
  }

  /** Retain dictionary conversion plans without retaining converted author values. */
  getDictionaryConverter(assembled: AssembledDictionary): DictionaryConverter {
    let convert = this.#dictionaryConverters.get(assembled);
    if (!convert) {
      convert = createDictionaryConverter(assembled, this.assembly);
      this.#dictionaryConverters.set(assembled, convert);
    }
    return convert;
  }

  /** Find a member's binding on its including interface or an ancestor. */
  getMemberBinding(
    assembled: MemberOwnerDefinition,
    member: PlatformMemberDefinition,
  ): MemberBinding | undefined {
    for (
      let currentAssembled: MemberOwnerDefinition | undefined = assembled;
      currentAssembled;
      currentAssembled = currentAssembled instanceof AssembledInterface ? currentAssembled.parentAssembled : undefined
    ) {
      const binding = this.#definitionBindings.get(currentAssembled)?.members?.get(member);
      if (binding) return binding;
    }
  }

  // Project installer for Web IDL §3.8 Platform objects implementing interfaces — global property references.
  install(
    target: object = this.#globalObject?.platformObject ?? this.realm.global,
    isWindow = this.realm.globalNames.has('Window'),
  ): Map<string, object> {
    const installed = this.getExposedGlobalProperties(isWindow);

    for (const [name, object] of installed) {
      defineProperty(target, name, {
        configurable: true,
        enumerable: false,
        value: object,
        writable: true,
      });
    }
    return installed;
  }

  // Extracted from Web IDL §3.8 Platform objects implementing interfaces — define the global property
  // references.
  // Project helper: collect the references before installing them on a global object.
  getExposedGlobalProperties(
    isWindow = this.realm.globalNames.has('Window'),
  ): Map<string, object> {
    const installed = new Map<string, object>();
    const interfaces = this.assembly.interfaces.inInheritanceOrder((assembled) => this.isExposed(assembled));

    for (const assembled of interfaces) {
      const definition = assembled.primary;
      this.getInterfacePrototypeObject(assembled);
      if (
        assembled.hasInterfaceObject() &&
        assembled.getLegacyNamespace() === undefined
      ) {
        const object = this.#getInterfaceObject(assembled);
        installed.set(definition.name, object);
        if (isWindow) {
          for (const alias of assembled.getLegacyWindowAliases()) {
            installed.set(alias, object);
          }
        }
      }
      for (const name of assembled.getLegacyFactoryNames()) {
        installed.set(name, this.getLegacyFactoryFunction(assembled, name));
      }
    }
    for (const assembled of this.assembly.callbackInterfaces.withInterfaceObjects()) {
      const definition = assembled.primary;
      if (!this.#isConstructExposed(definition)) continue;
      installed.set(
        definition.name,
        this.getLegacyCallbackInterfaceObject(assembled),
      );
    }
    for (const assembled of this.assembly.namespaces.values()) {
      if (
        assembled.primary.exposed === undefined ||
        !this.#isConstructExposed(assembled.primary)
      ) continue;
      installed.set(
        assembled.primary.name,
        this.getNamespaceObject(assembled),
      );
    }
    return installed;
  }

  // Project cache around Web IDL §3.7.1 Interface object — create an interface object.
  #getInterfaceObject(
    assembled: AssembledInterface,
  ): InterfaceObject {
    const definitionBinding = this.getDefinitionBinding(assembled);
    if (definitionBinding.interfaceObject) return definitionBinding.interfaceObject;

    const constructors = assembled.getConstructors(
      (entry) => this.#isMemberExposed(assembled, entry), this.assembly,
    );
    const overridden = definitionBinding.overriddenConstructor;
    const resolve = createOverloadResolver(constructors, this.defaultConversionContext);
    const object: JSFunction = this.realm.createFunction(
      (_thisArgument, argumentsList, newTarget) => {
        if (overridden) {
          return overridden(argumentsList, newTarget, object);
        }
        if (constructors.callables.length === 0) {
          return this.#throwTypeError('Illegal constructor');
        }
        if (!newTarget) {
          return this.#throwTypeError(
            `Failed to construct '${assembled.primary.name}': use the 'new' operator.`,
          );
        }

        const overload = resolve(argumentsList);
        const behavior = this.getMemberBinding(assembled, overload.callable.primary)?.constructorBehavior;
        if (!behavior) {
          throw missingImplementation(assembled, 'constructor');
        }
        return this.#constructPlatformObject(
          assembled,
          behavior,
          overload.values,
          newTarget,
        );
      },
      {
        constructible: true,
        length: constructors.minimumArgumentCount,
        name: assembled.primary.name,
      },
    );

    definitionBinding.interfaceObject = object;
    this.#getUnforgeableObject(assembled);
    Reflect.setPrototypeOf(
      object,
      assembled.parentAssembled
        ? this.#getInterfaceObject(assembled.parentAssembled)
        : this.realm.intrinsics.functionPrototype,
    );

    defineProperty(object, 'prototype', {
      configurable: false,
      enumerable: false,
      value: this.getInterfacePrototypeObject(assembled),
      writable: false,
    });
    this.#defineConstants(object, assembled);
    this.#defineAttributes(object, assembled, 'static');
    this.#defineOperations(object, assembled, 'static');
    return object;
  }

  // Project cache around Web IDL §3.11.1 Legacy callback interface object — create a legacy callback interface
  // object.
  getLegacyCallbackInterfaceObject(
    assembled: AssembledCallbackInterface,
  ): object {
    const definition = assembled.primary;
    const definitionBinding = this.getDefinitionBinding(assembled);
    if (definitionBinding.legacyCallbackInterfaceObject) {
      return definitionBinding.legacyCallbackInterfaceObject;
    }

    const object = this.realm.createFunction(
      () => this.#throwTypeError('Illegal invocation'),
      { length: 0, name: definition.name },
    );
    for (const member of definition.members) {
      if (
        member.kind === 'constant' &&
        this.#isConstructExposed(member)
      ) {
        this.#defineConstant(object, member);
      }
    }
    definitionBinding.legacyCallbackInterfaceObject = object;
    return object;
  }

  // Project cache around Web IDL §3.7.2 Legacy factory functions — create a legacy factory function.
  getLegacyFactoryFunction(
    assembled: AssembledInterface,
    name: string,
  ): JSFunction {
    const definitionBinding = this.getDefinitionBinding(assembled);
    const existing = definitionBinding.legacyFactoryFunctions?.get(name);
    if (existing) return existing;

    const overloads = assembled.getLegacyFactoryOverloads(name, this.assembly);
    const resolve = createOverloadResolver(overloads, this.defaultConversionContext);
    const function_ = this.realm.createFunction(
      (_thisArgument, argumentsList, newTarget) => {
        if (!newTarget) {
          return this.#throwTypeError(
            `Failed to construct '${name}': use the 'new' operator.`,
          );
        }
        const overload = resolve(argumentsList);
        const behavior = this.getMemberBinding(assembled, overload.callable.primary)?.constructorBehavior;
        if (!behavior) {
          throw new InternalError(
            `Web IDL ${assembled.primary.name} legacy factory function ${name} has no implementation steps`,
          );
        }
        return this.#constructPlatformObject(
          assembled,
          behavior,
          overload.values,
          newTarget,
        );
      },
      {
        constructible: true,
        length: overloads.minimumArgumentCount,
        name,
      },
    );
    defineProperty(function_, 'prototype', {
      configurable: false,
      enumerable: false,
      value: this.getInterfacePrototypeObject(assembled),
      writable: false,
    });
    (definitionBinding.legacyFactoryFunctions ??= new Map()).set(name, function_);
    return function_;
  }

  /** Project helper: retain an attribute's returned function alongside its getter in this realm. */
  getAttributeFunction(
    assembled: AssembledInterface,
    attribute: AttributeMember,
    createCallback: () => AttributeFunctionCallback,
  ): JSFunction {
    return this.#getOrCreateMemberFunction(
      'attributeFunction', assembled, attribute,
      () => {
        const callback = createCallback();
        return this.realm.createFunction((thisArgument, argumentsList) => {
          try {
            return Reflect.apply(callback, thisArgument, argumentsList);
          } catch (exception) {
            throw this.realizeException(exception);
          }
        }, { length: callback.length, name: attribute.name });
      },
    );
  }

  // Project cache around Web IDL §3.13.1 Namespace object — create a namespace object.
  getNamespaceObject(
    namespaceAssembled: AssembledNamespace,
  ): object {
    const definitionBinding = this.getDefinitionBinding(namespaceAssembled);
    if (definitionBinding.namespaceObject) return definitionBinding.namespaceObject;

    const object = this.realm.createOrdinaryObject(
      this.realm.intrinsics.objectPrototype,
    );
    definitionBinding.namespaceObject = object;
    this.#defineAttributes(object, namespaceAssembled, 'regular');
    this.#defineOperations(object, namespaceAssembled, 'regular');
    this.#defineConstants(object, namespaceAssembled);

    for (const assembled of this.assembly.interfaces.inNamespace(namespaceAssembled.primary.name)) {
      if (!this.isExposed(assembled)) continue;
      defineProperty(object, assembled.primary.name, {
        configurable: true,
        enumerable: false,
        value: this.#getInterfaceObject(assembled),
        writable: true,
      });
    }
    defineProperty(object, Symbol.toStringTag, {
      configurable: true,
      enumerable: false,
      value: namespaceAssembled.primary.name,
      writable: false,
    });
    return object;
  }

  // Project cache around Web IDL §3.7.3 Interface prototype object — create an interface prototype object.
  getInterfacePrototypeObject(
    assembled: AssembledInterface,
  ): object {
    const definitionBinding = this.getDefinitionBinding(assembled);
    if (definitionBinding.interfacePrototypeObject) {
      return definitionBinding.interfacePrototypeObject;
    }

    this.#assertOrdinaryProjection(assembled);

    const global = assembled.isGlobal();
    const parentPrototype = global &&
      assembled.findSpecialOperation('getter', 'DOMString', this.assembly) !== undefined
      ? this.#getNamedPropertiesObject(assembled)
      : assembled.parentAssembled
        ? this.getInterfacePrototypeObject(assembled.parentAssembled)
        : assembled.primary.name === 'DOMException'
          ? this.realm.intrinsics.errorPrototype
          : this.realm.intrinsics.objectPrototype;
    const allocated = this.#globalAllocation?.prototypes.get(assembled.primary.name);
    const prototype = allocated ?? (this.#hasImmutableGlobalPrototype(assembled)
      ? this.#globalPlatformObjects.createPrototypeObject(parentPrototype)
      : this.realm.createOrdinaryObject(parentPrototype));
    if (Reflect.getPrototypeOf(prototype) !== parentPrototype) {
      throw new InternalError(`Allocated ${assembled.primary.name} prototype has the wrong parent`);
    }
    definitionBinding.interfacePrototypeObject = prototype;

    this.#defineUnscopables(prototype, assembled);
    if (!global) {
      this.#defineAttributes(prototype, assembled, 'regular');
      this.#defineOperations(prototype, assembled, 'regular');
      this.#defineStringifier(prototype, assembled, 'regular');
      this.#defineIterationMethods(prototype, assembled);
      this.#defineAsyncIterationMethods(prototype, assembled);
      this.#defineCollectionMembers(prototype, assembled);
    }
    this.#defineConstants(prototype, assembled);

    if (assembled.hasInterfaceObject()) {
      defineProperty(prototype, 'constructor', {
        configurable: true,
        enumerable: false,
        value: this.#getInterfaceObject(assembled),
        writable: true,
      });
    }
    defineProperty(prototype, Symbol.toStringTag, {
      configurable: true,
      enumerable: false,
      value: assembled.getQualifiedName(),
      writable: false,
    });
    return prototype;
  }

  // Project adapter: preserve an existing owner or stamp a fresh result with this receiver binding.
  projectImplementationObject(
    implInst: object,
    expectedAssembled: AssembledInterface,
  ): StampedPlatformObject | undefined {
    return this.associateImplementationObject(implInst, expectedAssembled)?.project();
  }

  /** Associate an implementation with its interface and owner without allocating its platform object. */
  associateImplementationObject(
    implInst: object,
    expectedAssembled: AssembledInterface,
  ): PlatformRecord | undefined {
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
  createPlatformRecord(
    assembled: AssembledInterface,
    newTarget?: object,
  ): PlatformRecord {
    if (!this.isExposed(assembled)) {
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

    const createImplementation = this.getDefinitionBinding(assembled).createImplementation;
    if (!createImplementation) {
      throw new InternalError(
        `Interface ${assembled.primary.name} has no implementation creation steps`,
      );
    }
    return this.projectPlatformObject(
      createImplementation(),
      assembled,
      prototype,
    );
  }

  // Project adapter: construct or initialize the implementation, then project its platform object.
  #constructPlatformObject(
    assembled: AssembledInterface,
    behavior: ConstructorBehavior,
    values: unknown[],
    newTarget: object,
  ): StampedPlatformObject {
    if (behavior.kind === 'initialize') {
      const record = this.createPlatformRecord(assembled, newTarget);
      Reflect.apply(behavior.steps, record.implInst, values);
      return record.platformObject!;
    }

    const prototype = this.#getPlatformObjectPrototype(assembled, newTarget);
    const implInst = behavior.steps(values);
    return this.projectPlatformObject(
      implInst,
      assembled,
      prototype,
    ).platformObject!;
  }

  // Extracted from Web IDL §3.8 Platform objects implementing interfaces — internally create a new object
  // implementing the interface: prototype selection.
  #getPlatformObjectPrototype(
    assembled: AssembledInterface,
    newTarget?: object,
  ): object {
    if (!newTarget) return this.getInterfacePrototypeObject(assembled);

    const candidate: unknown = this.realm.intrinsics.reflectGet(newTarget, 'prototype');
    if (isObject(candidate)) return candidate;

    // Web IDL's interface-object fallback uses newTarget's function realm,
    // after reading prototype. The platform object still belongs to this realm.
    try {
      const realm = getAssociatedRealm(newTarget);
      const binding = realm === this.realm ? this :
        realm && this.world.getRealmBinding(realm);
      if (!binding) {
        return this.#throwTypeError('newTarget realm has no registered Web IDL binding');
      }
      return binding.getInterfacePrototypeObject(
        binding.resolveInterface(assembled.primary.name),
      );
    } catch (error) {
      throw this.realizeException(error);
    }
  }

  // Project helper: query an assembled interface's exposure in this realm.
  isExposed(assembled: AssembledInterface): boolean {
    return this.#isConstructExposed(assembled.primary);
  }

  // Project adapter: allocate a platform object for an existing implementation.
  projectPlatformObject<T extends object>(
    implInst: T,
    assembled: AssembledInterface,
    prototype = this.getInterfacePrototypeObject(assembled),
  ): PlatformRecord<T> {
    if (assembled.isGlobal()) {
      throw new InternalError(
        `Use projectGlobalObject for ${assembled.primary.name}`,
      );
    }
    const allocatePlatformObject = this.#getPlatformObjectAllocationSteps(assembled);
    const backingObject = allocatePlatformObject
      ? allocatePlatformObject(prototype)
      : this.realm.createOrdinaryObject(prototype);
    if (Reflect.getPrototypeOf(backingObject) !== prototype) {
      throw new InternalError(
        `Platform object for ${assembled.primary.name} has the wrong prototype`,
      );
    }
    return this.initializePlatformObject(
      this.#legacyPlatformObjects.createObject(
        backingObject,
        implInst,
        this.#getLegacyPropertyMetadata(assembled),
      ),
      assembled,
      implInst,
    );
  }

  // Project adapter for Web IDL §3.8 Platform objects implementing interfaces — allocation and members of a
  // [Global] object.
  projectGlobalObject<T extends object>(
    implInst: T,
    assembled: AssembledInterface,
    allocation?: GlobalObjectAllocation,
  ): PlatformRecord<T> {
    if (!assembled.isGlobal()) {
      throw new InternalError(`${assembled.primary.name} is not a global interface`);
    }
    if (!this.isExposed(assembled)) {
      throw new InternalError(
        `Interface ${assembled.primary.name} is not exposed in this realm`,
      );
    }
    if (this.#globalObject) {
      throw new InternalError('This binding already has a projected global object');
    }
    if (assembled.findSpecialOperation('getter', 'unsigned long', this.assembly) !== undefined) {
      throw new InternalError('Global interfaces cannot use indexed properties');
    }
    this.#assertOrdinaryProjection(assembled);
    this.#globalAllocation = allocation;
    if (allocation) {
      for (const interfaceName of allocation.prototypes.keys()) {
        const prototypeAssembled = this.resolveInterface(interfaceName);
        if (this.getDefinitionBinding(prototypeAssembled).interfacePrototypeObject) {
          throw new InternalError(`Prototype ${interfaceName} was already created before global allocation`);
        }
      }
    }
    const prototype = this.getInterfacePrototypeObject(assembled);
    if (allocation && Reflect.getPrototypeOf(allocation.object) !== prototype) {
      throw new InternalError('Allocated global object has the wrong prototype');
    }
    const platformObject = allocation?.object ?? this.#globalPlatformObjects.createObject(
      this.realm.createOrdinaryObject(prototype),
    );
    const record = this.initializePlatformObject(
      platformObject,
      assembled,
      implInst,
    );
    this.#globalObject = record;

    this.#defineOperations(platformObject, assembled, 'regular');
    this.#defineAttributes(platformObject, assembled, 'regular');
    this.#defineStringifier(platformObject, assembled, 'regular');
    this.#defineIterationMethods(platformObject, assembled);
    this.#defineAsyncIterationMethods(platformObject, assembled);
    this.#defineCollectionMembers(platformObject, assembled);
    const windowAssembled = this.assembly.interfaces.get('Window');
    this.install(platformObject, Boolean(windowAssembled && record.implements(windowAssembled)));
    return record;
  }

  // Web IDL §3.8 Platform objects implementing interfaces — changing a platform object's associated realm.
  changePlatformObjectRealm(platformObject: object): void {
    const record = getPlatformRecord(platformObject);
    if (record?.binding.world !== this.world) {
      throw new InternalError('Value is not a platform object in this binding world');
    }

    const prototype = this.getInterfacePrototypeObject(record.assembled);
    if (
      Reflect.getPrototypeOf(platformObject) !== prototype &&
      !Reflect.setPrototypeOf(platformObject, prototype)
    ) {
      throw new InternalError('Could not change the public platform object prototype');
    }
    record.binding = this;
  }

  // Project helper: register implementation/platform identity and initialize per-object binding state.
  initializePlatformObject<T extends object>(
    platformObject: object,
    assembled: AssembledInterface,
    implInst: T,
  ): PlatformRecord<T> {
    const record = associatePlatformObject(platformObject, implInst, assembled, this);
    this.#collections.initialize(record);
    // Extracted from Web IDL §3.8 Platform objects implementing interfaces — copy unforgeable properties
    // while internally creating a new object implementing the interface.
    for (const ancestorAssembled of assembled.getInheritanceChain()) {
      Object.defineProperties(
        platformObject,
        Object.getOwnPropertyDescriptors(
          this.#getUnforgeableObject(ancestorAssembled),
        ),
      );
    }
    return record;
  }

  // Project helper: initialize the implementation before its record is stamped.
  initializeImplementation(
    implInst: object,
    assembled: AssembledInterface,
  ): void {
    for (const ancestorAssembled of assembled.getInheritanceChain()) {
      this.getDefinitionBinding(ancestorAssembled).initializeImplementation?.(implInst);
    }
  }

  // Project helper: retrieve the implementation's retained map entries.
  getMapEntries(object: object): IDLMapEntries {
    const record = getPlatformRecord(object) ?? getImplementationRecord(object);
    return this.#collections.getMapEntries(
      record?.binding.world === this.world ? record : undefined,
    );
  }

  // Project helper: retrieve the implementation's retained set entries.
  getSetEntries(object: object): IDLSetEntries {
    const record = getPlatformRecord(object) ?? getImplementationRecord(object);
    return this.#collections.getSetEntries(
      record?.binding.world === this.world ? record : undefined,
    );
  }

  // Project helper: locate an observable-array member and retrieve its backing list.
  getObservableArrayBackingList(
    object: object,
    attribute: AttributeMember,
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
    return this.#observableArrays.getBackingList(
      record,
      attribute,
      elementType,
    );
  }

  // Project delegate to Web IDL §3.8 Platform objects implementing interfaces — is a platform object.
  isPlatformObject(platformObject: unknown): boolean {
    return getPlatformRecord(platformObject)?.binding.world === this.world;
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

  // Web IDL §3.7.5 Constants — define the constants.
  #defineConstants(target: object, assembled: MemberOwnerDefinition): void {
    for (const entry of assembled.members) {
      if (
        entry.member.kind !== 'constant' ||
        !this.#isMemberExposed(assembled, entry)
      ) continue;

      this.#defineConstant(target, entry.member);
    }
  }

  // Extracted from Web IDL §3.7.5 Constants — define one constant property.
  #defineConstant(target: object, constant: ConstantMember): void {
    defineProperty(target, constant.name, {
      configurable: false,
      enumerable: true,
      value: convertToJavaScript(
        materializeDefaultValue(constant.value, constant.type, this.defaultConversionContext),
        constant.type,
        this.defaultConversionContext,
      ),
      writable: false,
    });
  }

  // Web IDL §3.7.6 Attributes — define the attributes.
  #defineAttributes(
    target: object,
    assembled: MemberOwnerDefinition,
    kind: MemberPlacement,
  ): void {
    for (const entry of assembled.members) {
      if (entry.member.kind !== 'attribute') continue;
      const attribute = entry.member;
      if (
        !belongsAt(attribute, kind) ||
        !this.#isMemberExposed(assembled, entry)
      ) continue;

      defineProperty(target, attribute.name, {
        configurable: kind !== 'unforgeable',
        enumerable: true,
        get: this.#getAttributeGetter(assembled, attribute),
        set: this.#getAttributeSetter(assembled, attribute),
      });
    }
  }

  // Web IDL §3.7.7 Operations — define the operations.
  #defineOperations(
    target: object,
    assembled: MemberOwnerDefinition,
    kind: MemberPlacement,
  ): void {
    const groups = assembled.getOperationGroups(
      (operation, entry) => belongsAt(operation, kind) && this.#isMemberExposed(assembled, entry),
      this.assembly,
    );

    for (const operations of groups.values()) {
      const name = operations.callables[0]?.primary.name;
      if (!name) continue;
      defineProperty(target, name, {
        configurable: kind !== 'unforgeable',
        enumerable: true,
        value: this.#getOperationFunction(
          assembled,
          name,
          operations,
        ),
        writable: kind !== 'unforgeable',
      });
    }
  }

  // Web IDL §3.7.8 Stringifiers — install the toString property.
  #defineStringifier(
    target: object,
    assembled: AssembledInterface,
    placement: Extract<MemberPlacement, 'regular' | 'unforgeable'>,
  ): void {
    const entry = assembled.getStringifier((entry) => this.#isMemberExposed(assembled, entry));
    if (!entry) return;
    const unforgeable = hasExtendedAttribute(
      entry.member.extendedAttributes,
      'LegacyUnforgeable',
    );
    if ((placement === 'unforgeable') !== unforgeable) return;

    defineProperty(target, 'toString', {
      configurable: !unforgeable,
      enumerable: true,
      value: this.#getStringifierFunction(assembled, entry.member),
      writable: !unforgeable,
    });
  }

  // Project cache for the toString function in Web IDL §3.7.8 Stringifiers.
  #getStringifierFunction(
    assembled: AssembledInterface,
    stringifier: StringifierMember | AttributeMember,
  ): JSFunction {
    return this.#getOrCreateMemberFunction(
      'stringifier',
      assembled,
      stringifier,
      () => this.realm.createFunction(
        (thisArgument) => {
          if (thisArgument === null || thisArgument === undefined) {
            return this.#throwTypeError(
              'Cannot convert null or undefined to an object',
            );
          }
          const identifier = stringifier.kind === 'attribute'
            ? stringifier.name
            : 'toString';
          const receiver = this.#getReceiverRecord(
            thisArgument,
            assembled,
            identifier,
            'method',
            false,
          );
          const object = receiver.implInst;

          let value: unknown;
          if (stringifier.kind === 'attribute') {
            const implementation = stringifier.inherit
              ? assembled.getInheritedAttribute(stringifier)
              : stringifier;
            const steps = this.getMemberBinding(assembled, implementation)?.attributeSteps;
            if (!steps) {
              throw missingImplementation(
                assembled,
                `stringifier attribute ${stringifier.name}`,
              );
            }
            value = steps.get(receiver);
          } else {
            const behavior = this.getMemberBinding(assembled, stringifier)?.stringificationBehavior;
            if (!behavior) {
              throw missingImplementation(assembled, 'stringifier');
            }
            value = Reflect.apply(behavior, object, []);
          }
          return convertToJavaScript(
            value,
            idlType.DOMString,
            this.defaultConversionContext,
          );
        },
        { length: 0, name: 'toString' },
      ),
    );
  }

  // Web IDL §3.7.9 Iterable declarations — define the iteration methods; delegates to
  // SynchronousIterableBinding.
  #defineIterationMethods(
    target: object,
    assembled: AssembledInterface,
  ): void {
    const entry = assembled.findMemberByKind('iterable');
    if (assembled.findSpecialOperation('getter', 'unsigned long', this.assembly) !== undefined) {
      this.#iterables.defineIndexedMethods(
        target,
        entry !== undefined &&
        entry.member.key === undefined &&
        this.#isMemberExposed(assembled, entry),
      );
      return;
    }
    if (
      !entry ||
      !this.#isMemberExposed(assembled, entry)
    ) return;

    this.#iterables.defineMethods(
      target,
      assembled,
      entry.member,
    );
  }

  // Web IDL §3.7.10 Asynchronous iterable declarations — define the asynchronous iteration methods; delegates
  // to AsynchronousIterableBinding.
  #defineAsyncIterationMethods(
    target: object,
    assembled: AssembledInterface,
  ): void {
    const entry = assembled.findMemberByKind('async-iterable');
    if (
      !entry ||
      !this.#isMemberExposed(assembled, entry)
    ) return;

    this.#asyncIterables.defineMethods(
      target,
      assembled,
      entry.member,
    );
  }

  // Project dispatcher for Web IDL §3.7.11 Maplike declarations and §3.7.12 Setlike declarations.
  #defineCollectionMembers(
    target: object,
    assembled: AssembledInterface,
  ): void {
    const declaration = assembled.getCollectionDeclaration();
    if (declaration?.kind === 'maplike') {
      this.#collections.defineMaplike(target, assembled, declaration);
    } else if (declaration?.kind === 'setlike') {
      this.#collections.defineSetlike(target, assembled, declaration);
    }
  }

  // Project cache around Web IDL §3.7.6 Attributes — create an attribute getter.
  #getAttributeGetter(
    assembled: MemberOwnerDefinition,
    attribute: AttributeMember,
  ): JSFunction {
    const interfaceAssembled = getMemberInterface(assembled);
    const lenient = hasExtendedAttribute(attribute.extendedAttributes, 'LegacyLenientThis');
    const elementType = this.assembly.getObservableArrayElementType(attribute.type);
    const convertResult = createJavaScriptConverter(attribute.type, this.assembly);
    const implementation = interfaceAssembled && attribute.inherit
      ? interfaceAssembled.getInheritedAttribute(attribute)
      : attribute;
    return this.#getOrCreateMemberFunction(
      'getter',
      assembled,
      attribute,
      (binding) => this.realm.createFunction((thisArgument) => {
        let resultContext: ConversionContext | undefined;
        try {
          const receiver = interfaceAssembled && !attribute.static
            ? this.#getReceiverRecord(
              thisArgument,
              interfaceAssembled,
              attribute.name,
              'getter',
              lenient,
            )
            : null;
          if (receiver === invalidReceiver) return undefined;
          resultContext = (receiver?.binding ?? this).defaultConversionContext;

          if (elementType) {
            if (!receiver) {
              throw new InternalError('Observable array attribute was not regular');
            }
            return this.#observableArrays.get(
              receiver,
              attribute,
              elementType,
            );
          }

          const steps = (implementation === attribute
            ? binding
            : this.getMemberBinding(assembled, implementation))?.attributeSteps;
          if (!steps) {
            throw missingImplementation(
              assembled,
              `attribute ${attribute.name}`,
            );
          }
          const value = steps.get(receiver);
          return convertResult(value, resultContext);
        } catch (exception) {
          return this.#handlePromiseException(
            attribute.type,
            exception,
            resultContext ?? this.defaultConversionContext,
          );
        }
      }, { length: 0, name: `get ${attribute.name}` }),
    );
  }

  // Project cache around Web IDL §3.7.6 Attributes — create an attribute setter.
  #getAttributeSetter(
    assembled: MemberOwnerDefinition,
    attribute: AttributeMember,
  ): JSFunction | undefined {
    if (assembled.primary.kind === 'namespace') return;
    const interfaceAssembled = getMemberInterface(assembled);
    if (!interfaceAssembled) throw new InternalError('Namespace attribute unexpectedly had a setter');
    const replaceable = hasExtendedAttribute(
      attribute.extendedAttributes,
      'Replaceable',
    );
    const putForwards = getIdentifierAttribute(attribute, 'PutForwards');
    const lenientSetter = hasExtendedAttribute(
      attribute.extendedAttributes,
      'LegacyLenientSetter',
    );
    if (attribute.readonly && !replaceable && !putForwards && !lenientSetter) {
      return;
    }
    const lenient = hasExtendedAttribute(attribute.extendedAttributes, 'LegacyLenientThis');
    const observableArrayElementType = this.assembly.getObservableArrayElementType(attribute.type);
    const type = this.assembly.getUnannotatedType(attribute.type);
    const enumeration = type.kind === 'reference' ? this.assembly.enumerations.get(type.name) : undefined;
    const convertInput = createIDLConverter(
      enumeration ? idlType.DOMString : attribute.type,
      this.defaultConversionContext,
      { attributeAssignment: true },
    );

    return this.#getOrCreateMemberFunction(
      'setter',
      assembled,
      attribute,
      (binding) => this.realm.createFunction((thisArgument, argumentsList) => {
        const value = argumentsList[0];
        const jsValue = this.#resolveThisValue(thisArgument);
        const receiver = attribute.static
          ? null
          : this.#getReceiverRecord(
            jsValue,
            interfaceAssembled,
            attribute.name,
            'setter',
            lenient,
          );
        if (replaceable) {
          if (!isObject(jsValue)) return this.#throwTypeError('Invalid receiver');
          if (!Reflect.defineProperty(jsValue, attribute.name, {
            configurable: true,
            enumerable: true,
            value,
            writable: true,
          })) {
            return this.#throwTypeError(
              `Could not replace attribute ${attribute.name}`,
            );
          }
          return undefined;
        }
        if (receiver === invalidReceiver || lenientSetter) return undefined;

        if (putForwards) {
          if (!receiver) throw new InternalError('PutForwards used on a static attribute');
          if (!isObject(jsValue)) {
            return this.#throwTypeError('Invalid receiver');
          }
          const forwarded = (jsValue as Record<string, unknown>)[attribute.name];
          if (!isObject(forwarded)) {
            return this.#throwTypeError(
              `${attribute.name} does not reference an object`,
            );
          }
          Reflect.set(forwarded, putForwards, value);
          return undefined;
        }

        if (observableArrayElementType) {
          if (!receiver) {
            throw new InternalError('Observable array attribute was not regular');
          }
          this.#observableArrays.replace(
            receiver,
            attribute,
            observableArrayElementType,
            value,
          );
          return undefined;
        }

        const idlValue = convertInput(value);
        // https://webidl.spec.whatwg.org/#dfn-attribute-setter
        if (enumeration && !enumeration.hasValue(idlValue as string)) return undefined;
        const steps = binding.attributeSteps;
        if (!steps?.set) {
          throw missingImplementation(
            assembled,
            `attribute setter ${attribute.name}`,
          );
        }
        steps.set(receiver, idlValue);
        return undefined;
      }, { length: 1, name: `set ${attribute.name}` }),
    );
  }

  // Project cache around Web IDL §3.7.7 Operations — create an operation function.
  #getOperationFunction(
    assembled: MemberOwnerDefinition,
    name: string,
    operations: AssembledOverloads<AssembledCallable<OperationMember>>,
  ): JSFunction {
    const source = operations.callables[0];
    if (!source) throw new InternalError(`Operation group ${name} is empty`);
    const resolve = createOverloadResolver(operations, this.defaultConversionContext);
    const interfaceAssembled = getMemberInterface(assembled);
    const definitionBinding = this.getDefinitionBinding(assembled);
    for (const { primary } of operations.callables) {
      const binding = definitionBinding.getOrCreateMemberRecord(primary);
      binding.isDefaultOperation = hasExtendedAttribute(primary.extendedAttributes, 'Default');
      binding.convertResult ??= createJavaScriptConverter(
        primary.returns,
        this.assembly,
        !binding.isDefaultOperation && primary.allocateIn !== undefined,
      );
    }
    return this.#getOrCreateMemberFunction(
      'operation',
      assembled,
      source.primary,
      (binding) => this.realm.createFunction((thisArgument, argumentsList) => {
        try {
          const receiver = interfaceAssembled && !source.primary.static
            ? this.#getReceiverRecord(
              thisArgument,
              interfaceAssembled,
              name,
              'method',
              false,
            )
            : null;
          // Default to receiver-realm allocation while Web IDL's broader realm rules are unresolved.
          // An explicit allocateIn declaration selects a different result realm without changing ownership.
          // https://github.com/whatwg/webidl/issues/135
          let resultContext = (receiver?.binding ?? this).defaultConversionContext;

          const overload = resolve(argumentsList);
          const operation = overload.callable.primary;
          if (operation.allocateIn === 'method') {
            resultContext = { binding: resultContext.binding, realm: this.realm };
          }
          const operationBinding = operation === source.primary
            ? binding
            : definitionBinding.getOrCreateMemberRecord(operation);
          const steps = operationBinding.operationSteps;
          const convertResult = operationBinding.convertResult!;
          if (operationBinding.isDefaultOperation) {
            if (!receiver || !interfaceAssembled) {
              throw new InternalError('Default operation used as a static operation');
            }
            return convertResult(
              this.#runDefaultOperation(interfaceAssembled, receiver),
              this.defaultConversionContext,
            );
          }
          if (!steps) {
            throw missingImplementation(assembled, `operation ${name}`);
          }
          const result = steps(receiver, ...overload.values);
          return convertResult(result, resultContext);
        } catch (exception) {
          return this.#handlePromiseException(
            source.primary.returns,
            exception,
            // Invocation failure creates a new promise in the method realm;
            // allocation of a successful implementation result is unrelated.
            this.defaultConversionContext,
          );
        }
      }, { length: operations.minimumArgumentCount, name }),
    );
  }

  // Extracted from Web IDL §3.7.6 Attributes and §3.7.7 Operations — reject promise results when invocation
  // throws.
  #handlePromiseException(
    type: WebIDLType,
    exception: unknown,
    context: ConversionContext,
  ): Promise<unknown> {
    const promiseType = this.assembly.getUnannotatedType(type);
    if (promiseType.kind !== 'promise') throw exception;
    return createRejectedPromise(exception, promiseType.type, context).promise;
  }

  // https://webidl.spec.whatwg.org/#js-default-tojson
  #runDefaultOperation(
    assembled: AssembledInterface,
    receiver: PlatformRecord,
  ): object {
    const result = this.realm.createOrdinaryObject(
      this.realm.intrinsics.objectPrototype,
    );
    const context = { binding: receiver.binding, realm: this.realm };

    for (const entry of this.#getDefaultToJSONAttributes(assembled)) {
      const { attribute, implementation } = entry;
      const steps = this.getMemberBinding(entry.assembled, implementation)?.attributeSteps;
      if (!steps) throw missingImplementation(entry.assembled, `attribute ${attribute.name}`);
      const idlValue = steps.get(receiver);
      defineProperty(result, attribute.name, {
        configurable: true,
        enumerable: true,
        value: convertToJavaScript(idlValue, attribute.type, context),
        writable: true,
      });
    }
    return result;
  }

  // Exposure is realm-specific; only declaration selection is retained, never getter results.
  #getDefaultToJSONAttributes(assembled: AssembledInterface): DefaultToJSONAttribute[] {
    const definitionBinding = this.getDefinitionBinding(assembled);
    if (definitionBinding.defaultToJSONAttributes) return definitionBinding.defaultToJSONAttributes;
    const attributes: DefaultToJSONAttribute[] = [];
    for (const ancestorAssembled of assembled.getInheritanceChain()) {
      if (!ancestorAssembled.hasDefaultToJSON()) continue;
      for (const entry of ancestorAssembled.members) {
        if (
          entry.member.kind !== 'attribute' ||
          entry.member.static ||
          !this.#isMemberExposed(ancestorAssembled, entry) ||
          !this.assembly.isJSONType(entry.member.type)
        ) continue;

        const attribute = entry.member;
        const implementation = attribute.inherit
          ? ancestorAssembled.getInheritedAttribute(attribute)
          : attribute;
        attributes.push({ assembled: ancestorAssembled, attribute, implementation });
      }
    }
    definitionBinding.defaultToJSONAttributes = attributes;
    return attributes;
  }

  // Project helper: reject special operations whose platform behavior is not implemented.
  #assertOrdinaryProjection(assembled: AssembledInterface): void {
    for (const { member } of assembled.members) {
      if (member.kind === 'operation' && member.special) {
        if (this.#legacyPlatformObjects.supportsSpecialOperation(member)) {
          continue;
        }
        throw new InternalError(
          `${assembled.primary.name} requires deferred legacy platform object machinery`,
        );
      }
    }
  }

  // Project cache for the unforgeables object in Web IDL §3.7.1 Interface object.
  #getUnforgeableObject(assembled: AssembledInterface): object {
    const definitionBinding = this.getDefinitionBinding(assembled);
    if (definitionBinding.unforgeablesObject) return definitionBinding.unforgeablesObject;

    const object = this.realm.createOrdinaryObject(null);
    definitionBinding.unforgeablesObject = object;
    this.#defineAttributes(object, assembled, 'unforgeable');
    this.#defineOperations(object, assembled, 'unforgeable');
    this.#defineStringifier(object, assembled, 'unforgeable');
    return object;
  }

  // Project cache for Web IDL §3.7.4 Named properties object.
  #getNamedPropertiesObject(assembled: AssembledInterface): object {
    const definitionBinding = this.getDefinitionBinding(assembled);
    if (definitionBinding.namedPropertiesObject) return definitionBinding.namedPropertiesObject;

    const parent = assembled.parentAssembled
      ? this.getInterfacePrototypeObject(assembled.parentAssembled)
      : this.realm.intrinsics.objectPrototype;
    const object = this.#globalPlatformObjects.createNamedPropertiesObject(
      assembled,
      parent,
      () => this.#globalObject?.platformObject,
      this.#globalAllocation?.namedProperties,
    );
    definitionBinding.namedPropertiesObject = object;
    return object;
  }

  // Project predicate for Web IDL §3.7.3 Interface prototype object — immutable global prototype-chain rule.
  #hasImmutableGlobalPrototype(assembled: AssembledInterface): boolean {
    if (this.realm.isGlobalPrototypeChainMutable) return false;
    return this.assembly.interfaces.isOnGlobalPrototypeChain(assembled);
  }

  // Web IDL §3.7.3 Interface prototype object — @@unscopables setup for [Unscopable] members.
  #defineUnscopables(target: object, assembled: AssembledInterface): void {
    const names = assembled.getUnscopableNames((entry) => this.#isMemberExposed(assembled, entry));
    if (names.size === 0) return;

    const unscopables = this.realm.createOrdinaryObject(null);
    for (const name of names) {
      defineProperty(unscopables, name, {
        configurable: true,
        enumerable: true,
        value: true,
        writable: true,
      });
    }
    defineProperty(target, Symbol.unscopables, {
      configurable: true,
      enumerable: false,
      value: unscopables,
      writable: false,
    });
  }

  // Project adapter for the receiver and security checks in Web IDL §3.7.6 Attributes and §3.7.7 Operations.
  #getReceiverRecord(
    thisArgument: unknown,
    assembled: AssembledInterface,
    identifier: string,
    type: 'getter' | 'method' | 'setter',
    lenient: false,
  ): PlatformRecord;
  #getReceiverRecord(
    thisArgument: unknown,
    assembled: AssembledInterface,
    identifier: string,
    type: 'getter' | 'method' | 'setter',
    lenient: boolean,
  ): PlatformRecord | typeof invalidReceiver;
  #getReceiverRecord(
    thisArgument: unknown,
    assembled: AssembledInterface,
    identifier: string,
    type: 'getter' | 'method' | 'setter',
    lenient: boolean,
  ): PlatformRecord | typeof invalidReceiver {
    const value = this.#resolveThisValue(thisArgument);
    const record = this.#resolveReceiverRecord(value);
    if (record) {
      this.realm.performSecurityCheck(record.platformObject!, identifier, type);
    }
    if (!record || !record.implements(assembled)) {
      if (lenient) return invalidReceiver;
      return this.#throwTypeError('Illegal invocation');
    }
    return record;
  }

  // Project helper: resolve direct platform receivers and proxy object receiver aliases.
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
  #resolveThisValue(thisArgument: unknown): unknown {
    return thisArgument ?? this.#globalObject?.platformObject ?? this.realm.global;
  }

  // Project helper: combine exposure checks for a member, its declaration fragment, and its owner.
  #isMemberExposed(
    assembled: MemberOwnerDefinition,
    entry: MemberEntry,
  ): boolean {
    return this.#isConstructExposed(assembled.primary) &&
      this.#isConstructExposed(entry.source) &&
      this.#isConstructExposed(entry.member);
  }

  // Project predicate for Web IDL §3.3.7 [Exposed], §3.3.4 [CrossOriginIsolated], and §3.3.13 [SecureContext].
  #isConstructExposed(construct: Exposable): boolean {
    const exposure = construct.exposed;
    if (
      exposure !== undefined &&
      exposure !== '*' &&
      !(typeof exposure === 'string'
        ? this.realm.globalNames.has(exposure)
        : exposure.some((name) => this.realm.globalNames.has(name)))
    ) return false;
    if (
      hasExtendedAttribute(
        construct.extendedAttributes,
        'CrossOriginIsolated',
      ) &&
      !this.realm.crossOriginIsolated
    ) return false;
    if (
      hasExtendedAttribute(construct.extendedAttributes, 'SecureContext') &&
      !this.realm.secureContext
    ) return false;
    return true;
  }

  // Project helper: retain legacy interface metadata beside the realm's initial objects.
  #getLegacyPropertyMetadata(
    assembled: AssembledInterface,
  ): LegacyPropertyMetadata | null {
    const definitionBinding = this.getDefinitionBinding(assembled);
    // null records an ordinary interface; undefined means it has not been inspected yet.
    if (definitionBinding.legacyPropertyMetadata === undefined) {
      definitionBinding.legacyPropertyMetadata = this.#legacyPlatformObjects.createPropertyMetadata(
        assembled,
      );
    }
    return definitionBinding.legacyPropertyMetadata;
  }

  // Project helper: select the first declared allocator in the interface ancestry.
  #getPlatformObjectAllocationSteps(
    assembled: AssembledInterface,
  ): PlatformObjectAllocationSteps | undefined {
    for (
      let currentAssembled: AssembledInterface | undefined = assembled;
      currentAssembled;
      currentAssembled = currentAssembled.parentAssembled
    ) {
      const allocate = this.getDefinitionBinding(currentAssembled).allocatePlatformObject;
      if (allocate) return allocate;
    }
  }

  // Project helper: retain each initial getter, setter, or operation function in its realm.
  #getOrCreateMemberFunction(
    kind: MemberFunctionKind,
    assembled: MemberOwnerDefinition,
    member: PlatformMemberDefinition,
    create: (binding: MemberBinding) => JSFunction,
  ): JSFunction {
    const binding = this.getDefinitionBinding(assembled).getOrCreateMemberRecord(member);
    return binding[kind] ??= create(binding);
  }

  // Project helper: throw a TypeError allocated in this binding's realm.
  #throwTypeError(message: string): never {
    throw new this.realm.intrinsics.typeError(message);
  }
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

export type AttributeFunctionCallback = (this: unknown, ...argumentsList: unknown[]) => unknown;

/** Assembled interface or namespace whose contributed members are installed together. */
type MemberOwnerDefinition = AssembledInterface | AssembledNamespace;
type MemberEntry = AssembledInterfaceMember | AssembledNamespaceMember;
/** Supply before projecting any object that needs these interface prototypes. */
export type GlobalObjectAllocation = {
  object: object;
  prototypes: ReadonlyMap<string, object>;
  namedProperties?: {
    object: object;
    setDelegate(delegate: object): void;
  };
};

type MemberPlacement = 'regular' | 'static' | 'unforgeable';
type Exposable = {
  exposed?: Exposure;
  extendedAttributes?: ExtendedAttribute[];
};

const invalidReceiver = Symbol('invalid receiver');

// Project predicate: select static, unforgeable, or prototype placement for an interface member.
function belongsAt(
  member: AttributeMember | OperationMember,
  placement: MemberPlacement,
): boolean {
  if (placement === 'static') return member.static === true;
  if (member.static) return false;
  const unforgeable = hasExtendedAttribute(
    member.extendedAttributes,
    'LegacyUnforgeable',
  );
  return placement === 'unforgeable' ? unforgeable : !unforgeable;
}

// Project helper: distinguish an assembled interface from an assembled namespace.
function getMemberInterface(
  assembled: MemberOwnerDefinition,
): AssembledInterface | undefined {
  return assembled instanceof AssembledInterface
    ? assembled
    : undefined;
}

// Project helper: read an identifier-valued extended attribute.
function getIdentifierAttribute(
  construct: { extendedAttributes?: ExtendedAttribute[]; },
  name: string,
): string | undefined {
  const attribute = construct.extendedAttributes?.find(
    (candidate) =>
      candidate.kind === 'identifier' && candidate.name === name,
  );
  return attribute?.kind === 'identifier' ? attribute.value : undefined;
}

// Project helper: define a binding property or report a setup failure.
function defineProperty(
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor,
): void {
  if (!Reflect.defineProperty(target, key, descriptor)) {
    throw new InternalError(`Could not define Web IDL property ${String(key)}`);
  }
}

// Project helper: describe missing implementation steps in a binding declaration.
function missingImplementation(
  assembled: MemberOwnerDefinition,
  member: string,
): Error {
  return new InternalError(
    `Web IDL ${assembled.primary.name} ${member} has no implementation steps`,
  );
}
