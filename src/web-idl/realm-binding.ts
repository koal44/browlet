import {
  getAssociatedRealm, isObject, RangeError as InternalRangeError,
  SyntaxError as InternalSyntaxError, TypeError as InternalTypeError,
  type ByteSequence, type RuntimeContext,
} from '../js-engine/index';
import { Stamper } from '../infra/stamper';
import { DOMException as InternalDOMException } from './core/dom-exception';
import type {
  AssembledInterfaceDefinition, AssembledInterfaceMember, AssembledNamespaceDefinition,
  AssembledNamespaceMember, DefinitionAssembly,
} from './assembly';
import { AsynchronousIterableBinding } from './async-iterable';
import {
  CollectionBinding, type IDLMapEntries, type IDLSetEntries,
} from './collection';
import {
  convertToIDL, convertToJavaScript, createBufferResult, materializeDefaultValue,
  projectPromise, type ConversionContext, type HostDefinedInterface,
} from './conversion';
import { hasExtendedAttribute } from './core/helpers';
import type {
  AttributeMember, ConstantMember, Exposure, ExtendedAttribute, NamedArgumentsExtendedAttribute,
  OperationMember, StringifierMember, WebIDLType,
} from './core/types';
import type { CallbackInterfaceDefinition, ConstructorMember } from './core/declarations';
import { GlobalPlatformObjectBinding } from './global-platform-object';
import {
  ImplementationRegistry, type ConstructorBehavior,
} from './implementation-registry';
import { SynchronousIterableBinding } from './iterable';
import type { WebIDLRealmHost } from './realm-host';
import { BindingContext } from './binding-context';
import {
  LegacyPlatformObjectBinding, type LegacyProperties,
} from './legacy-platform-object';
import {
  computeEffectiveOverloadSet, type IDLCallable, resolveOverload,
} from './overload';
import { ObservableArrayBinding } from './observable-array';
import {
  associatePlatformObject, getImplementationObject, getImplementationRecord, getPlatformRecord,
  interfaceImplements, stampImplementation, type PlatformRecord, type StampedPlatformObject,
} from './platform-object';
import type { BindingWorld } from './binding-world';
import { createRejectedPromise } from './promise';
import { getUnannotatedType } from './types';

export class RealmBinding<Realm extends WebIDLRealmHost = WebIDLRealmHost> {
  readonly definitions: DefinitionAssembly;
  readonly hostDefinedInterfaces: ReadonlyMap<string, HostDefinedInterface>;
  readonly implementations: ImplementationRegistry;
  readonly world: BindingWorld;
  readonly realizeException: (value: unknown) => unknown;
  readonly realm: Realm;
  readonly context: BindingContext<Realm>;
  readonly #collections: CollectionBinding;
  readonly #asyncIterables: AsynchronousIterableBinding;
  readonly #initialObjects = new Map<InitialObjectDefinition, DefinitionInitialObjects>();
  readonly #globalPlatformObjects: GlobalPlatformObjectBinding;
  #globalObject: PlatformRecord | undefined;
  #globalAllocation: GlobalObjectAllocation | undefined;
  readonly #iterables: SynchronousIterableBinding;
  readonly #legacyPlatformObjects: LegacyPlatformObjectBinding;
  readonly #observableArrays: ObservableArrayBinding;

  // Project helper: assemble the registries, conversion context, and realm binding machinery.
  constructor(
    definitions: DefinitionAssembly,
    realm: Realm,
    world: BindingWorld,
    implementations = new ImplementationRegistry(),
    hostDefinedInterfaces: HostDefinedInterface[] = [],
    createRuntime?: (ctx: BindingContext<Realm>) => RuntimeContext,
  ) {
    this.definitions = definitions;
    this.hostDefinedInterfaces = new Map(
      hostDefinedInterfaces.map((hostInterface) => [hostInterface.name, hostInterface]),
    );
    this.implementations = implementations;
    this.realm = realm;
    this.world = world;
    // Promise and callback conversion contexts retain this projection callback.
    this.projectImplementationObject = this.projectImplementationObject.bind(this);
    // Project adapter: realize internal exceptions once and preserve the error across realms.
    // Web IDL §3.14.3 Creating and throwing exceptions supplies the realm-allocation rules.
    this.realizeException = (value) => {
      if (!isObject(value)) return value;
      const existing = ExceptionStamper.get(value);
      if (existing) return existing;
      let error: object;
      if (InternalTypeError.is(value)) {
        error = new this.realm.intrinsics.typeError(value.message);
      } else if (InternalRangeError.is(value)) {
        error = new this.realm.intrinsics.rangeError(value.message);
      } else if (InternalSyntaxError.is(value)) {
        error = new this.realm.intrinsics.syntaxError(value.message);
      } else if (InternalDOMException.is(value)) {
        error = new this.DOMException(value.message, value.name);
      } else {
        return value;
      }
      void ExceptionStamper.stamp(value, error);
      return error;
    };
    this.#asyncIterables = new AsynchronousIterableBinding(
      this,
      implementations,
      (primaryInterface, create) => {
        const initial = this.#getInitialObjects(primaryInterface.definition);
        return initial.asyncIteratorPrototype ??=
          create();
      },
    );
    this.#collections = new CollectionBinding(this);
    this.#globalPlatformObjects = new GlobalPlatformObjectBinding(
      this,
      implementations,
    );
    this.#iterables = new SynchronousIterableBinding(
      this,
      implementations,
      (primaryInterface, create) => {
        const initial = this.#getInitialObjects(primaryInterface.definition);
        return initial.iteratorPrototype ??= create();
      },
    );
    this.#legacyPlatformObjects = new LegacyPlatformObjectBinding(
      this,
      implementations,
    );
    this.#observableArrays = new ObservableArrayBinding(
      this,
      implementations,
    );
    this.context = new BindingContext(this, createRuntime);
  }

  // The constructor belongs to this realm's binding world and shares its interface-object cache.
  get DOMException(): typeof globalThis.DOMException {
    return this.#getInterfaceObject(
      this.resolveInterface('DOMException'),
    ) as unknown as typeof globalThis.DOMException;
  }

  // Project boundary: resolve an interface name before using its assembled definition.
  resolveInterface(interfaceName: string): AssembledInterfaceDefinition {
    const primaryInterface = this.definitions.getInterface(interfaceName);
    if (!primaryInterface) throw new Error(`Unknown Web IDL interface ${interfaceName}`);
    return primaryInterface;
  }

  // Project installer for Web IDL §3.8 Platform objects implementing interfaces — global property references.
  install(
    target: object = this.#globalObject?.platformObject ?? this.realm.global,
  ): Map<string, object> {
    const installed = this.getExposedGlobalProperties();

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
    const interfaces = orderInterfacesByInheritance(
      this.definitions.getInterfaces()
        .filter((primaryInterface) => this.isExposed(primaryInterface)),
    );

    for (const primaryInterface of interfaces) {
      const definition = primaryInterface.definition;
      this.getInterfacePrototypeObject(primaryInterface);
      this.#initializeMemberObjects(primaryInterface);
      if (
        !hasExtendedAttribute(
          definition.extendedAttributes,
          'LegacyNoInterfaceObject',
        ) &&
        getIdentifierAttribute(definition, 'LegacyNamespace') === undefined
      ) {
        const object = this.#getInterfaceObject(primaryInterface);
        installed.set(definition.name, object);
        if (isWindow) {
          for (const alias of getIdentifierListAttribute(
            definition,
            'LegacyWindowAlias',
          )) {
            installed.set(alias, object);
          }
        }
      }
      for (const id of getLegacyFactoryFunctionIdentifiers(primaryInterface)) {
        installed.set(id, this.getLegacyFactoryFunction(primaryInterface, id));
      }
    }
    for (const callbackInterface of this.definitions.getCallbackInterfaces()) {
      if (
        callbackInterface.exposed === undefined ||
        !callbackInterface.members.some((member) => member.kind === 'constant') ||
        !this.#isConstructExposed(callbackInterface)
      ) continue;
      installed.set(
        callbackInterface.name,
        this.getLegacyCallbackInterfaceObject(callbackInterface),
      );
    }
    for (const namespace of this.definitions.getNamespaces()) {
      if (
        namespace.definition.exposed === undefined ||
        !this.#isConstructExposed(namespace.definition)
      ) continue;
      installed.set(
        namespace.definition.name,
        this.getNamespaceObject(namespace),
      );
    }
    return installed;
  }

  // Project cache around Web IDL §3.7.1 Interface object — create an interface object.
  #getInterfaceObject(
    primaryInterface: AssembledInterfaceDefinition,
  ): InterfaceObject {
    const initial = this.#getInitialObjects(primaryInterface.definition);
    if (initial.interfaceObject) return initial.interfaceObject;

    const constructors = this.#getConstructors(primaryInterface);
    const overridden = this.implementations.getOverriddenConstructorSteps(
      primaryInterface.definition,
    );
    const object: JSFunction = this.realm.createFunction(
      (_thisArgument, argumentsList, newTarget) => {
        if (overridden) {
          return overridden(argumentsList, newTarget, object);
        }
        if (constructors.length === 0) {
          return this.#throwTypeError('Illegal constructor');
        }
        if (!newTarget) {
          return this.#throwTypeError(
            `Failed to construct '${primaryInterface.definition.name}': use the 'new' operator.`,
          );
        }

        const overload = resolveOverload(
          computeEffectiveOverloadSet(constructors, argumentsList.length),
          argumentsList,
          this,
        );
        const behavior = this.implementations.getConstructorBehavior(
          overload.callable,
        );
        if (!behavior) {
          throw missingImplementation(primaryInterface, 'constructor');
        }
        return this.#constructPlatformObject(
          primaryInterface,
          behavior,
          overload.values,
          newTarget,
        );
      },
      {
        constructible: true,
        length: getCallableLength(constructors),
        name: primaryInterface.definition.name,
      },
    );

    initial.interfaceObject = object;
    this.#getUnforgeableObject(primaryInterface);
    Reflect.setPrototypeOf(
      object,
      primaryInterface.parent
        ? this.#getInterfaceObject(primaryInterface.parent)
        : this.realm.intrinsics.functionPrototype,
    );

    defineProperty(object, 'prototype', {
      configurable: false,
      enumerable: false,
      value: this.getInterfacePrototypeObject(primaryInterface),
      writable: false,
    });
    this.#defineConstants(object, primaryInterface);
    this.#defineAttributes(object, primaryInterface, 'static');
    this.#defineOperations(object, primaryInterface, 'static');
    return object;
  }

  // Project cache around Web IDL §3.11.1 Legacy callback interface object — create a legacy callback interface
  // object.
  getLegacyCallbackInterfaceObject(
    definition: CallbackInterfaceDefinition,
  ): object {
    const initial = this.#getInitialObjects(definition);
    if (initial.legacyCallbackInterfaceObject) {
      return initial.legacyCallbackInterfaceObject;
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
    initial.legacyCallbackInterfaceObject = object;
    return object;
  }

  // Project cache around Web IDL §3.7.2 Legacy factory functions — create a legacy factory function.
  getLegacyFactoryFunction(
    primaryInterface: AssembledInterfaceDefinition,
    id: string,
  ): JSFunction {
    const declarations = getLegacyFactoryFunctionDeclarations(
      primaryInterface,
      id,
    );
    const source = declarations[0];
    if (!source) {
      throw new Error(
        `${primaryInterface.definition.name} has no legacy factory function ${id}`,
      );
    }

    const initial = this.#getInitialObjects(primaryInterface.definition);
    const existing = initial.legacyFactoryFunctions?.get(id);
    if (existing) return existing;

    const function_ = this.realm.createFunction(
      (_thisArgument, argumentsList, newTarget) => {
        if (!newTarget) {
          return this.#throwTypeError(
            `Failed to construct '${id}': use the 'new' operator.`,
          );
        }
        const overload = resolveOverload(
          computeEffectiveOverloadSet(
            declarations,
            argumentsList.length,
          ),
          argumentsList,
          this,
        );
        const behavior = this.implementations.getConstructorBehavior(
          overload.callable,
        );
        if (!behavior) {
          throw new Error(
            `Web IDL ${primaryInterface.definition.name} legacy factory function ${id} has no implementation steps`,
          );
        }
        return this.#constructPlatformObject(
          primaryInterface,
          behavior,
          overload.values,
          newTarget,
        );
      },
      {
        constructible: true,
        length: getCallableLength(declarations),
        name: id,
      },
    );
    defineProperty(function_, 'prototype', {
      configurable: false,
      enumerable: false,
      value: this.getInterfacePrototypeObject(primaryInterface),
      writable: false,
    });
    (initial.legacyFactoryFunctions ??= new Map()).set(id, function_);
    return function_;
  }

  /** Project helper: retain an attribute's returned function alongside its getter in this realm. */
  getAttributeFunction(
    primaryInterface: AssembledInterfaceDefinition,
    attribute: AttributeMember,
    createCallback: () => AttributeFunctionCallback,
  ): JSFunction {
    return this.#getOrCreateMemberFunction(
      'attributeFunction', primaryInterface.definition, attribute,
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
    namespace: AssembledNamespaceDefinition,
  ): object {
    const initial = this.#getInitialObjects(namespace.definition);
    if (initial.namespaceObject) return initial.namespaceObject;

    const object = this.realm.createOrdinaryObject(
      this.realm.intrinsics.objectPrototype,
    );
    initial.namespaceObject = object;
    this.#defineAttributes(object, namespace, 'regular');
    this.#defineOperations(object, namespace, 'regular');
    this.#defineConstants(object, namespace);

    for (const primaryInterface of this.definitions.getInterfaces()) {
      if (
        getIdentifierAttribute(
          primaryInterface.definition,
          'LegacyNamespace',
        ) !== namespace.definition.name ||
        !this.isExposed(primaryInterface)
      ) continue;
      defineProperty(object, primaryInterface.definition.name, {
        configurable: true,
        enumerable: false,
        value: this.#getInterfaceObject(primaryInterface),
        writable: true,
      });
    }
    defineProperty(object, Symbol.toStringTag, {
      configurable: true,
      enumerable: false,
      value: namespace.definition.name,
      writable: false,
    });
    return object;
  }

  // Project cache around Web IDL §3.7.3 Interface prototype object — create an interface prototype object.
  getInterfacePrototypeObject(
    primaryInterface: AssembledInterfaceDefinition,
  ): object {
    const initial = this.#getInitialObjects(primaryInterface.definition);
    if (initial.interfacePrototypeObject) {
      return initial.interfacePrototypeObject;
    }

    this.#assertOrdinaryProjection(primaryInterface);

    const global = isGlobalInterface(primaryInterface);
    const parentPrototype = global &&
      this.#globalPlatformObjects.supportsNamedProperties(primaryInterface)
      ? this.#getNamedPropertiesObject(primaryInterface)
      : primaryInterface.parent
        ? this.getInterfacePrototypeObject(primaryInterface.parent)
        : primaryInterface.definition.name === 'DOMException'
          ? this.realm.intrinsics.errorPrototype
          : this.realm.intrinsics.objectPrototype;
    const allocated = this.#globalAllocation?.prototypes.get(primaryInterface.definition.name);
    const prototype = allocated ?? (this.#hasImmutableGlobalPrototype(primaryInterface)
      ? this.#globalPlatformObjects.createPrototypeObject(parentPrototype)
      : this.realm.createOrdinaryObject(parentPrototype));
    if (Reflect.getPrototypeOf(prototype) !== parentPrototype) {
      throw new Error(`Allocated ${primaryInterface.definition.name} prototype has the wrong parent`);
    }
    initial.interfacePrototypeObject = prototype;

    this.#defineUnscopables(prototype, primaryInterface);
    if (!global) {
      this.#defineAttributes(prototype, primaryInterface, 'regular');
      this.#defineOperations(prototype, primaryInterface, 'regular');
      this.#defineStringifier(prototype, primaryInterface, 'regular');
      this.#defineIterationMethods(prototype, primaryInterface);
      this.#defineAsyncIterationMethods(prototype, primaryInterface);
      this.#defineCollectionMembers(prototype, primaryInterface);
    }
    this.#defineConstants(prototype, primaryInterface);

    if (!hasExtendedAttribute(
      primaryInterface.definition.extendedAttributes,
      'LegacyNoInterfaceObject',
    )) {
      defineProperty(prototype, 'constructor', {
        configurable: true,
        enumerable: false,
        value: this.#getInterfaceObject(primaryInterface),
        writable: true,
      });
    }
    defineProperty(prototype, Symbol.toStringTag, {
      configurable: true,
      enumerable: false,
      value: getQualifiedName(primaryInterface.definition),
      writable: false,
    });
    return prototype;
  }

  // Project adapter: preserve an existing owner or stamp a fresh result with this receiver binding.
  projectImplementationObject(
    implInst: object,
    expectedInterface: AssembledInterfaceDefinition,
  ): StampedPlatformObject | undefined {
    const existing = getImplementationRecord(implInst);
    if (existing) {
      if (existing.binding.world !== this.world) {
        throw new TypeError('Implementation instance belongs to another binding world');
      }
      return interfaceImplements(existing.primaryInterface, expectedInterface)
        ? existing.project()
        : undefined;
    }

    const primaryInterface = this.implementations.getInterfaceForObject(implInst);
    if (
      !primaryInterface ||
      !interfaceImplements(primaryInterface, expectedInterface)
    ) return;
    const stampedInst = stampImplementation(implInst, primaryInterface, this);
    return this.projectPlatformObject(stampedInst, primaryInterface).platformObject!;
  }

  // Project allocation entry point for Web IDL §3.8 Platform objects implementing interfaces — create a new
  // object implementing the interface.
  createPlatformObject(
    primaryInterface: AssembledInterfaceDefinition,
    newTarget?: object,
  ): StampedPlatformObject {
    if (!this.isExposed(primaryInterface)) {
      throw new Error(
        `Interface ${primaryInterface.definition.name} is not exposed in this realm`,
      );
    }
    if (isGlobalInterface(primaryInterface)) {
      throw new Error(
        `Global interface ${primaryInterface.definition.name} requires global exotic object machinery`,
      );
    }

    const prototype = this.#getPlatformObjectPrototype(primaryInterface, newTarget);

    const createImplementation = this.implementations
      .getImplementationCreationSteps(
        primaryInterface.definition,
      );
    if (!createImplementation) {
      throw new Error(
        `Interface ${primaryInterface.definition.name} has no implementation creation steps`,
      );
    }
    return this.projectPlatformObject(
      createImplementation(),
      primaryInterface,
      prototype,
    ).platformObject!;
  }

  // Project adapter: construct or initialize the implementation, then project its platform object.
  #constructPlatformObject(
    primaryInterface: AssembledInterfaceDefinition,
    behavior: ConstructorBehavior,
    values: readonly unknown[],
    newTarget: object,
  ): StampedPlatformObject {
    if (behavior.kind === 'initialize') {
      const platformObject = this.createPlatformObject(primaryInterface, newTarget);
      const implInst = getImplementationObject(platformObject);
      if (!implInst) {
        throw new Error('New platform object has no implementation target');
      }
      Reflect.apply(behavior.steps, implInst, values);
      return platformObject;
    }

    const prototype = this.#getPlatformObjectPrototype(primaryInterface, newTarget);
    const implInst = behavior.steps(values);
    return this.projectPlatformObject(
      implInst,
      primaryInterface,
      prototype,
    ).platformObject!;
  }

  // Extracted from Web IDL §3.8 Platform objects implementing interfaces — internally create a new object
  // implementing the interface: prototype selection.
  #getPlatformObjectPrototype(
    primaryInterface: AssembledInterfaceDefinition,
    newTarget?: object,
  ): object {
    if (!newTarget) return this.getInterfacePrototypeObject(primaryInterface);

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
        binding.resolveInterface(primaryInterface.definition.name),
      );
    } catch (error) {
      throw this.realizeException(error);
    }
  }

  // Project helper: query an assembled interface's exposure in this realm.
  isExposed(primaryInterface: AssembledInterfaceDefinition): boolean {
    return this.#isConstructExposed(primaryInterface.definition);
  }

  // Project adapter: allocate a platform object for an existing implementation.
  projectPlatformObject<T extends object>(
    implInst: T,
    primaryInterface: AssembledInterfaceDefinition,
    prototype = this.getInterfacePrototypeObject(primaryInterface),
  ): PlatformRecord<T> {
    if (isGlobalInterface(primaryInterface)) {
      throw new Error(
        `Use projectGlobalObject for ${primaryInterface.definition.name}`,
      );
    }
    this.#runImplementationInitializationSteps(
      implInst,
      primaryInterface,
    );
    const allocatePlatformObject = this.implementations
      .getPlatformObjectAllocationSteps(primaryInterface);
    const backingObject = allocatePlatformObject
      ? allocatePlatformObject(prototype)
      : this.realm.createOrdinaryObject(prototype);
    if (Reflect.getPrototypeOf(backingObject) !== prototype) {
      throw new Error(
        `Platform object for ${primaryInterface.definition.name} has the wrong prototype`,
      );
    }
    return this.associatePlatformObject(
      this.#legacyPlatformObjects.createObject(
        backingObject,
        implInst,
        this.#getLegacyProperties(primaryInterface),
      ),
      primaryInterface,
      implInst,
    );
  }

  // Project adapter for Web IDL §3.8 Platform objects implementing interfaces — allocation and members of a
  // [Global] object.
  projectGlobalObject<T extends object>(
    implInst: T,
    primaryInterface: AssembledInterfaceDefinition,
    allocation?: GlobalObjectAllocation,
  ): PlatformRecord<T> {
    if (!isGlobalInterface(primaryInterface)) {
      throw new Error(`${primaryInterface.definition.name} is not a global interface`);
    }
    if (!this.isExposed(primaryInterface)) {
      throw new Error(
        `Interface ${primaryInterface.definition.name} is not exposed in this realm`,
      );
    }
    if (this.#globalObject) {
      throw new Error('This binding already has a projected global object');
    }
    if (this.#legacyPlatformObjects.supportsIndexedProperties(primaryInterface)) {
      throw new Error('Global interfaces cannot use indexed properties');
    }
    this.#assertOrdinaryProjection(primaryInterface);
    this.#globalAllocation = allocation;
    if (allocation) {
      for (const interfaceName of allocation.prototypes.keys()) {
        const definition = this.resolveInterface(interfaceName).definition;
        if (this.#getInitialObjects(definition).interfacePrototypeObject) {
          throw new Error(`Prototype ${interfaceName} was already created before global allocation`);
        }
      }
    }
    const prototype = this.getInterfacePrototypeObject(primaryInterface);
    if (allocation && Reflect.getPrototypeOf(allocation.object) !== prototype) {
      throw new Error('Allocated global object has the wrong prototype');
    }
    this.#runImplementationInitializationSteps(implInst, primaryInterface);
    const platformObject = allocation?.object ?? this.#globalPlatformObjects.createObject(
      this.realm.createOrdinaryObject(prototype),
    );
    const record = this.associatePlatformObject(
      platformObject,
      primaryInterface,
      implInst,
    );
    this.#globalObject = record;

    this.#defineOperations(platformObject, primaryInterface, 'regular');
    this.#defineAttributes(platformObject, primaryInterface, 'regular');
    this.#defineStringifier(platformObject, primaryInterface, 'regular');
    this.#defineIterationMethods(platformObject, primaryInterface);
    this.#defineAsyncIterationMethods(platformObject, primaryInterface);
    this.#defineCollectionMembers(platformObject, primaryInterface);
    this.#defineGlobalPropertyReferences(platformObject);
    return record;
  }

  // Web IDL §3.8 Platform objects implementing interfaces — changing a platform object's associated realm.
  changePlatformObjectRealm(platformObject: object): void {
    const record = getPlatformRecord(platformObject);
    if (record?.binding.world !== this.world) {
      throw new TypeError('Value is not a platform object in this binding world');
    }

    const primaryInterface = this.resolveInterface(
      record.primaryInterface.definition.name,
    );
    if (primaryInterface.definition !== record.primaryInterface.definition) {
      throw new TypeError(
        'Target realm does not contain the platform object interface',
      );
    }

    const prototype = this.getInterfacePrototypeObject(primaryInterface);
    if (
      Reflect.getPrototypeOf(platformObject) !== prototype &&
      !Reflect.setPrototypeOf(platformObject, prototype)
    ) {
      throw new TypeError('Could not change the public platform object prototype');
    }
    record.binding = this;
  }

  // Project helper: register implementation/platform identity and initialize per-object binding state.
  associatePlatformObject<T extends object>(
    platformObject: object,
    primaryInterface: AssembledInterfaceDefinition,
    implInst: T,
  ): PlatformRecord<T> {
    const record = associatePlatformObject(platformObject, implInst, primaryInterface, this);
    this.#collections.initialize(record);
    // Extracted from Web IDL §3.8 Platform objects implementing interfaces — copy unforgeable properties
    // while internally creating a new object implementing the interface.
    for (const ancestor of getInheritance(primaryInterface)) {
      Object.defineProperties(
        platformObject,
        Object.getOwnPropertyDescriptors(
          this.#getUnforgeableObject(ancestor),
        ),
      );
    }
    return record;
  }

  // Project helper: run registered implementation initializers in inheritance order.
  #runImplementationInitializationSteps(
    implInst: object,
    primaryInterface: AssembledInterfaceDefinition,
  ): void {
    for (const ancestor of getInheritance(primaryInterface)) {
      this.implementations.getImplementationInitializationSteps(
        ancestor.definition,
      )?.(implInst);
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
    const elementType = getObservableArrayElementType(
      attribute.type,
      this.definitions,
    );
    if (
      record?.binding.world !== this.world ||
      !elementType ||
      !interfaceIncludesMember(record.primaryInterface, attribute)
    ) {
      throw new Error('Observable array attribute does not belong to object');
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
    primaryInterface: AssembledInterfaceDefinition,
  ): boolean {
    const record = getPlatformRecord(platformObject);
    return record?.binding.world === this.world &&
      record.implements(primaryInterface);
  }

  // Web IDL §3.7.5 Constants — define the constants.
  #defineConstants(target: object, definition: MemberDefinition): void {
    for (const entry of definition.members) {
      if (
        entry.member.kind !== 'constant' ||
        !this.#isMemberExposed(definition, entry)
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
        materializeDefaultValue(constant.value, constant.type, this),
        constant.type,
        this,
      ),
      writable: false,
    });
  }

  // Web IDL §3.7.6 Attributes — define the attributes.
  #defineAttributes(
    target: object,
    definition: MemberDefinition,
    kind: MemberPlacement,
  ): void {
    for (const entry of definition.members) {
      if (entry.member.kind !== 'attribute') continue;
      const attribute = entry.member;
      if (
        !belongsAt(attribute, kind) ||
        !this.#isMemberExposed(definition, entry)
      ) continue;

      defineProperty(target, attribute.name, {
        configurable: kind !== 'unforgeable',
        enumerable: true,
        get: this.#getAttributeGetter(definition, attribute),
        set: this.#getAttributeSetter(definition, attribute),
      });
    }
  }

  // Web IDL §3.7.7 Operations — define the operations.
  #defineOperations(
    target: object,
    definition: MemberDefinition,
    kind: MemberPlacement,
  ): void {
    const groups = new Map<string, OperationMember[]>();

    for (const entry of definition.members) {
      if (entry.member.kind !== 'operation' || !entry.member.name) continue;
      const operation = entry.member;
      if (
        !belongsAt(operation, kind) ||
        !this.#isMemberExposed(definition, entry)
      ) continue;

      const key = `${operation.static === true ? 'static' : 'regular'}:${operation.name}`;
      const group = groups.get(key);
      if (group) group.push(operation);
      else groups.set(key, [operation]);
    }

    for (const operations of groups.values()) {
      const name = operations[0]?.name;
      if (!name) continue;
      defineProperty(target, name, {
        configurable: kind !== 'unforgeable',
        enumerable: true,
        value: this.#getOperationFunction(
          definition,
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
    primaryInterface: AssembledInterfaceDefinition,
    placement: Extract<MemberPlacement, 'regular' | 'unforgeable'>,
  ): void {
    const entry = this.#getStringifierEntry(primaryInterface);
    if (!entry) return;
    const unforgeable = hasExtendedAttribute(
      entry.member.extendedAttributes,
      'LegacyUnforgeable',
    );
    if ((placement === 'unforgeable') !== unforgeable) return;

    defineProperty(target, 'toString', {
      configurable: !unforgeable,
      enumerable: true,
      value: this.#getStringifierFunction(primaryInterface, entry.member),
      writable: !unforgeable,
    });
  }

  // Project helper: find the exposed stringifier declaration.
  #getStringifierEntry(
    primaryInterface: AssembledInterfaceDefinition,
  ): StringifierEntry | undefined {
    return primaryInterface.members.find(
      (entry): entry is StringifierEntry => {
        const member = entry.member;
        const stringifier = member.kind === 'stringifier' ||
          (member.kind === 'attribute' && member.stringifier === true);
        return stringifier && this.#isMemberExposed(primaryInterface, entry);
      },
    );
  }

  // Project cache for the toString function in Web IDL §3.7.8 Stringifiers.
  #getStringifierFunction(
    primaryInterface: AssembledInterfaceDefinition,
    stringifier: StringifierMember | AttributeMember,
  ): JSFunction {
    return this.#getOrCreateMemberFunction(
      'stringifier',
      primaryInterface.definition,
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
          const receiver = this.#implementationRecord(
            thisArgument,
            primaryInterface,
            identifier,
            'method',
            false,
          );
          const object = receiver.implInst;

          let value: unknown;
          if (stringifier.kind === 'attribute') {
            const implementation = stringifier.inherit
              ? this.#findInheritedAttribute(primaryInterface, stringifier)
              : stringifier;
            const steps = this.implementations.getAttributeSteps(
              implementation,
              primaryInterface,
            );
            if (!steps) {
              throw missingImplementation(
                primaryInterface,
                `stringifier attribute ${stringifier.name}`,
              );
            }
            value = steps.get(receiver);
          } else {
            const behavior = this.implementations
              .getStringificationBehavior(stringifier, primaryInterface);
            if (!behavior) {
              throw missingImplementation(primaryInterface, 'stringifier');
            }
            value = Reflect.apply(behavior, object, []);
          }
          return convertToJavaScript(
            value,
            { kind: 'simple', name: 'DOMString' },
            this,
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
    primaryInterface: AssembledInterfaceDefinition,
  ): void {
    const entry = primaryInterface.members.find(({ member }) =>
      member.kind === 'iterable');
    if (this.#legacyPlatformObjects.supportsIndexedProperties(primaryInterface)) {
      this.#iterables.defineIndexedMethods(
        target,
        entry?.member.kind === 'iterable' &&
        entry.member.key === undefined &&
        this.#isMemberExposed(primaryInterface, entry),
      );
      return;
    }
    if (
      !entry ||
      entry.member.kind !== 'iterable' ||
      !this.#isMemberExposed(primaryInterface, entry)
    ) return;

    this.#iterables.defineMethods(
      target,
      primaryInterface,
      entry.member,
    );
  }

  // Web IDL §3.7.10 Asynchronous iterable declarations — define the asynchronous iteration methods; delegates
  // to AsynchronousIterableBinding.
  #defineAsyncIterationMethods(
    target: object,
    primaryInterface: AssembledInterfaceDefinition,
  ): void {
    const entry = primaryInterface.members.find(({ member }) =>
      member.kind === 'async-iterable');
    if (
      !entry ||
      entry.member.kind !== 'async-iterable' ||
      !this.#isMemberExposed(primaryInterface, entry)
    ) return;

    this.#asyncIterables.defineMethods(
      target,
      primaryInterface,
      entry.member,
    );
  }

  // Project dispatcher for Web IDL §3.7.11 Maplike declarations and §3.7.12 Setlike declarations.
  #defineCollectionMembers(
    target: object,
    primaryInterface: AssembledInterfaceDefinition,
  ): void {
    const declaration = primaryInterface.members.find(({ member }) =>
      member.kind === 'maplike' || member.kind === 'setlike')?.member;
    if (declaration?.kind === 'maplike') {
      this.#collections.defineMaplike(target, primaryInterface, declaration);
    } else if (declaration?.kind === 'setlike') {
      this.#collections.defineSetlike(target, primaryInterface, declaration);
    }
  }

  // Project helper: populate the realm's initial member-function and iterator-prototype caches.
  #initializeMemberObjects(primaryInterface: AssembledInterfaceDefinition): void {
    const operationGroups = new Map<string, OperationMember[]>();
    for (const entry of primaryInterface.members) {
      if (!this.#isMemberExposed(primaryInterface, entry)) continue;
      const { member } = entry;
      if (member.kind === 'attribute') {
        this.#getAttributeGetter(primaryInterface, member);
        this.#getAttributeSetter(primaryInterface, member);
      } else if (member.kind === 'operation' && member.name) {
        const key = `${member.static === true ? 'static' : 'regular'}:${member.name}`;
        const group = operationGroups.get(key);
        if (group) group.push(member);
        else operationGroups.set(key, [member]);
      } else if (member.kind === 'iterable') {
        this.#iterables.initializePrototype(primaryInterface, member);
      } else if (member.kind === 'async-iterable') {
        this.#asyncIterables.initializePrototype(primaryInterface, member);
      }
    }
    for (const operations of operationGroups.values()) {
      const name = operations[0]?.name;
      if (name) this.#getOperationFunction(primaryInterface, name, operations);
    }
    const stringifier = this.#getStringifierEntry(primaryInterface)?.member;
    if (
      stringifier?.kind === 'stringifier' ||
      stringifier?.kind === 'attribute'
    ) this.#getStringifierFunction(primaryInterface, stringifier);
  }

  // Project cache around Web IDL §3.7.6 Attributes — create an attribute getter.
  #getAttributeGetter(
    definition: MemberDefinition,
    attribute: AttributeMember,
  ): JSFunction {
    return this.#getOrCreateMemberFunction(
      'getter',
      definition.definition,
      attribute,
      () => this.realm.createFunction((thisArgument) => {
        let resultContext: ConversionContext | undefined;
        try {
          const primaryInterface = getMemberInterface(definition);
          const receiver = primaryInterface && !attribute.static
            ? this.#implementationRecord(
              thisArgument,
              primaryInterface,
              attribute.name,
              'getter',
              hasExtendedAttribute(
                attribute.extendedAttributes,
                'LegacyLenientThis',
              ),
            )
            : null;
          if (receiver === invalidReceiver) return undefined;
          resultContext = receiver?.binding ?? this;

          const elementType = getObservableArrayElementType(
            attribute.type,
            this.definitions,
          );
          if (elementType) {
            if (!receiver) {
              throw new Error('Observable array attribute was not regular');
            }
            return this.#observableArrays.get(
              receiver,
              attribute,
              elementType,
            );
          }

          const implementation = primaryInterface && attribute.inherit
            ? this.#findInheritedAttribute(primaryInterface, attribute)
            : attribute;
          const steps = this.implementations.getAttributeSteps(
            implementation,
            primaryInterface,
          );
          if (!steps) {
            throw missingImplementation(
              definition,
              `attribute ${attribute.name}`,
            );
          }
          const value = steps.get(receiver);
          return convertToJavaScript(
            value,
            attribute.type,
            resultContext,
          );
        } catch (exception) {
          return this.#handlePromiseException(
            attribute.type,
            exception,
            resultContext ?? this,
          );
        }
      }, { length: 0, name: `get ${attribute.name}` }),
    );
  }

  // Project cache around Web IDL §3.7.6 Attributes — create an attribute setter.
  #getAttributeSetter(
    definition: MemberDefinition,
    attribute: AttributeMember,
  ): JSFunction | undefined {
    if (definition.definition.kind === 'namespace') return;
    const primaryInterface = getMemberInterface(definition);
    if (!primaryInterface) throw new Error('Namespace attribute unexpectedly had a setter');
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

    return this.#getOrCreateMemberFunction(
      'setter',
      definition.definition,
      attribute,
      () => this.realm.createFunction((thisArgument, argumentsList) => {
        const value = argumentsList[0];
        const jsValue = this.#resolveThisValue(thisArgument);
        const receiver = attribute.static
          ? null
          : this.#implementationRecord(
            jsValue,
            primaryInterface,
            attribute.name,
            'setter',
            hasExtendedAttribute(
              attribute.extendedAttributes,
              'LegacyLenientThis',
            ),
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
          if (!receiver) throw new Error('PutForwards used on a static attribute');
          if (!isObject(jsValue)) {
            return this.#throwTypeError('Invalid receiver');
          }
          const forwarded = Reflect.get(jsValue, attribute.name) as unknown;
          if (!isObject(forwarded)) {
            return this.#throwTypeError(
              `${attribute.name} does not reference an object`,
            );
          }
          Reflect.set(forwarded, putForwards, value);
          return undefined;
        }

        const observableArrayElementType = getObservableArrayElementType(
          attribute.type,
          this.definitions,
        );
        if (observableArrayElementType) {
          if (!receiver) {
            throw new Error('Observable array attribute was not regular');
          }
          this.#observableArrays.replace(
            receiver,
            attribute,
            observableArrayElementType,
            value,
          );
          return undefined;
        }

        const enumValue = this.#convertEnumerationSetterValue(
          value,
          attribute.type,
        );
        if (enumValue === invalidEnumerationValue) return undefined;
        const idlValue = enumValue === notAnEnumeration
          ? convertToIDL(value, attribute.type, this, {
            attributeAssignment: true,
          })
          : enumValue;
        const steps = this.implementations.getAttributeSteps(
          attribute,
          primaryInterface,
        );
        if (!steps?.set) {
          throw missingImplementation(
            definition,
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
    definition: MemberDefinition,
    name: string,
    operations: OperationMember[],
  ): JSFunction {
    const source = operations[0];
    if (!source) throw new Error(`Operation group ${name} is empty`);
    return this.#getOrCreateMemberFunction(
      'operation',
      definition.definition,
      source,
      () => this.realm.createFunction((thisArgument, argumentsList) => {
        let resultContext: ConversionContext | undefined;
        try {
          const primaryInterface = getMemberInterface(definition);
          const receiver = primaryInterface && !operations[0]?.static
            ? this.#implementationRecord(
              thisArgument,
              primaryInterface,
              name,
              'method',
              false,
            )
            : null;
          resultContext = receiver?.binding ?? this;

          const overload = resolveOverload(
            computeEffectiveOverloadSet(operations, argumentsList.length),
            argumentsList,
            this,
          );
          const steps = this.implementations.getOperationSteps(
            overload.callable,
            primaryInterface,
          );
          if (hasExtendedAttribute(
            overload.callable.extendedAttributes,
            'Default',
          )) {
            if (!receiver || !primaryInterface) {
              throw new Error('Default operation used as a static operation');
            }
            return convertToJavaScript(
              this.#runDefaultOperation(primaryInterface, receiver),
              overload.callable.returns,
              this,
            );
          }
          if (!steps) {
            throw missingImplementation(definition, `operation ${name}`);
          }
          const result = steps(receiver, ...overload.values);
          if (overload.callable.newBufferResult) {
            const type = getUnannotatedType(overload.callable.returns, this.definitions);
            if (type.kind === 'promise') {
              return projectPromise(result, type.type, resultContext, true);
            }
            return createBufferResult(
              result as ByteSequence,
              overload.callable.returns,
              resultContext,
            );
          }
          return convertToJavaScript(
            result,
            overload.callable.returns,
            resultContext,
          );
        } catch (exception) {
          const returnType = operations[0]?.returns;
          if (!returnType) throw exception;
          return this.#handlePromiseException(
            returnType,
            exception,
            resultContext ?? this,
          );
        }
      }, { length: getCallableLength(operations), name }),
    );
  }

  // Extracted from Web IDL §3.7.6 Attributes and §3.7.7 Operations — reject promise results when invocation
  // throws.
  #handlePromiseException(
    type: WebIDLType,
    exception: unknown,
    context: ConversionContext,
  ): Promise<unknown> {
    const promiseType = getUnannotatedType(type, this.definitions);
    if (promiseType.kind !== 'promise') throw exception;
    return createRejectedPromise(exception, promiseType.type, context).promise;
  }

  // Web IDL §3.7.7.1.1 Default toJSON operation — default toJSON steps and attribute-value collection.
  #runDefaultOperation(
    primaryInterface: AssembledInterfaceDefinition,
    receiver: PlatformRecord,
  ): object {
    const result = this.realm.createOrdinaryObject(
      this.realm.intrinsics.objectPrototype,
    );

    for (const ancestor of getInheritance(primaryInterface)) {
      const hasDefaultToJSON = ancestor.members.some(({ member }) =>
        member.kind === 'operation' &&
        member.name === 'toJSON' &&
        hasExtendedAttribute(member.extendedAttributes, 'Default'));
      if (!hasDefaultToJSON) continue;

      for (const entry of ancestor.members) {
        if (
          entry.member.kind !== 'attribute' ||
          entry.member.static ||
          !this.#isMemberExposed(ancestor, entry) ||
          !this.#isJSONType(entry.member.type)
        ) continue;

        const attribute = entry.member;
        const implementation = attribute.inherit
          ? this.#findInheritedAttribute(ancestor, attribute)
          : attribute;
        const steps = this.implementations.getAttributeSteps(
          implementation,
          ancestor,
        );
        if (!steps) {
          throw missingImplementation(
            ancestor,
            `attribute ${attribute.name}`,
          );
        }
        const idlValue = steps.get(receiver);
        defineProperty(result, attribute.name, {
          configurable: true,
          enumerable: true,
          value: convertToJavaScript(idlValue, attribute.type, this),
          writable: true,
        });
      }
    }
    return result;
  }

  // Web IDL §2.5.3.1 toJSON — JSON types definition.
  #isJSONType(type: WebIDLType, seen = new Set<string>()): boolean {
    const unannotated = getUnannotatedType(type, this.definitions);
    switch (unannotated.kind) {
      case 'simple':
        return jsonSimpleTypes.has(unannotated.name);
      case 'nullable':
        return this.#isJSONType(unannotated.type, seen);
      case 'union':
        return unannotated.types.every((member) =>
          this.#isJSONType(member, seen));
      case 'sequence':
      case 'frozen-array':
        return this.#isJSONType(unannotated.type, seen);
      case 'record':
        return this.#isJSONType(unannotated.value, seen);
      case 'reference': {
        if (seen.has(unannotated.name)) return false;
        const definition = this.definitions.getDefinition(unannotated.name);
        if (definition?.kind === 'enumeration') return true;

        const nextSeen = new Set(seen).add(unannotated.name);
        if (definition?.kind === 'dictionary') {
          const dictionary = this.definitions.getDictionary(unannotated.name);
          return dictionary
            ? dictionary.members.every((member) =>
              this.#isJSONType(member.type, nextSeen))
            : false;
        }
        if (definition?.kind === 'interface') {
          let primaryInterface = this.definitions.getInterface(unannotated.name);
          while (primaryInterface) {
            if (primaryInterface.members.some(({ member }) =>
              member.kind === 'operation' &&
              member.name === 'toJSON')) return true;
            primaryInterface = primaryInterface.parent;
          }
        }
        return false;
      }
      default:
        return false;
    }
  }

  // Project helper: reject special operations whose platform behavior is not implemented.
  #assertOrdinaryProjection(primaryInterface: AssembledInterfaceDefinition): void {
    for (const { member } of primaryInterface.members) {
      if (member.kind === 'operation' && member.special) {
        if (this.#legacyPlatformObjects.supportsSpecialOperation(member)) {
          continue;
        }
        throw new Error(
          `${primaryInterface.definition.name} requires deferred legacy platform object machinery`,
        );
      }
    }
  }

  // Project cache for the unforgeables object in Web IDL §3.7.1 Interface object.
  #getUnforgeableObject(primaryInterface: AssembledInterfaceDefinition): object {
    const initial = this.#getInitialObjects(primaryInterface.definition);
    if (initial.unforgeablesObject) return initial.unforgeablesObject;

    const object = this.realm.createOrdinaryObject(null);
    initial.unforgeablesObject = object;
    this.#defineAttributes(object, primaryInterface, 'unforgeable');
    this.#defineOperations(object, primaryInterface, 'unforgeable');
    this.#defineStringifier(object, primaryInterface, 'unforgeable');
    return object;
  }

  // Project cache for Web IDL §3.7.4 Named properties object.
  #getNamedPropertiesObject(primaryInterface: AssembledInterfaceDefinition): object {
    const initial = this.#getInitialObjects(primaryInterface.definition);
    if (initial.namedPropertiesObject) return initial.namedPropertiesObject;

    const parent = primaryInterface.parent
      ? this.getInterfacePrototypeObject(primaryInterface.parent)
      : this.realm.intrinsics.objectPrototype;
    const object = this.#globalPlatformObjects.createNamedPropertiesObject(
      primaryInterface,
      parent,
      () => this.#globalObject?.platformObject,
      this.#globalAllocation?.namedProperties,
    );
    initial.namedPropertiesObject = object;
    return object;
  }

  // Project predicate for Web IDL §3.7.3 Interface prototype object — immutable global prototype-chain rule.
  #hasImmutableGlobalPrototype(primaryInterface: AssembledInterfaceDefinition): boolean {
    if (this.realm.isGlobalPrototypeChainMutable) return false;
    for (const candidate of this.definitions.getInterfaces()) {
      if (!isGlobalInterface(candidate)) continue;
      let current: AssembledInterfaceDefinition | undefined = candidate;
      while (current) {
        if (current === primaryInterface) return true;
        current = current.parent;
      }
    }
    return false;
  }

  // Web IDL §3.8 Platform objects implementing interfaces — define the global property references.
  #defineGlobalPropertyReferences(
    target: object,
  ): void {
    const window = this.definitions.getInterface('Window');
    const record = getPlatformRecord(target);
    const isWindow = Boolean(
      window &&
      record &&
      record.implements(window),
    );

    for (const [name, object] of this.getExposedGlobalProperties(isWindow)) {
      defineProperty(target, name, {
        configurable: true,
        enumerable: false,
        value: object,
        writable: true,
      });
    }
  }

  // Web IDL §3.7.3 Interface prototype object — @@unscopables setup for [Unscopable] members.
  #defineUnscopables(target: object, primaryInterface: AssembledInterfaceDefinition): void {
    const names = new Set<string>();
    for (const entry of primaryInterface.members) {
      const { member } = entry;
      if (
        (member.kind !== 'attribute' && member.kind !== 'operation') ||
        member.static || !member.name ||
        !hasExtendedAttribute(member.extendedAttributes, 'Unscopable') ||
        !this.#isMemberExposed(primaryInterface, entry)
      ) continue;
      names.add(member.name);
    }
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
  #implementationRecord(
    thisArgument: unknown,
    primaryInterface: AssembledInterfaceDefinition,
    identifier: string,
    type: 'getter' | 'method' | 'setter',
    lenient: false,
  ): PlatformRecord;
  #implementationRecord(
    thisArgument: unknown,
    primaryInterface: AssembledInterfaceDefinition,
    identifier: string,
    type: 'getter' | 'method' | 'setter',
    lenient: boolean,
  ): PlatformRecord | typeof invalidReceiver;
  #implementationRecord(
    thisArgument: unknown,
    primaryInterface: AssembledInterfaceDefinition,
    identifier: string,
    type: 'getter' | 'method' | 'setter',
    lenient: boolean,
  ): PlatformRecord | typeof invalidReceiver {
    const value = this.#resolveThisValue(thisArgument);
    const record = this.#resolveReceiverRecord(value);
    if (record) {
      this.realm.performSecurityCheck(record.platformObject!, identifier, type);
    }
    if (!record || !record.implements(primaryInterface)) {
      if (lenient) return invalidReceiver;
      return this.#throwTypeError('Illegal invocation');
    }
    return record;
  }

  // Project helper: resolve direct platform receivers and host-defined receiver aliases.
  #resolveReceiverRecord(
    value: unknown,
  ): PlatformRecord | undefined {
    const direct = getPlatformRecord(value);
    if (direct?.binding.world === this.world) return direct;

    for (const hostInterface of this.hostDefinedInterfaces.values()) {
      if (!hostInterface.is(value)) continue;
      const platformObject = hostInterface.resolveReceiver?.(value);
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

  // Project lookup for Web IDL §3.7.6 Attributes — inherited attribute getter and setter steps.
  #findInheritedAttribute(
    primaryInterface: AssembledInterfaceDefinition,
    attribute: AttributeMember,
  ): AttributeMember {
    let parent = primaryInterface.parent;
    while (parent) {
      for (let i = parent.members.length - 1; i >= 0; i--) {
        const member = parent.members[i]?.member;
        if (
          member?.kind === 'attribute' &&
          member.name === attribute.name &&
          Boolean(member.static) === Boolean(attribute.static)
        ) return member;
      }
      parent = parent.parent;
    }
    throw new Error(
      `Inherited attribute ${primaryInterface.definition.name}.${attribute.name} has no ancestor declaration`,
    );
  }

  // Extracted from Web IDL §3.7.6 Attributes — enumeration setter conversion and invalid-value handling.
  #convertEnumerationSetterValue(
    value: unknown,
    type: WebIDLType,
  ): string | typeof notAnEnumeration | typeof invalidEnumerationValue {
    const unannotated = getUnannotatedType(type, this.definitions);
    if (unannotated.kind !== 'reference') return notAnEnumeration;
    const definition = this.definitions.getDefinition(unannotated.name);
    if (definition?.kind !== 'enumeration') return notAnEnumeration;

    const string = convertToIDL(value, {
      kind: 'simple',
      name: 'DOMString',
    }, this) as string;
    return definition.values.includes(string)
      ? string
      : invalidEnumerationValue;
  }

  // Project helper: collect exposed constructor declarations.
  #getConstructors(primaryInterface: AssembledInterfaceDefinition): ConstructorMember[] {
    return primaryInterface.members
      .filter((entry) =>
        entry.member.kind === 'constructor' &&
        this.#isMemberExposed(primaryInterface, entry))
      .map((entry) => entry.member as ConstructorMember);
  }

  // Project helper: combine exposure checks for a member, its declaration fragment, and its owner.
  #isMemberExposed(
    definition: MemberDefinition,
    entry: MemberEntry,
  ): boolean {
    return this.#isConstructExposed(definition.definition) &&
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
  #getLegacyProperties(primaryInterface: AssembledInterfaceDefinition): LegacyProperties | null {
    const initial = this.#getInitialObjects(primaryInterface.definition);
    // null records an ordinary interface; undefined means it has not been inspected yet.
    if (initial.legacyProperties === undefined) {
      initial.legacyProperties = this.#legacyPlatformObjects.createInterfaceProperties(primaryInterface);
    }
    return initial.legacyProperties;
  }

  // Project helper: retrieve or allocate a definition's initial-object cache.
  #getInitialObjects(definition: InitialObjectDefinition): DefinitionInitialObjects {
    let initial = this.#initialObjects.get(definition);
    if (!initial) {
      initial = {};
      this.#initialObjects.set(definition, initial);
    }
    return initial;
  }

  // Project helper: retain each initial getter, setter, or operation function in its realm.
  #getOrCreateMemberFunction(
    kind: keyof MemberInitialObjects,
    definition: MemberDefinition['definition'],
    member: InitialObjectMember,
    create: () => JSFunction,
  ): JSFunction {
    const initial = this.#getInitialObjects(definition);
    const members = initial.members ??= new Map<InitialObjectMember, MemberInitialObjects>();
    let objects = members.get(member);
    if (!objects) {
      objects = {};
      members.set(member, objects);
    }
    const existing = objects[kind];
    if (existing) return existing;

    const object = create();
    objects[kind] = object;
    return object;
  }

  // Project helper: throw a TypeError allocated in this binding's realm.
  #throwTypeError(message: string): never {
    throw new this.realm.intrinsics.typeError(message);
  }
}

/** Privately retain the realm-owned error for an internal failure. */
class ExceptionStamper extends Stamper {
  #realizedError: object;

  private constructor(exception: object, realizedError: object) {
    super(exception);
    this.#realizedError = realizedError;
  }

  static stamp<T extends object>(exception: T, realizedError: object): T & ExceptionStamper {
    new ExceptionStamper(exception, realizedError);
    return exception as T & ExceptionStamper;
  }

  static get(exception: object): object | undefined {
    return #realizedError in exception ? exception.#realizedError : undefined;
  }
}

export type AttributeFunctionCallback = (this: unknown, ...argumentsList: unknown[]) => unknown;

type JSFunction = ReturnType<WebIDLRealmHost['createFunction']>;
type InterfaceObject = JSFunction & { prototype: object; };
type MemberDefinition = AssembledInterfaceDefinition | AssembledNamespaceDefinition;
type MemberEntry = AssembledInterfaceMember | AssembledNamespaceMember;
type InitialObjectDefinition = MemberDefinition['definition'] | CallbackInterfaceDefinition;
type InitialObjectMember = AttributeMember | OperationMember | StringifierMember;
/** Supply before projecting any object that needs these interface prototypes. */
export type GlobalObjectAllocation = {
  readonly object: object;
  readonly prototypes: ReadonlyMap<string, object>;
  readonly namedProperties?: {
    readonly object: object;
    setDelegate(delegate: object): void;
  };
};

type MemberPlacement = 'regular' | 'static' | 'unforgeable';
type DefinitionInitialObjects = {
  asyncIteratorPrototype?: object;
  interfaceObject?: InterfaceObject;
  interfacePrototypeObject?: object;
  iteratorPrototype?: object;
  legacyCallbackInterfaceObject?: JSFunction;
  legacyFactoryFunctions?: Map<string, JSFunction>;
  legacyProperties?: LegacyProperties | null;
  members?: Map<InitialObjectMember, MemberInitialObjects>;
  namedPropertiesObject?: object;
  namespaceObject?: object;
  unforgeablesObject?: object;
};
type MemberInitialObjects = Partial<Record<
  'attributeFunction' | 'getter' | 'operation' | 'setter' | 'stringifier',
  JSFunction
>>;
type StringifierEntry = AssembledInterfaceMember & {
  member: StringifierMember | AttributeMember;
};
type Exposable = {
  exposed?: Exposure;
  extendedAttributes?: ExtendedAttribute[];
};

const invalidEnumerationValue = Symbol('invalid enumeration value');
const invalidReceiver = Symbol('invalid receiver');
const notAnEnumeration = Symbol('not an enumeration');
const jsonSimpleTypes = new Set([
  'boolean', 'byte', 'octet', 'short', 'unsigned short', 'long',
  'unsigned long', 'long long', 'unsigned long long', 'float',
  'unrestricted float', 'double', 'unrestricted double', 'DOMString',
  'ByteString', 'USVString', 'object',
]);

// Extracted from Web IDL §3.7.1 Interface object, §3.7.2 Legacy factory functions, and §3.7.7 Operations —
// function length from the effective overload set.
function getCallableLength(
  callables: IDLCallable[],
): number {
  if (callables.length === 0) return 0;
  const overloads = computeEffectiveOverloadSet(callables, 0);
  return overloads.reduce(
    (length, overload) => Math.min(length, overload.types.length),
    Infinity,
  );
}

// Project helper: collect matching [LegacyFactoryFunction] declarations across interface fragments.
function getLegacyFactoryFunctionDeclarations(
  primaryInterface: AssembledInterfaceDefinition,
  id: string,
): NamedArgumentsExtendedAttribute[] {
  const declarations: NamedArgumentsExtendedAttribute[] = [];
  for (const definition of [primaryInterface.definition, ...primaryInterface.partials]) {
    for (const attribute of definition.extendedAttributes ?? []) {
      if (
        attribute.kind === 'named-arguments' &&
        attribute.name === 'LegacyFactoryFunction' &&
        attribute.value === id
      ) declarations.push(attribute);
    }
  }
  return declarations;
}

// Project helper: collect distinct [LegacyFactoryFunction] identifiers across interface fragments.
function getLegacyFactoryFunctionIdentifiers(
  primaryInterface: AssembledInterfaceDefinition,
): string[] {
  const identifiers = new Set<string>();
  for (const definition of [primaryInterface.definition, ...primaryInterface.partials]) {
    for (const attribute of definition.extendedAttributes ?? []) {
      if (
        attribute.kind === 'named-arguments' &&
        attribute.name === 'LegacyFactoryFunction'
      ) identifiers.add(attribute.value);
    }
  }
  return [...identifiers];
}

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

// Project helper: list assembled interfaces from the oldest ancestor to the most derived.
function getInheritance(primaryInterface: AssembledInterfaceDefinition): AssembledInterfaceDefinition[] {
  const inheritance: AssembledInterfaceDefinition[] = [];
  let current: AssembledInterfaceDefinition | undefined = primaryInterface;
  while (current) {
    inheritance.unshift(current);
    current = current.parent;
  }
  return inheritance;
}

// Project helper: test membership across an assembled interface's inheritance chain.
function interfaceIncludesMember(
  primaryInterface: AssembledInterfaceDefinition,
  member: AttributeMember,
): boolean {
  let current: AssembledInterfaceDefinition | undefined = primaryInterface;
  while (current) {
    if (current.members.some((entry) => entry.member === member)) return true;
    current = current.parent;
  }
  return false;
}

// Project helper: resolve aliases and annotations before selecting an observable array's element type.
function getObservableArrayElementType(
  type: WebIDLType,
  definitions: DefinitionAssembly,
): WebIDLType | undefined {
  const resolved = getUnannotatedType(type, definitions);
  return resolved.kind === 'observable-array'
    ? resolved.type
    : undefined;
}

// Project helper: distinguish an assembled interface from an assembled namespace.
function getMemberInterface(
  definition: MemberDefinition,
): AssembledInterfaceDefinition | undefined {
  return 'parent' in definition
    ? definition
    : undefined;
}

// Project predicate: find [Global] on the interface or its partial declarations.
function isGlobalInterface(primaryInterface: AssembledInterfaceDefinition): boolean {
  return [primaryInterface.definition, ...primaryInterface.partials].some(
    (definition) => hasExtendedAttribute(
      definition.extendedAttributes,
      'Global',
    ),
  );
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

// Project helper: qualify an interface name with its [LegacyNamespace], if present.
function getQualifiedName(
  definition: { extendedAttributes?: ExtendedAttribute[]; name: string; },
): string {
  const namespace = getIdentifierAttribute(definition, 'LegacyNamespace');
  return namespace
    ? `${namespace}.${definition.name}`
    : definition.name;
}

// Project helper: read an identifier or identifier-list extended attribute as a list.
function getIdentifierListAttribute(
  construct: { extendedAttributes?: ExtendedAttribute[]; },
  name: string,
): string[] {
  const attribute = construct.extendedAttributes?.find(
    (candidate) =>
      (candidate.kind === 'identifier' ||
        candidate.kind === 'identifier-list') &&
        candidate.name === name,
  );
  if (attribute?.kind === 'identifier') return [attribute.value];
  return attribute?.kind === 'identifier-list' ? attribute.values : [];
}

// Extracted from Web IDL §3.8 Platform objects implementing interfaces — order global references by interface
// inheritance.
function orderInterfacesByInheritance(
  interfaces: AssembledInterfaceDefinition[],
): AssembledInterfaceDefinition[] {
  const remaining = new Set(interfaces);
  const ordered: AssembledInterfaceDefinition[] = [];
  while (remaining.size > 0) {
    const primaryInterface = interfaces.find((candidate) =>
      remaining.has(candidate) &&
      (!candidate.parent || !remaining.has(candidate.parent)));
    if (!primaryInterface) throw new Error('Interface inheritance contains a cycle');
    remaining.delete(primaryInterface);
    ordered.push(primaryInterface);
  }
  return ordered;
}

// Project helper: define a binding property or report a setup failure.
function defineProperty(
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor,
): void {
  if (!Reflect.defineProperty(target, key, descriptor)) {
    throw new Error(`Could not define Web IDL property ${String(key)}`);
  }
}

// Project helper: describe missing implementation steps in a binding declaration.
function missingImplementation(
  definition: MemberDefinition,
  member: string,
): Error {
  return new Error(
    `Web IDL ${definition.definition.name} ${member} has no implementation steps`,
  );
}
