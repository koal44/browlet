import { isObject, type ByteSequence } from '../js-engine/index';
import { getDOMExceptionRequest } from './exceptions/dom-exception-core';
import { getSimpleExceptionRequest } from '../js-engine/simple-exception';
import type {
  AssembledInterface, AssembledInterfaceMember, AssembledNamespace,
  AssembledNamespaceMember, DefinitionAssembly,
} from './assembly';
import { AsynchronousIterableBinding } from './async-iterable';
import {
  CollectionBinding, type IDLMapEntries, type IDLSetEntries,
} from './collection';
import {
  convertToIDL, convertToJavaScript, createBufferResult, materializeDefaultValue,
  type ConversionContext, type HostDefinedInterface,
} from './conversion';
import {
  hasExtendedAttribute, type AttributeMember,
  type CallbackInterfaceDefinition, type ConstantMember,
  type ConstructorMember, type Exposure, type ExtendedAttribute,
  type NamedArgumentsExtendedAttribute, type OperationMember,
  type StringifierMember, type WebIDLType,
} from './declaration/definition';
import { GlobalPlatformObjectBinding } from './global-platform-object';
import {
  ImplementationRegistry, type ConstructorBehavior,
} from './registry';
import { SynchronousIterableBinding } from './iterable';
import type { WebIDLRealmHost } from './js-realm';
import { LegacyPlatformObjectBinding } from './legacy-platform-object';
import {
  computeEffectiveOverloadSet, type IDLCallable, resolveOverload,
} from './overload';
import { ObservableArrayBinding } from './observable-array';
import type {
  PlatformObjectRecord, PlatformObjectRegistry,
} from './platform-object';
import { createRejectedPromise, projectPromise } from './promise';
import { getUnannotatedType } from './types';
import { CapabilityRegistry } from './capability';
import type { FunctionResultSteps } from './declaration/binding';

export class RealmBinding {
  readonly definitions: DefinitionAssembly;
  readonly hostDefinedInterfaces: ReadonlyMap<string, HostDefinedInterface>;
  readonly implementations: ImplementationRegistry;
  readonly capabilities: CapabilityRegistry;
  readonly platformObjects: PlatformObjectRegistry;
  readonly projectImplementationObject = (
    value: object,
    expectedInterface: AssembledInterface,
  ): object | undefined => this.#projectInRealm(
    value,
    expectedInterface,
    this.realm,
  );
  readonly realizeException: (value: unknown) => unknown;
  readonly realm: WebIDLRealmHost;
  readonly #collections: CollectionBinding;
  readonly #asyncIterables: AsynchronousIterableBinding;
  readonly #initialObjects = new WeakMap<object, DefinitionInitialObjects>();
  readonly #globalPlatformObjects: GlobalPlatformObjectBinding;
  #globalObject: PlatformObjectRecord | undefined;
  #globalAllocation: GlobalObjectAllocation | undefined;
  readonly #iterables: SynchronousIterableBinding;
  readonly #legacyPlatformObjects: LegacyPlatformObjectBinding;
  readonly #observableArrays: ObservableArrayBinding;
  readonly #realizedExceptions = new WeakMap<object, object>();

  #projectInRealm(
    value: object,
    expectedInterface: AssembledInterface,
    realm: WebIDLRealmHost,
  ): object | undefined {
    const existing = this.platformObjects.getImplementationRecord(value);
    if (existing) {
      return this.platformObjects.recordImplements(existing, expectedInterface)
        ? existing.platformObject
        : undefined;
    }

    const origin = this.platformObjects.getImplementationOrigin(value);
    if (origin) {
      return this.platformObjects.interfaceImplements(
        origin.primaryInterface,
        expectedInterface,
      )
        ? this.platformObjects.projectImplementationOrigin(value)
        : undefined;
    }

    const registered = this.implementations.getImplementationForObject(value);
    if (
      !registered ||
      !this.platformObjects.interfaceImplements(
        registered.interface_,
        expectedInterface,
      )
    ) return;
    if (realm !== this.realm) {
      this.platformObjects.associateOrigin(
        value,
        registered.interface_,
        realm,
      );
      return this.platformObjects.projectImplementationOrigin(value);
    }
    return this.projectPlatformObject(
      value,
      registered.interface_,
    ).platformObject;
  }

  constructor(
    definitions: DefinitionAssembly,
    realm: WebIDLRealmHost,
    platformObjects: PlatformObjectRegistry,
    implementations = new ImplementationRegistry(),
    hostDefinedInterfaces: HostDefinedInterface[] = [],
    capabilities = new CapabilityRegistry(definitions, []),
  ) {
    this.definitions = definitions;
    this.hostDefinedInterfaces = new Map(
      hostDefinedInterfaces.map((interface_) => [interface_.name, interface_]),
    );
    this.implementations = implementations;
    this.capabilities = capabilities;
    this.realm = realm;
    this.platformObjects = platformObjects;
    this.realizeException = (value) => {
      if (!isObject(value)) return value;
      const existing = this.#realizedExceptions.get(value);
      if (existing) return existing;
      const simple = getSimpleExceptionRequest(value);
      if (simple) {
        const error = new this.realm.intrinsics[simple.type](simple.message);
        this.#realizedExceptions.set(value, error);
        return error;
      }
      const request = getDOMExceptionRequest(value);
      if (!request) return value;
      const DOMException_ = this.getInterfaceObject(
        'DOMException',
      ) as unknown as typeof DOMException;
      const error = new DOMException_(request.message, request.name);
      this.#realizedExceptions.set(value, error);
      return error;
    };
    this.#asyncIterables = new AsynchronousIterableBinding(
      this,
      implementations,
      (interface_, create) => {
        const initial = this.#getInitialObjects(interface_.definition);
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
      (interface_, create) => {
        const initial = this.#getInitialObjects(interface_.definition);
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
  }

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

  getExposedGlobalProperties(
    isWindow = this.realm.globalNames.has('Window'),
  ): Map<string, object> {
    const installed = new Map<string, object>();
    const interfaces = orderInterfacesByInheritance(
      this.definitions.getInterfaces()
        .filter((interface_) => this.isExposed(interface_)),
    );

    for (const interface_ of interfaces) {
      const definition = interface_.definition;
      this.getInterfacePrototypeObject(interface_);
      this.#initializeMemberObjects(interface_);
      if (
        !hasExtendedAttribute(
          definition.extendedAttributes,
          'LegacyNoInterfaceObject',
        ) &&
        getIdentifierAttribute(definition, 'LegacyNamespace') === undefined
      ) {
        const object = this.getInterfaceObject(interface_);
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
      for (const id of getLegacyFactoryFunctionIdentifiers(interface_)) {
        installed.set(id, this.getLegacyFactoryFunction(interface_, id));
      }
    }
    for (const interface_ of this.definitions.getCallbackInterfaces()) {
      if (
        interface_.exposed === undefined ||
        !interface_.members.some((member) => member.kind === 'constant') ||
        !this.#isConstructExposed(interface_)
      ) continue;
      installed.set(
        interface_.name,
        this.getLegacyCallbackInterfaceObject(interface_),
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

  getInterfaceObject(
    interface_: string | AssembledInterface,
  ): InterfaceObject {
    const assembled = this.#resolveInterface(interface_);
    const initial = this.#getInitialObjects(assembled.definition);
    if (initial.interfaceObject) return initial.interfaceObject;

    const constructors = this.#getConstructors(assembled);
    const overridden = this.implementations.getOverriddenConstructorSteps(
      assembled.definition,
    );
    const object = this.realm.createFunction(
      (_thisArgument, argumentsList, newTarget) => {
        if (overridden) {
          return overridden(argumentsList, newTarget, object);
        }
        if (constructors.length === 0) {
          return this.#throwTypeError('Illegal constructor');
        }
        if (!newTarget) {
          return this.#throwTypeError(
            `Failed to construct '${assembled.definition.name}': use the 'new' operator.`,
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
        length: getCallableLength(constructors),
        name: assembled.definition.name,
      },
    );

    initial.interfaceObject = object;
    this.#getUnforgeableObject(assembled);
    Reflect.setPrototypeOf(
      object,
      assembled.parent
        ? this.getInterfaceObject(assembled.parent)
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

  getLegacyCallbackInterfaceObject(
    interface_: string | CallbackInterfaceDefinition,
  ): object {
    const name = typeof interface_ === 'string'
      ? interface_
      : interface_.name;
    const definition = typeof interface_ === 'string'
      ? this.definitions.getCallbackInterface(name)
      : interface_;
    if (!definition) {
      throw new Error(`Unknown Web IDL callback interface ${name}`);
    }

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

  getLegacyFactoryFunction(
    interface_: string | AssembledInterface,
    id: string,
  ): JSFunction {
    const assembled = this.#resolveInterface(interface_);
    const declarations = getLegacyFactoryFunctionDeclarations(
      assembled,
      id,
    );
    const source = declarations[0];
    if (!source) {
      throw new Error(
        `${assembled.definition.name} has no legacy factory function ${id}`,
      );
    }

    const initial = this.#getInitialObjects(assembled.definition);
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
            `Web IDL ${assembled.definition.name} legacy factory function ${id} has no implementation steps`,
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
        length: getCallableLength(declarations),
        name: id,
      },
    );
    defineProperty(function_, 'prototype', {
      configurable: false,
      enumerable: false,
      value: this.getInterfacePrototypeObject(assembled),
      writable: false,
    });
    (initial.legacyFactoryFunctions ??= new Map()).set(id, function_);
    return function_;
  }

  /** Retain an attribute's returned function alongside its getter in this realm. */
  getFunctionResult(
    interface_: AssembledInterface,
    attribute: AttributeMember,
    length: number,
    createSteps: () => FunctionResultSteps,
  ): JSFunction {
    return this.#getOrCreateMemberInitialObject(
      'functionResult', interface_.definition, attribute,
      () => {
        const steps = createSteps();
        return this.realm.createFunction((thisArgument, argumentsList) => {
          try {
            return Reflect.apply(steps, thisArgument, argumentsList);
          } catch (exception) {
            throw this.realizeException(exception);
          }
        }, { length, name: attribute.name });
      },
    );
  }

  getNamespaceObject(
    namespace: string | AssembledNamespace,
  ): object {
    const assembled = this.#resolveNamespace(namespace);
    const initial = this.#getInitialObjects(assembled.definition);
    if (initial.namespaceObject) return initial.namespaceObject;

    const object = this.realm.createOrdinaryObject(
      this.realm.intrinsics.objectPrototype,
    );
    initial.namespaceObject = object;
    this.#defineAttributes(object, assembled, 'regular');
    this.#defineOperations(object, assembled, 'regular');
    this.#defineConstants(object, assembled);

    for (const interface_ of this.definitions.getInterfaces()) {
      if (
        getIdentifierAttribute(
          interface_.definition,
          'LegacyNamespace',
        ) !== assembled.definition.name ||
        !this.isExposed(interface_)
      ) continue;
      defineProperty(object, interface_.definition.name, {
        configurable: true,
        enumerable: false,
        value: this.getInterfaceObject(interface_),
        writable: true,
      });
    }
    defineProperty(object, Symbol.toStringTag, {
      configurable: true,
      enumerable: false,
      value: assembled.definition.name,
      writable: false,
    });
    return object;
  }

  getInterfacePrototypeObject(
    interface_: string | AssembledInterface,
  ): object {
    const assembled = this.#resolveInterface(interface_);
    const initial = this.#getInitialObjects(assembled.definition);
    if (initial.interfacePrototypeObject) {
      return initial.interfacePrototypeObject;
    }

    this.#assertOrdinaryProjection(assembled);

    const global = isGlobalInterface(assembled);
    const parentPrototype = global &&
      this.#globalPlatformObjects.supportsNamedProperties(assembled)
      ? this.#getNamedPropertiesObject(assembled)
      : assembled.parent
        ? this.getInterfacePrototypeObject(assembled.parent)
        : assembled.definition.name === 'DOMException'
          ? this.realm.intrinsics.errorPrototype
          : this.realm.intrinsics.objectPrototype;
    const allocated = this.#globalAllocation?.prototypes.get(assembled.definition.name);
    const prototype = allocated ?? (this.#hasImmutableGlobalPrototype(assembled)
      ? this.#globalPlatformObjects.createPrototypeObject(parentPrototype)
      : this.realm.createOrdinaryObject(parentPrototype));
    if (Reflect.getPrototypeOf(prototype) !== parentPrototype) {
      throw new Error(`Allocated ${assembled.definition.name} prototype has the wrong parent`);
    }
    initial.interfacePrototypeObject = prototype;

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

    if (!hasExtendedAttribute(
      assembled.definition.extendedAttributes,
      'LegacyNoInterfaceObject',
    )) {
      defineProperty(prototype, 'constructor', {
        configurable: true,
        enumerable: false,
        value: this.getInterfaceObject(assembled),
        writable: true,
      });
    }
    defineProperty(prototype, Symbol.toStringTag, {
      configurable: true,
      enumerable: false,
      value: getQualifiedName(assembled.definition),
      writable: false,
    });
    return prototype;
  }

  createPlatformObject(
    interface_: string | AssembledInterface,
    newTarget?: object,
  ): object {
    const assembled = this.#resolveInterface(interface_);
    if (!this.isExposed(assembled)) {
      throw new Error(
        `Interface ${assembled.definition.name} is not exposed in this realm`,
      );
    }
    if (isGlobalInterface(assembled)) {
      throw new Error(
        `Global interface ${assembled.definition.name} requires global exotic object machinery`,
      );
    }

    const prototype = this.#getPlatformObjectPrototype(assembled, newTarget);

    const createImplementation = this.implementations
      .getImplementationCreationSteps(
        assembled.definition,
      );
    const implementationClass = this.implementations
      .getImplementationForInterface(assembled.definition);
    if (implementationClass) {
      if (!createImplementation) {
        throw new Error(
          `Interface ${assembled.definition.name} has no implementation creation steps`,
        );
      }
      return this.projectPlatformObject(
        createImplementation(),
        assembled,
        prototype,
      ).platformObject;
    }

    const implementation = createImplementation
      ? createImplementation()
      : this.realm.createOrdinaryObject(prototype);
    if (Reflect.getPrototypeOf(implementation) !== prototype) {
      throw new Error(
        `Implementation object for ${assembled.definition.name} has the wrong prototype`,
      );
    }
    this.#runImplementationInitializationSteps(implementation, assembled);
    return this.associatePlatformObject(
      this.#legacyPlatformObjects.createObject(
        implementation,
        implementation,
        assembled,
      ),
      assembled,
      implementation,
    ).platformObject;
  }

  #constructPlatformObject(
    interface_: AssembledInterface,
    behavior: ConstructorBehavior,
    values: readonly unknown[],
    newTarget: object,
  ): object {
    if (behavior.kind === 'initialize') {
      const platformObject = this.createPlatformObject(interface_, newTarget);
      const implementation = this.platformObjects.getImplementationObject(
        platformObject,
      );
      if (!implementation) {
        throw new Error('New platform object has no implementation target');
      }
      Reflect.apply(behavior.steps, implementation, values);
      return platformObject;
    }

    const prototype = this.#getPlatformObjectPrototype(interface_, newTarget);
    const implementation = behavior.steps(values);
    return this.projectPlatformObject(
      implementation,
      interface_,
      prototype,
    ).platformObject;
  }

  #getPlatformObjectPrototype(
    interface_: AssembledInterface,
    newTarget?: object,
  ): object {
    if (!newTarget) return this.getInterfacePrototypeObject(interface_);

    const candidate: unknown = this.realm.intrinsics.reflectGet(newTarget, 'prototype');
    if (isObject(candidate)) return candidate;

    // Web IDL's interface-object fallback uses newTarget's function realm,
    // after reading prototype. The platform object still belongs to this realm.
    try {
      const realm = this.realm.runtime.getAssociatedRealm(newTarget);
      const binding = realm === this.realm ? this :
        realm && this.platformObjects.getRealmBinding(realm);
      if (!binding) {
        return this.#throwTypeError('newTarget realm has no registered Web IDL binding');
      }
      return binding.getInterfacePrototypeObject(interface_.definition.name);
    } catch (error) {
      throw this.realizeException(error);
    }
  }

  isExposed(interface_: string | AssembledInterface): boolean {
    return this.#isConstructExposed(
      this.#resolveInterface(interface_).definition,
    );
  }

  projectPlatformObject(
    implementation: object,
    primaryInterface: AssembledInterface,
    prototype = this.getInterfacePrototypeObject(primaryInterface),
  ): PlatformObjectRecord {
    if (isGlobalInterface(primaryInterface)) {
      throw new Error(
        `Use projectGlobalObject for ${primaryInterface.definition.name}`,
      );
    }
    this.#runImplementationInitializationSteps(
      implementation,
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
        implementation,
        primaryInterface,
      ),
      primaryInterface,
      implementation,
    );
  }

  projectGlobalObject(
    implementation: object,
    primaryInterface: string | AssembledInterface,
    allocation?: GlobalObjectAllocation,
  ): PlatformObjectRecord {
    const interface_ = this.#resolveInterface(primaryInterface);
    if (!isGlobalInterface(interface_)) {
      throw new Error(`${interface_.definition.name} is not a global interface`);
    }
    if (!this.isExposed(interface_)) {
      throw new Error(
        `Interface ${interface_.definition.name} is not exposed in this realm`,
      );
    }
    if (this.#globalObject) {
      throw new Error('This binding already has a projected global object');
    }
    if (this.#legacyPlatformObjects.supportsIndexedProperties(interface_)) {
      throw new Error('Global interfaces cannot use indexed properties');
    }
    this.#assertOrdinaryProjection(interface_);
    this.#globalAllocation = allocation;
    if (allocation) {
      for (const name of allocation.prototypes.keys()) {
        const definition = this.#resolveInterface(name).definition;
        if (this.#getInitialObjects(definition).interfacePrototypeObject) {
          throw new Error(`Prototype ${name} was already created before global allocation`);
        }
      }
    }
    const prototype = this.getInterfacePrototypeObject(interface_);
    if (allocation) {
      if (Reflect.getPrototypeOf(allocation.object) !== prototype) {
        throw new Error('Allocated global object has the wrong prototype');
      }
    } else if (!Reflect.setPrototypeOf(implementation, prototype)) {
      throw new Error('Could not set the global object prototype');
    }
    this.#runImplementationInitializationSteps(implementation, interface_);
    const object = allocation?.object ??
      this.#globalPlatformObjects.createObject(implementation);
    const record = this.associatePlatformObject(
      object,
      interface_,
      implementation,
    );
    this.#globalObject = record;

    this.#defineOperations(object, interface_, 'regular');
    this.#defineAttributes(object, interface_, 'regular');
    this.#defineStringifier(object, interface_, 'regular');
    this.#defineIterationMethods(object, interface_);
    this.#defineAsyncIterationMethods(object, interface_);
    this.#defineCollectionMembers(object, interface_);
    this.#defineGlobalPropertyReferences(object);
    return record;
  }

  changePlatformObjectRealm(object: object): void {
    const record = this.platformObjects.getRecord(object);
    if (!record) throw new TypeError('Value is not a platform object');

    const primaryInterface = this.#resolveInterface(
      record.primaryInterface.definition.name,
    );
    if (primaryInterface.definition !== record.primaryInterface.definition) {
      throw new TypeError(
        'Target realm does not contain the platform object interface',
      );
    }

    const prototype = this.getInterfacePrototypeObject(primaryInterface);
    if (
      Reflect.getPrototypeOf(record.platformObject) !== prototype &&
      !Reflect.setPrototypeOf(record.platformObject, prototype)
    ) {
      throw new TypeError('Could not change the public platform object prototype');
    }
    this.platformObjects.changeRealm(object, this.realm);
  }

  associatePlatformObject(
    object: object,
    primaryInterface: AssembledInterface,
    implementation: object = object,
  ): PlatformObjectRecord {
    const record = this.platformObjects.associate(
      object,
      implementation,
      primaryInterface,
      this.realm,
    );
    this.#collections.initialize(implementation, primaryInterface);
    for (const ancestor of getInheritance(primaryInterface)) {
      Object.defineProperties(
        object,
        Object.getOwnPropertyDescriptors(
          this.#getUnforgeableObject(ancestor),
        ),
      );
    }
    return record;
  }

  #runImplementationInitializationSteps(
    implementation: object,
    interface_: AssembledInterface,
  ): void {
    for (const ancestor of getInheritance(interface_)) {
      this.implementations.getImplementationInitializationSteps(
        ancestor.definition,
      )?.(implementation);
    }
  }

  getPlatformObjectRecord(value: unknown): PlatformObjectRecord | undefined {
    return this.platformObjects.getRecord(value);
  }

  getMapEntries(object: object): IDLMapEntries {
    return this.#collections.getMapEntries(
      this.platformObjects.getImplementationObject(object) ?? object,
    );
  }

  getSetEntries(object: object): IDLSetEntries {
    return this.#collections.getSetEntries(
      this.platformObjects.getImplementationObject(object) ?? object,
    );
  }

  getObservableArrayBackingList(
    object: object,
    attribute: AttributeMember,
  ): unknown[] {
    const record = this.platformObjects.getRecord(object);
    const elementType = getObservableArrayElementType(
      attribute.type,
      this.definitions,
    );
    if (
      !record ||
      !elementType ||
      !interfaceIncludesMember(record.primaryInterface, attribute)
    ) {
      throw new Error('Observable array attribute does not belong to object');
    }
    return this.#observableArrays.getBackingList(
      record.implementation,
      attribute,
      elementType,
    );
  }

  isPlatformObject(value: unknown): boolean {
    return this.platformObjects.isPlatformObject(value);
  }

  implements(
    value: unknown,
    interface_: string | AssembledInterface,
  ): boolean {
    return this.platformObjects.implements(
      value,
      this.#resolveInterface(interface_),
    );
  }

  #defineConstants(target: object, definition: MemberDefinition): void {
    for (const entry of definition.members) {
      if (
        entry.member.kind !== 'constant' ||
        !this.#isMemberExposed(definition, entry)
      ) continue;

      this.#defineConstant(target, entry.member);
    }
  }

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

  #defineStringifier(
    target: object,
    interface_: AssembledInterface,
    placement: Extract<MemberPlacement, 'regular' | 'unforgeable'>,
  ): void {
    const entry = this.#getStringifierEntry(interface_);
    if (!entry) return;
    const unforgeable = hasExtendedAttribute(
      entry.member.extendedAttributes,
      'LegacyUnforgeable',
    );
    if ((placement === 'unforgeable') !== unforgeable) return;

    defineProperty(target, 'toString', {
      configurable: !unforgeable,
      enumerable: true,
      value: this.#getStringifierFunction(interface_, entry.member),
      writable: !unforgeable,
    });
  }

  #getStringifierEntry(
    interface_: AssembledInterface,
  ): StringifierEntry | undefined {
    return interface_.members.find(
      (entry): entry is StringifierEntry => {
        const member = entry.member;
        const stringifier = member.kind === 'stringifier' ||
          (member.kind === 'attribute' && member.stringifier === true);
        return stringifier && this.#isMemberExposed(interface_, entry);
      },
    );
  }

  #getStringifierFunction(
    interface_: AssembledInterface,
    stringifier: StringifierMember | AttributeMember,
  ): JSFunction {
    return this.#getOrCreateMemberInitialObject(
      'stringifier',
      interface_.definition,
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
            interface_,
            identifier,
            'method',
            false,
          );
          if (receiver === invalidReceiver) {
            throw new Error('Stringifier receiver unexpectedly became lenient');
          }
          const object = receiver.implementation;

          let value: unknown;
          if (stringifier.kind === 'attribute') {
            const implementation = stringifier.inherit
              ? this.#findInheritedAttribute(interface_, stringifier)
              : stringifier;
            const steps = this.implementations.getAttributeSteps(
              implementation,
              interface_,
            );
            if (!steps) {
              throw missingImplementation(
                interface_,
                `stringifier attribute ${stringifier.name}`,
              );
            }
            // eslint-disable-next-line @typescript-eslint/unbound-method -- getter steps use the platform object as their specified this value
            value = Reflect.apply(steps.get, object, []);
          } else {
            const behavior = this.implementations
              .getStringificationBehavior(stringifier, interface_);
            if (!behavior) {
              throw missingImplementation(interface_, 'stringifier');
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

  #defineIterationMethods(
    target: object,
    interface_: AssembledInterface,
  ): void {
    const entry = interface_.members.find(({ member }) =>
      member.kind === 'iterable');
    if (this.#legacyPlatformObjects.supportsIndexedProperties(interface_)) {
      this.#iterables.defineIndexedMethods(
        target,
        entry?.member.kind === 'iterable' &&
        entry.member.key === undefined &&
        this.#isMemberExposed(interface_, entry),
      );
      return;
    }
    if (
      !entry ||
      entry.member.kind !== 'iterable' ||
      !this.#isMemberExposed(interface_, entry)
    ) return;

    this.#iterables.defineMethods(
      target,
      interface_,
      entry.member,
    );
  }

  #defineAsyncIterationMethods(
    target: object,
    interface_: AssembledInterface,
  ): void {
    const entry = interface_.members.find(({ member }) =>
      member.kind === 'async-iterable');
    if (
      !entry ||
      entry.member.kind !== 'async-iterable' ||
      !this.#isMemberExposed(interface_, entry)
    ) return;

    this.#asyncIterables.defineMethods(
      target,
      interface_,
      entry.member,
    );
  }

  #defineCollectionMembers(
    target: object,
    interface_: AssembledInterface,
  ): void {
    const declaration = interface_.members.find(({ member }) =>
      member.kind === 'maplike' || member.kind === 'setlike')?.member;
    if (declaration?.kind === 'maplike') {
      this.#collections.defineMaplike(target, interface_, declaration);
    } else if (declaration?.kind === 'setlike') {
      this.#collections.defineSetlike(target, interface_, declaration);
    }
  }

  #initializeMemberObjects(interface_: AssembledInterface): void {
    const operationGroups = new Map<string, OperationMember[]>();
    for (const entry of interface_.members) {
      if (!this.#isMemberExposed(interface_, entry)) continue;
      const { member } = entry;
      if (member.kind === 'attribute') {
        this.#getAttributeGetter(interface_, member);
        this.#getAttributeSetter(interface_, member);
      } else if (member.kind === 'operation' && member.name) {
        const key = `${member.static === true ? 'static' : 'regular'}:${member.name}`;
        const group = operationGroups.get(key);
        if (group) group.push(member);
        else operationGroups.set(key, [member]);
      } else if (member.kind === 'iterable') {
        this.#iterables.initializePrototype(interface_, member);
      } else if (member.kind === 'async-iterable') {
        this.#asyncIterables.initializePrototype(interface_, member);
      }
    }
    for (const operations of operationGroups.values()) {
      const name = operations[0]?.name;
      if (name) this.#getOperationFunction(interface_, name, operations);
    }
    const stringifier = this.#getStringifierEntry(interface_)?.member;
    if (
      stringifier?.kind === 'stringifier' ||
      stringifier?.kind === 'attribute'
    ) this.#getStringifierFunction(interface_, stringifier);
  }

  #getAttributeGetter(
    definition: MemberDefinition,
    attribute: AttributeMember,
  ): JSFunction {
    return this.#getOrCreateMemberInitialObject(
      'getter',
      definition.definition,
      attribute,
      () => this.realm.createFunction((thisArgument) => {
        let receiverRealm: WebIDLRealmHost | undefined;
        try {
          const interface_ = getMemberInterface(definition);
          const receiver = interface_ && !attribute.static
            ? this.#implementationRecord(
              thisArgument,
              interface_,
              attribute.name,
              'getter',
              hasExtendedAttribute(
                attribute.extendedAttributes,
                'LegacyLenientThis',
              ),
            )
            : null;
          if (receiver === invalidReceiver) return undefined;
          const object = receiver?.implementation ?? null;
          receiverRealm = receiver?.realm;

          const elementType = getObservableArrayElementType(
            attribute.type,
            this.definitions,
          );
          if (elementType) {
            if (!object) {
              throw new Error('Observable array attribute was not regular');
            }
            return this.#observableArrays.get(
              object,
              attribute,
              elementType,
            );
          }

          const implementation = interface_ && attribute.inherit
            ? this.#findInheritedAttribute(interface_, attribute)
            : attribute;
          const steps = this.implementations.getAttributeSteps(
            implementation,
            interface_,
          );
          if (!steps) {
            throw missingImplementation(
              definition,
              `attribute ${attribute.name}`,
            );
          }
          // eslint-disable-next-line @typescript-eslint/unbound-method -- getter steps use the platform object as their specified this value
          const value = Reflect.apply(steps.get, object, []);
          return convertToJavaScript(
            value,
            attribute.type,
            this.#resultContext(receiverRealm),
          );
        } catch (exception) {
          return this.#handlePromiseException(
            attribute.type,
            exception,
            this.#resultContext(receiverRealm),
          );
        }
      }, { length: 0, name: `get ${attribute.name}` }),
    );
  }

  #getAttributeSetter(
    definition: MemberDefinition,
    attribute: AttributeMember,
  ): JSFunction | undefined {
    if (definition.definition.kind === 'namespace') return;
    const interface_ = getMemberInterface(definition);
    if (!interface_) throw new Error('Namespace attribute unexpectedly had a setter');
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

    return this.#getOrCreateMemberInitialObject(
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
            interface_,
            attribute.name,
            'setter',
            hasExtendedAttribute(
              attribute.extendedAttributes,
              'LegacyLenientThis',
            ),
          );
        const object = receiver === invalidReceiver
          ? invalidReceiver
          : receiver?.implementation ?? null;

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
        if (object === invalidReceiver || lenientSetter) return undefined;

        if (putForwards) {
          if (!object) throw new Error('PutForwards used on a static attribute');
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
          if (!object) {
            throw new Error('Observable array attribute was not regular');
          }
          this.#observableArrays.replace(
            object,
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
          interface_,
        );
        if (!steps?.set) {
          throw missingImplementation(
            definition,
            `attribute setter ${attribute.name}`,
          );
        }
        // eslint-disable-next-line @typescript-eslint/unbound-method -- setter steps use the platform object as their specified this value
        Reflect.apply(steps.set, object, [idlValue]);
        return undefined;
      }, { length: 1, name: `set ${attribute.name}` }),
    );
  }

  #getOperationFunction(
    definition: MemberDefinition,
    name: string,
    operations: OperationMember[],
  ): JSFunction {
    const source = operations[0];
    if (!source) throw new Error(`Operation group ${name} is empty`);
    return this.#getOrCreateMemberInitialObject(
      'operation',
      definition.definition,
      source,
      () => this.realm.createFunction((thisArgument, argumentsList) => {
        let receiverRealm: WebIDLRealmHost | undefined;
        try {
          const interface_ = getMemberInterface(definition);
          const receiver = interface_ && !operations[0]?.static
            ? this.#implementationRecord(
              thisArgument,
              interface_,
              name,
              'method',
              false,
            )
            : null;
          if (receiver === invalidReceiver) {
            throw new Error('Operation receiver unexpectedly became lenient');
          }
          const object = receiver?.implementation ?? null;
          receiverRealm = receiver?.realm;
          const resultContext = this.#resultContext(receiverRealm);

          const overload = resolveOverload(
            computeEffectiveOverloadSet(operations, argumentsList.length),
            argumentsList,
            this,
          );
          const steps = this.implementations.getOperationSteps(
            overload.callable,
            interface_,
          );
          if (hasExtendedAttribute(
            overload.callable.extendedAttributes,
            'Default',
          )) {
            if (!object || !interface_) {
              throw new Error('Default operation used as a static operation');
            }
            return convertToJavaScript(
              this.#runDefaultOperation(interface_, object),
              overload.callable.returns,
              this,
            );
          }
          if (!steps) {
            throw missingImplementation(definition, `operation ${name}`);
          }
          const result = Reflect.apply(steps, object, overload.values);
          if (overload.callable.binding && 'newBufferResult' in overload.callable.binding) {
            const type = getUnannotatedType(overload.callable.returns, this.definitions);
            if (type.kind === 'promise') {
              return convertToJavaScript(
                projectPromise(result, type.type, resultContext, true),
                type,
                resultContext,
              );
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
            this.#resultContext(receiverRealm),
          );
        }
      }, { length: getCallableLength(operations), name }),
    );
  }

  #handlePromiseException(
    type: WebIDLType,
    exception: unknown,
    context: ConversionContext,
  ): unknown {
    const promiseType = getUnannotatedType(type, this.definitions);
    if (promiseType.kind !== 'promise') throw exception;
    return convertToJavaScript(
      createRejectedPromise(exception, promiseType.type, context),
      type,
      context,
    );
  }

  #runDefaultOperation(
    interface_: AssembledInterface,
    object: object,
  ): object {
    const result = this.realm.createOrdinaryObject(
      this.realm.intrinsics.objectPrototype,
    );

    for (const ancestor of getInheritance(interface_)) {
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
        // eslint-disable-next-line @typescript-eslint/unbound-method -- getter steps use the platform object as their specified this value
        const idlValue = Reflect.apply(steps.get, object, []);
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
          let interface_ = this.definitions.getInterface(unannotated.name);
          while (interface_) {
            if (interface_.members.some(({ member }) =>
              member.kind === 'operation' &&
              member.name === 'toJSON')) return true;
            interface_ = interface_.parent;
          }
        }
        return false;
      }
      default:
        return false;
    }
  }

  #assertOrdinaryProjection(interface_: AssembledInterface): void {
    for (const { member } of interface_.members) {
      if (member.kind === 'operation' && member.special) {
        if (this.#legacyPlatformObjects.supportsSpecialOperation(member)) {
          continue;
        }
        throw new Error(
          `${interface_.definition.name} requires deferred legacy platform object machinery`,
        );
      }
    }
  }

  #getUnforgeableObject(interface_: AssembledInterface): object {
    const initial = this.#getInitialObjects(interface_.definition);
    if (initial.unforgeablesObject) return initial.unforgeablesObject;

    const object = this.realm.createOrdinaryObject(null);
    initial.unforgeablesObject = object;
    this.#defineAttributes(object, interface_, 'unforgeable');
    this.#defineOperations(object, interface_, 'unforgeable');
    this.#defineStringifier(object, interface_, 'unforgeable');
    return object;
  }

  #getNamedPropertiesObject(interface_: AssembledInterface): object {
    const initial = this.#getInitialObjects(interface_.definition);
    if (initial.namedPropertiesObject) return initial.namedPropertiesObject;

    const parent = interface_.parent
      ? this.getInterfacePrototypeObject(interface_.parent)
      : this.realm.intrinsics.objectPrototype;
    const object = this.#globalPlatformObjects.createNamedPropertiesObject(
      interface_,
      parent,
      () => this.#globalObject?.platformObject,
      this.#globalAllocation?.namedProperties,
    );
    initial.namedPropertiesObject = object;
    return object;
  }

  #hasImmutableGlobalPrototype(interface_: AssembledInterface): boolean {
    if (this.realm.isGlobalPrototypeChainMutable) return false;
    for (const candidate of this.definitions.getInterfaces()) {
      if (!isGlobalInterface(candidate)) continue;
      let current: AssembledInterface | undefined = candidate;
      while (current) {
        if (current === interface_) return true;
        current = current.parent;
      }
    }
    return false;
  }

  #defineGlobalPropertyReferences(
    target: object,
  ): void {
    const window = this.definitions.getInterface('Window');
    const record = this.platformObjects.getRecord(target);
    const isWindow = Boolean(
      window &&
      record &&
      this.platformObjects.recordImplements(record, window),
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

  #defineUnscopables(target: object, interface_: AssembledInterface): void {
    const names = new Set<string>();
    for (const entry of interface_.members) {
      const { member } = entry;
      if (
        (member.kind !== 'attribute' && member.kind !== 'operation') ||
        member.static || !member.name ||
        !hasExtendedAttribute(member.extendedAttributes, 'Unscopable') ||
        !this.#isMemberExposed(interface_, entry)
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

  #implementationRecord(
    thisArgument: unknown,
    interface_: AssembledInterface,
    identifier: string,
    type: 'getter' | 'method' | 'setter',
    lenient: boolean,
  ): PlatformObjectRecord | typeof invalidReceiver {
    const value = this.#resolveThisValue(thisArgument);
    const record = this.#resolveReceiverRecord(value);
    if (record) {
      this.realm.performSecurityCheck(record.platformObject, identifier, type);
    }
    if (!record || !this.platformObjects.recordImplements(record, interface_)) {
      if (lenient) return invalidReceiver;
      return this.#throwTypeError('Illegal invocation');
    }
    return record;
  }

  #resultContext(realm: WebIDLRealmHost | undefined): ConversionContext {
    if (!realm || realm === this.realm) return this;
    const receiverContext = this.platformObjects.getBindingContext(realm);
    return {
      definitions: this.definitions,
      hostDefinedInterfaces: this.hostDefinedInterfaces,
      platformObjects: this.platformObjects,
      projectImplementationObject: (value, interface_) =>
        this.#projectInRealm(value, interface_, realm),
      realizeException: receiverContext
        ? (value) => receiverContext.realizeException(value)
        : this.realizeException,
      realm,
    };
  }

  #resolveReceiverRecord(
    value: unknown,
  ): PlatformObjectRecord | undefined {
    const direct = this.platformObjects.getRecord(value);
    if (direct) return direct;

    for (const interface_ of this.hostDefinedInterfaces.values()) {
      if (!interface_.is(value)) continue;
      const platformObject = interface_.resolveReceiver?.(value);
      const record = this.platformObjects.getRecord(platformObject);
      if (record) return record;
    }
    return undefined;
  }

  #resolveThisValue(thisArgument: unknown): unknown {
    return thisArgument ?? this.#globalObject?.platformObject ?? this.realm.global;
  }

  #findInheritedAttribute(
    interface_: AssembledInterface,
    attribute: AttributeMember,
  ): AttributeMember {
    let parent = interface_.parent;
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
      `Inherited attribute ${interface_.definition.name}.${attribute.name} has no ancestor declaration`,
    );
  }

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

  #getConstructors(interface_: AssembledInterface): ConstructorMember[] {
    return interface_.members
      .filter((entry) =>
        entry.member.kind === 'constructor' &&
        this.#isMemberExposed(interface_, entry))
      .map((entry) => entry.member as ConstructorMember);
  }

  #isMemberExposed(
    definition: MemberDefinition,
    entry: MemberEntry,
  ): boolean {
    return this.#isConstructExposed(definition.definition) &&
      this.#isConstructExposed(entry.source) &&
      this.#isConstructExposed(entry.member);
  }

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

  #getInitialObjects(definition: object): DefinitionInitialObjects {
    let initial = this.#initialObjects.get(definition);
    if (!initial) {
      initial = {};
      this.#initialObjects.set(definition, initial);
    }
    return initial;
  }

  #getOrCreateMemberInitialObject(
    kind: keyof MemberInitialObjects,
    definition: object,
    member: object,
    create: () => JSFunction,
  ): JSFunction {
    const initial = this.#getInitialObjects(definition);
    const members = initial.members ??= new WeakMap();
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

  #resolveInterface(
    interface_: string | AssembledInterface,
  ): AssembledInterface {
    if (typeof interface_ !== 'string') return interface_;
    const assembled = this.definitions.getInterface(interface_);
    if (!assembled) throw new Error(`Unknown Web IDL interface ${interface_}`);
    return assembled;
  }

  #resolveNamespace(
    namespace: string | AssembledNamespace,
  ): AssembledNamespace {
    if (typeof namespace !== 'string') return namespace;
    const assembled = this.definitions.getNamespace(namespace);
    if (!assembled) throw new Error(`Unknown Web IDL namespace ${namespace}`);
    return assembled;
  }

  #throwTypeError(message: string): never {
    throw new this.realm.intrinsics.typeError(message);
  }
}

type JSFunction = ReturnType<WebIDLRealmHost['createFunction']>;
type InterfaceObject = JSFunction & { prototype: object; };
type MemberDefinition = AssembledInterface | AssembledNamespace;
type MemberEntry = AssembledInterfaceMember | AssembledNamespaceMember;
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
  members?: WeakMap<object, MemberInitialObjects>;
  namedPropertiesObject?: object;
  namespaceObject?: object;
  unforgeablesObject?: object;
};
type MemberInitialObjects = Partial<Record<
  'functionResult' | 'getter' | 'operation' | 'setter' | 'stringifier',
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

function getLegacyFactoryFunctionDeclarations(
  interface_: AssembledInterface,
  id: string,
): NamedArgumentsExtendedAttribute[] {
  const declarations: NamedArgumentsExtendedAttribute[] = [];
  for (const definition of [interface_.definition, ...interface_.partials]) {
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

function getLegacyFactoryFunctionIdentifiers(
  interface_: AssembledInterface,
): string[] {
  const identifiers = new Set<string>();
  for (const definition of [interface_.definition, ...interface_.partials]) {
    for (const attribute of definition.extendedAttributes ?? []) {
      if (
        attribute.kind === 'named-arguments' &&
        attribute.name === 'LegacyFactoryFunction'
      ) identifiers.add(attribute.value);
    }
  }
  return [...identifiers];
}

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

function getInheritance(interface_: AssembledInterface): AssembledInterface[] {
  const inheritance: AssembledInterface[] = [];
  let current: AssembledInterface | undefined = interface_;
  while (current) {
    inheritance.unshift(current);
    current = current.parent;
  }
  return inheritance;
}

function interfaceIncludesMember(
  interface_: AssembledInterface,
  member: AttributeMember,
): boolean {
  let current: AssembledInterface | undefined = interface_;
  while (current) {
    if (current.members.some((entry) => entry.member === member)) return true;
    current = current.parent;
  }
  return false;
}

function getObservableArrayElementType(
  type: WebIDLType,
  definitions: DefinitionAssembly,
): WebIDLType | undefined {
  const resolved = getUnannotatedType(type, definitions);
  return resolved.kind === 'observable-array'
    ? resolved.type
    : undefined;
}

function getMemberInterface(
  definition: MemberDefinition,
): AssembledInterface | undefined {
  return 'parent' in definition
    ? definition
    : undefined;
}

function isGlobalInterface(interface_: AssembledInterface): boolean {
  return [interface_.definition, ...interface_.partials].some(
    (definition) => hasExtendedAttribute(
      definition.extendedAttributes,
      'Global',
    ),
  );
}

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

function getQualifiedName(
  interface_: { extendedAttributes?: ExtendedAttribute[]; name: string; },
): string {
  const namespace = getIdentifierAttribute(interface_, 'LegacyNamespace');
  return namespace
    ? `${namespace}.${interface_.name}`
    : interface_.name;
}

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

function orderInterfacesByInheritance(
  interfaces: AssembledInterface[],
): AssembledInterface[] {
  const remaining = new Set(interfaces);
  const ordered: AssembledInterface[] = [];
  while (remaining.size > 0) {
    const interface_ = interfaces.find((candidate) =>
      remaining.has(candidate) &&
      (!candidate.parent || !remaining.has(candidate.parent)));
    if (!interface_) throw new Error('Interface inheritance contains a cycle');
    remaining.delete(interface_);
    ordered.push(interface_);
  }
  return ordered;
}

function defineProperty(
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor,
): void {
  if (!Reflect.defineProperty(target, key, descriptor)) {
    throw new Error(`Could not define Web IDL property ${String(key)}`);
  }
}

function missingImplementation(
  definition: MemberDefinition,
  member: string,
): Error {
  return new Error(
    `Web IDL ${definition.definition.name} ${member} has no implementation steps`,
  );
}
