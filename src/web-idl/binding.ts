import type {
  AssembledInterface, AssembledInterfaceMember, AssembledNamespace,
  AssembledNamespaceMember, DefinitionAssembly,
} from './assembly';
import { AsynchronousIterableBinding } from './async-iterable';
import {
  CollectionBinding, type IDLMapEntries, type IDLSetEntries,
} from './collection';
import {
  convertToIDL, convertToJavaScript, materializeDefaultValue,
} from './conversion';
import type {
  AttributeMember, CallbackInterfaceDefinition, ConstantMember,
  ConstructorMember, ExtendedAttribute, NamedArgumentsExtendedAttribute,
  OperationMember, StringifierMember, WebIDLType,
} from './definition';
import { GlobalPlatformObjectBinding } from './global-platform-object';
import { ImplementationRegistry } from './implementation';
import { SynchronousIterableBinding } from './iterable';
import type { WebIDLRealmHost } from './javascript-realm';
import { LegacyPlatformObjectBinding } from './legacy-platform-object';
import {
  computeEffectiveOverloadSet, type IDLCallable, resolveOverload,
} from './overload';
import { ObservableArrayBinding } from './observable-array';
import type {
  PlatformObjectRecord, PlatformObjectRegistry,
} from './platform-object';
import { createRejectedPromise } from './promise';
import { getUnannotatedType } from './types';

export class JavaScriptBinding {
  readonly definitions: DefinitionAssembly;
  readonly implementations: ImplementationRegistry;
  readonly platformObjects: PlatformObjectRegistry;
  readonly realm: WebIDLRealmHost;
  readonly #collections: CollectionBinding;
  readonly #asyncIterables: AsynchronousIterableBinding;
  readonly #initialObjects = new WeakMap<object, DefinitionInitialObjects>();
  readonly #globalPlatformObjects: GlobalPlatformObjectBinding;
  #globalObject: PlatformObjectRecord | undefined;
  readonly #iterables: SynchronousIterableBinding;
  readonly #legacyPlatformObjects: LegacyPlatformObjectBinding;
  readonly #observableArrays: ObservableArrayBinding;

  constructor(
    definitions: DefinitionAssembly,
    realm: WebIDLRealmHost,
    platformObjects: PlatformObjectRegistry,
    implementations = new ImplementationRegistry(),
  ) {
    this.definitions = definitions;
    this.implementations = implementations;
    this.realm = realm;
    this.platformObjects = platformObjects;
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
    target: object = this.#globalObject?.object ?? this.realm.global,
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

  getExposedInitialObjects(): Map<string, object> {
    const installed = new Map<string, object>();
    const interfaces = orderInterfacesByInheritance(
      this.definitions.getInterfaces()
        .filter((interface_) => this.isExposed(interface_)),
    );
    for (const interface_ of interfaces) {
      this.getInterfacePrototypeObject(interface_);
      this.#initializeMemberObjects(interface_);
      if (
        !hasExtendedAttribute(
          interface_.definition,
          'LegacyNoInterfaceObject',
        ) &&
        getIdentifierAttribute(
          interface_.definition,
          'LegacyNamespace',
        ) === undefined
      ) {
        installed.set(
          interface_.definition.name,
          this.getInterfaceObject(interface_),
        );
      }
      for (const id of getLegacyFactoryFunctionIdentifiers(
        interface_.definition,
      )) {
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

  getExposedGlobalProperties(
    isWindow = this.realm.exposure === 'Window',
  ): Map<string, object> {
    const exposed = this.getExposedInitialObjects();
    const ordered = new Map<string, object>();
    const interfaces = orderInterfacesByInheritance(
      this.definitions.getInterfaces()
        .filter((interface_) => this.isExposed(interface_)),
    );
    const handledNames = new Set<string>();

    for (const interface_ of interfaces) {
      const definition = interface_.definition;
      if (
        !hasExtendedAttribute(definition, 'LegacyNoInterfaceObject') &&
        getIdentifierAttribute(definition, 'LegacyNamespace') === undefined
      ) {
        const object = this.getInterfaceObject(interface_);
        handledNames.add(definition.name);
        ordered.set(definition.name, object);
        if (isWindow) {
          for (const alias of getIdentifierListAttribute(
            definition,
            'LegacyWindowAlias',
          )) {
            handledNames.add(alias);
            ordered.set(alias, object);
          }
        }
      }
      for (const id of getLegacyFactoryFunctionIdentifiers(definition)) {
        handledNames.add(id);
        ordered.set(id, this.getLegacyFactoryFunction(interface_, id));
      }
    }
    for (const [name, object] of exposed) {
      if (!handledNames.has(name)) ordered.set(name, object);
    }
    return ordered;
  }

  getExposedInterfaceObjects(): Map<string, object> {
    const installed = new Map<string, object>();

    for (const interface_ of this.definitions.getInterfaces()) {
      if (
        !this.isExposed(interface_) ||
        hasExtendedAttribute(interface_.definition, 'LegacyNoInterfaceObject') ||
        getIdentifierAttribute(
          interface_.definition,
          'LegacyNamespace',
        ) !== undefined
      ) continue;

      const object = this.getInterfaceObject(interface_);
      installed.set(interface_.definition.name, object);
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
    const object = this.realm.createFunction(
      (_thisArgument, argumentsList, newTarget) => {
        if (!newTarget) {
          return this.#throwTypeError(
            `Failed to construct '${assembled.definition.name}': use the 'new' operator.`,
          );
        }
        if (constructors.length === 0) {
          return this.#throwTypeError('Illegal constructor');
        }

        const overload = resolveOverload(
          computeEffectiveOverloadSet(constructors, argumentsList.length),
          argumentsList,
          this,
        );
        const platformObject = this.createPlatformObject(
          assembled,
          newTarget,
        );
        const implementation = this.platformObjects.getImplementationObject(
          platformObject,
        );
        if (!implementation) {
          throw new Error('New platform object has no implementation target');
        }
        const steps = this.implementations.getConstructorSteps(
          overload.callable,
        );
        if (!steps) {
          throw missingImplementation(assembled, 'constructor');
        }
        Reflect.apply(steps, implementation, overload.values);
        return platformObject;
      },
      {
        constructible: true,
        length: getCallableLength(constructors),
        name: assembled.definition.name,
      },
    ) as InterfaceObject;

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
  ): JavaScriptFunction {
    const assembled = this.#resolveInterface(interface_);
    const declarations = getLegacyFactoryFunctionDeclarations(
      assembled.definition,
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
        const platformObject = this.createPlatformObject(
          assembled,
          newTarget,
        );
        const implementation = this.platformObjects
          .getImplementationObject(platformObject);
        if (!implementation) {
          throw new Error(
            'New platform object has no implementation target',
          );
        }
        const steps = this.implementations.getConstructorSteps(
          overload.callable,
        );
        if (!steps) {
          throw new Error(
            `Web IDL ${assembled.definition.name} legacy factory function ${id} has no implementation steps`,
          );
        }
        Reflect.apply(steps, implementation, overload.values);
        return platformObject;
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

  getNamespaceObject(
    namespace: string | AssembledNamespace,
  ): object {
    const assembled = this.#resolveNamespace(namespace);
    const initial = this.#getInitialObjects(assembled.definition);
    if (initial.namespaceObject) return initial.namespaceObject;

    const object = createRealmObject(
      this.realm,
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

    const global = hasExtendedAttribute(assembled.definition, 'Global');
    const parentPrototype = global &&
      this.#globalPlatformObjects.supportsNamedProperties(assembled)
      ? this.#getNamedPropertiesObject(assembled)
      : assembled.parent
        ? this.getInterfacePrototypeObject(assembled.parent)
        : assembled.definition.name === 'DOMException'
          ? this.realm.intrinsics.errorPrototype
          : this.realm.intrinsics.objectPrototype;
    const prototype = assembled.definition.name === 'DOMException'
      ? createRealmErrorObject(this.realm, parentPrototype)
      : this.#hasImmutableGlobalPrototype(assembled)
        ? this.#globalPlatformObjects.createPrototypeObject(parentPrototype)
        : createRealmObject(this.realm, parentPrototype);
    initial.interfacePrototypeObject = prototype;

    this.#defineUnscopables(prototype, assembled);
    if (!global) {
      this.#defineAttributes(prototype, assembled, 'regular');
      this.#defineOperations(prototype, assembled, 'regular');
      this.#defineStringifier(prototype, assembled, 'regular');
      this.#defineAsyncIterationMethods(prototype, assembled);
      this.#defineIterationMethods(prototype, assembled);
      this.#defineCollectionMembers(prototype, assembled);
    }
    this.#defineConstants(prototype, assembled);

    if (!hasExtendedAttribute(
      assembled.definition,
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
      value: assembled.definition.name,
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
    if (hasExtendedAttribute(assembled.definition, 'Global')) {
      throw new Error(
        `Global interface ${assembled.definition.name} requires global exotic object machinery`,
      );
    }

    let prototype = this.getInterfacePrototypeObject(assembled);
    if (newTarget) {
      const candidate = Reflect.get(newTarget, 'prototype') as unknown;
      if (!isObject(candidate)) {
        throw new Error(
          'A non-object newTarget prototype requires deferred GetFunctionRealm support',
        );
      }
      prototype = candidate;
    }

    const create = this.implementations.getObjectCreationSteps(
      assembled.definition,
    );
    const implementation = create
      ? create(newTarget ?? this.getInterfaceObject(assembled))
      : createRealmObject(this.realm, prototype);
    if (Reflect.getPrototypeOf(implementation) !== prototype) {
      throw new Error(
        `Implementation object for ${assembled.definition.name} has the wrong prototype`,
      );
    }
    return this.projectPlatformObject(
      implementation,
      assembled,
    ).object;
  }

  isExposed(interface_: string | AssembledInterface): boolean {
    return this.#isConstructExposed(
      this.#resolveInterface(interface_).definition,
    );
  }

  projectPlatformObject(
    implementation: object,
    primaryInterface: AssembledInterface,
  ): PlatformObjectRecord {
    if (hasExtendedAttribute(primaryInterface.definition, 'Global')) {
      throw new Error(
        `Use projectGlobalObject for ${primaryInterface.definition.name}`,
      );
    }
    return this.associatePlatformObject(
      this.#legacyPlatformObjects.createObject(
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
  ): PlatformObjectRecord {
    const interface_ = this.#resolveInterface(primaryInterface);
    if (!hasExtendedAttribute(interface_.definition, 'Global')) {
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

    const prototype = this.getInterfacePrototypeObject(interface_);
    if (!Reflect.setPrototypeOf(implementation, prototype)) {
      throw new Error('Could not set the global object prototype');
    }
    const object = this.#globalPlatformObjects.createObject(implementation);
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
    this.#defineConstants(object, interface_);
    this.#defineGlobalPropertyReferences(object);
    return record;
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

  implements(value: unknown, interface_: AssembledInterface): boolean {
    return this.platformObjects.implements(value, interface_);
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
      entry.member,
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
  ): JavaScriptFunction {
    return this.#getOrCreateMemberInitialObject(
      'stringifier',
      interface_.definition,
      stringifier,
      () => this.realm.createFunction(
        (thisArgument) => {
          const identifier = stringifier.kind === 'attribute'
            ? stringifier.name
            : 'toString';
          const object = this.#implementationObject(
            thisArgument,
            interface_,
            identifier,
            'method',
            false,
          );
          if (object === invalidReceiver) {
            throw new Error('Stringifier receiver unexpectedly became lenient');
          }

          let value: unknown;
          if (stringifier.kind === 'attribute') {
            const implementation = stringifier.inherit
              ? this.#findInheritedAttribute(interface_, stringifier)
              : stringifier;
            const steps = this.implementations.getAttributeSteps(
              implementation,
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
              .getStringificationBehavior(stringifier);
            if (!behavior) {
              throw missingImplementation(interface_, 'stringifier');
            }
            value = Reflect.apply(behavior, object, []);
          }
          return convertToIDL(
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
  ): JavaScriptFunction {
    return this.#getOrCreateMemberInitialObject(
      'getter',
      definition.definition,
      attribute,
      () => this.realm.createFunction((thisArgument) => {
        try {
          const interface_ = getMemberInterface(definition);
          const object = interface_ && !attribute.static
            ? this.#implementationObject(
              thisArgument,
              interface_,
              attribute.name,
              'getter',
              hasExtendedAttribute(attribute, 'LegacyLenientThis'),
            )
            : null;
          if (object === invalidReceiver) return undefined;

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
          const steps = this.implementations.getAttributeSteps(implementation);
          if (!steps) {
            throw missingImplementation(
              definition,
              `attribute ${attribute.name}`,
            );
          }
          // eslint-disable-next-line @typescript-eslint/unbound-method -- getter steps use the platform object as their specified this value
          const value = Reflect.apply(steps.get, object, []);
          return convertToJavaScript(value, attribute.type, this);
        } catch (exception) {
          return this.#handlePromiseException(attribute.type, exception);
        }
      }, { length: 0, name: `get ${attribute.name}` }),
    );
  }

  #getAttributeSetter(
    definition: MemberDefinition,
    attribute: AttributeMember,
  ): JavaScriptFunction | undefined {
    if (definition.definition.kind === 'namespace') return;
    const interface_ = getMemberInterface(definition);
    if (!interface_) throw new Error('Namespace attribute unexpectedly had a setter');
    const replaceable = hasExtendedAttribute(attribute, 'Replaceable');
    const putForwards = getIdentifierAttribute(attribute, 'PutForwards');
    const lenientSetter = hasExtendedAttribute(
      attribute,
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
        const object = attribute.static
          ? null
          : this.#implementationObject(
            thisArgument,
            interface_,
            attribute.name,
            'setter',
            hasExtendedAttribute(attribute, 'LegacyLenientThis'),
          );

        if (replaceable) {
          const receiver = thisArgument ?? this.realm.global;
          if (!isObject(receiver)) return this.#throwTypeError('Invalid receiver');
          defineProperty(receiver, attribute.name, {
            configurable: true,
            enumerable: true,
            value,
            writable: true,
          });
          return undefined;
        }
        if (object === invalidReceiver || lenientSetter) return undefined;

        if (putForwards) {
          if (!object) throw new Error('PutForwards used on a static attribute');
          const receiver = thisArgument ?? this.realm.global;
          if (!isObject(receiver)) {
            return this.#throwTypeError('Invalid receiver');
          }
          const forwarded = Reflect.get(receiver, attribute.name) as unknown;
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
        const steps = this.implementations.getAttributeSteps(attribute);
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
  ): JavaScriptFunction {
    const source = operations[0];
    if (!source) throw new Error(`Operation group ${name} is empty`);
    return this.#getOrCreateMemberInitialObject(
      'operation',
      definition.definition,
      source,
      () => this.realm.createFunction((thisArgument, argumentsList) => {
        try {
          const interface_ = getMemberInterface(definition);
          const object = interface_ && !operations[0]?.static
            ? this.#implementationObject(
              thisArgument,
              interface_,
              name,
              'method',
              false,
            )
            : null;
          if (object === invalidReceiver) {
            throw new Error('Operation receiver unexpectedly became lenient');
          }

          const overload = resolveOverload(
            computeEffectiveOverloadSet(operations, argumentsList.length),
            argumentsList,
            this,
          );
          const steps = this.implementations.getOperationSteps(
            overload.callable,
          );
          if (hasExtendedAttribute(overload.callable, 'Default')) {
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
          return convertToJavaScript(result, overload.callable.returns, this);
        } catch (exception) {
          const returnType = operations[0]?.returns;
          if (!returnType) throw exception;
          return this.#handlePromiseException(returnType, exception);
        }
      }, { length: getCallableLength(operations), name }),
    );
  }

  #handlePromiseException(type: WebIDLType, exception: unknown): unknown {
    const promiseType = getUnannotatedType(type, this.definitions);
    if (promiseType.kind !== 'promise') throw exception;
    return convertToJavaScript(
      createRejectedPromise(exception, promiseType.type, this),
      type,
      this,
    );
  }

  #runDefaultOperation(
    interface_: AssembledInterface,
    object: object,
  ): object {
    const result = createRealmObject(
      this.realm,
      this.realm.intrinsics.objectPrototype,
    );

    for (const ancestor of getInheritance(interface_)) {
      const hasDefaultToJSON = ancestor.members.some(({ member }) =>
        member.kind === 'operation' &&
        member.name === 'toJSON' &&
        hasExtendedAttribute(member, 'Default'));
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
        const steps = this.implementations.getAttributeSteps(implementation);
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

    const object = createRealmObject(this.realm, null);
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
      () => this.#globalObject?.object,
    );
    initial.namedPropertiesObject = object;
    return object;
  }

  #hasImmutableGlobalPrototype(interface_: AssembledInterface): boolean {
    if (this.realm.isGlobalPrototypeChainMutable) return false;
    for (const candidate of this.definitions.getInterfaces()) {
      if (!hasExtendedAttribute(candidate.definition, 'Global')) continue;
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
        !hasExtendedAttribute(member, 'Unscopable') ||
        !this.#isMemberExposed(interface_, entry)
      ) continue;
      names.add(member.name);
    }
    if (names.size === 0) return;

    const unscopables = createRealmObject(this.realm, null);
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

  #implementationObject(
    thisArgument: unknown,
    interface_: AssembledInterface,
    identifier: string,
    type: 'getter' | 'method' | 'setter',
    lenient: boolean,
  ): object | typeof invalidReceiver {
    const value = thisArgument ??
      this.#globalObject?.object ??
      this.realm.global;
    const record = this.platformObjects.getRecord(value);
    if (record) {
      this.realm.performSecurityCheck(value, identifier, type);
    }
    if (!record || !this.platformObjects.recordImplements(record, interface_)) {
      if (lenient) return invalidReceiver;
      return this.#throwTypeError('Illegal invocation');
    }
    return record.implementation;
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
    if (
      construct.exposed !== undefined &&
      construct.exposed !== '*' &&
      !construct.exposed.includes(this.realm.exposure)
    ) return false;
    if (
      hasExtendedAttribute(construct, 'CrossOriginIsolated') &&
      !this.realm.crossOriginIsolated
    ) return false;
    if (
      hasExtendedAttribute(construct, 'SecureContext') &&
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
    create: () => JavaScriptFunction,
  ): JavaScriptFunction {
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

type JavaScriptFunction = ReturnType<WebIDLRealmHost['createFunction']>;
type InterfaceObject = JavaScriptFunction & { prototype: object; };
type MemberDefinition = AssembledInterface | AssembledNamespace;
type MemberEntry = AssembledInterfaceMember | AssembledNamespaceMember;
type MemberPlacement = 'regular' | 'static' | 'unforgeable';
type DefinitionInitialObjects = {
  asyncIteratorPrototype?: object;
  interfaceObject?: InterfaceObject;
  interfacePrototypeObject?: object;
  iteratorPrototype?: object;
  legacyCallbackInterfaceObject?: JavaScriptFunction;
  legacyFactoryFunctions?: Map<string, JavaScriptFunction>;
  members?: WeakMap<object, MemberInitialObjects>;
  namedPropertiesObject?: object;
  namespaceObject?: object;
  unforgeablesObject?: object;
};
type MemberInitialObjects = Partial<Record<
  'getter' | 'operation' | 'setter' | 'stringifier',
  JavaScriptFunction
>>;
type StringifierEntry = AssembledInterfaceMember & {
  member: StringifierMember | AttributeMember;
};
type Exposable = {
  exposed?: '*' | [string, ...string[]];
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
  interface_: { extendedAttributes?: ExtendedAttribute[]; },
  id: string,
): NamedArgumentsExtendedAttribute[] {
  return interface_.extendedAttributes?.filter(
    (attribute): attribute is NamedArgumentsExtendedAttribute =>
      attribute.kind === 'named-arguments' &&
      attribute.name === 'LegacyFactoryFunction' &&
      attribute.value === id,
  ) ?? [];
}

function getLegacyFactoryFunctionIdentifiers(
  interface_: { extendedAttributes?: ExtendedAttribute[]; },
): string[] {
  const identifiers = new Set<string>();
  for (const attribute of interface_.extendedAttributes ?? []) {
    if (
      attribute.kind === 'named-arguments' &&
      attribute.name === 'LegacyFactoryFunction'
    ) identifiers.add(attribute.value);
  }
  return [...identifiers];
}

function belongsAt(
  member: AttributeMember | OperationMember,
  placement: MemberPlacement,
): boolean {
  if (placement === 'static') return member.static === true;
  if (member.static) return false;
  const unforgeable = hasExtendedAttribute(member, 'LegacyUnforgeable');
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

function hasExtendedAttribute(
  construct: { extendedAttributes?: ExtendedAttribute[]; },
  name: string,
): boolean {
  return construct.extendedAttributes?.some(
    (attribute) => attribute.kind !== 'raw' && attribute.name === name,
  ) ?? false;
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

function createRealmObject(
  realm: WebIDLRealmHost,
  prototype: object | null,
): object {
  const object = Reflect.construct(realm.intrinsics.object, []);
  if (!Reflect.setPrototypeOf(object, prototype)) {
    throw new Error('Could not set a Web IDL object prototype');
  }
  return object;
}

function createRealmErrorObject(
  realm: WebIDLRealmHost,
  prototype: object,
): object {
  const object = Reflect.construct(realm.intrinsics.error, []);
  if (!Reflect.setPrototypeOf(object, prototype)) {
    throw new Error('Could not set a Web IDL error object prototype');
  }
  return object;
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

function isObject(value: unknown): value is object {
  return value !== null && (
    typeof value === 'object' || typeof value === 'function'
  );
}
