import { InternalError } from '../../../infra/index';
import type { JSFunction } from '../../../js-engine/index';

import type {
  IDLInterfaceMember, IDLConstant, IDLNamedArguments, AssembledInterface, AssembledCallbackInterface,
  AssembledNamespace, DefaultToJSONAttribute, MemberPlacement,
} from '../../assembly/index';
import type { PlatformRecord } from '../platform';
import type { RealmBinding } from '../realm';
import type { LegacyPropertyMetadata } from './legacy';
import { MemberBinding, type MemberOwner } from './member';
import { createOverloadResolver } from './overload';

/** An assembled construct's registered implementation steps and platform objects in one realm. */
export class ImplementationBinding<Assembled extends BoundConstruct = BoundConstruct> {
  /** Realm facilities used to install and invoke this implementation's members. */
  binding: RealmBinding;
  /** The declaration assembled independently of any realm. */
  assembled: Assembled;
  /** Allocate an implementation for internal platform-object creation. */
  declare createImplementation?: ImplementationCreationSteps;
  /** Initialize implementation state before establishing its platform identity. */
  declare initializeImplementation?: ImplementationInitializationSteps;
  /** Replace ordinary constructor invocation when the declaration supplies custom steps. */
  declare overriddenConstructor?: OverriddenConstructorSteps;
  /** Registered steps and generated functions, keyed by compiled members. */
  declare members?: Map<IDLMember, MemberBinding>;

  /** Retained platform objects preserve their identities for this construct and realm. */
  declare interfaceObject?: InterfaceObject;
  declare interfacePrototypeObject?: object;
  declare namespaceObject?: object;
  declare legacyCallbackInterfaceObject?: JSFunction;
  declare legacyFactoryFunctions?: Map<string, JSFunction>;
  declare iteratorPrototype?: object;
  declare asyncIteratorPrototype?: object;
  declare namedPropertiesObject?: object;
  declare unforgeablesObject?: object;
  declare legacyPropertyMetadata?: LegacyPropertyMetadata | null;
  /** Exposed attribute declarations, without retaining their changing values. */
  declare defaultToJSONAttributes?: DefaultToJSONAttribute[];

  constructor(binding: RealmBinding, assembled: Assembled) {
    this.binding = binding;
    this.assembled = assembled;
  }

  /** Retain the member's implementation steps and platform functions under its including construct. */
  getOrCreateMemberBinding(member: IDLMember): MemberBinding<Assembled> {
    const members = this.members ??= new Map<IDLMember, MemberBinding>();
    let binding = members.get(member);
    if (!binding) {
      binding = new MemberBinding(this);
      members.set(member, binding);
    }
    return binding as MemberBinding<Assembled>;
  }

  /** Retrieve or create the interface's constructor function in this realm. */
  // https://webidl.spec.whatwg.org/#interface-object
  getInterfaceObject(
    this: ImplementationBinding<AssembledInterface>,
  ): InterfaceObject {
    const { binding: realmBinding, assembled } = this;
    if (this.interfaceObject) return this.interfaceObject;

    const constructors = assembled.getConstructors(
      (entry) => realmBinding.isMemberExposed(assembled, entry), realmBinding.assembly,
    );
    const overridden = this.overriddenConstructor;
    const resolve = createOverloadResolver(constructors, realmBinding);
    const object: JSFunction = realmBinding.realm.createFunction(
      (_thisArgument, argumentsList, newTarget) => {
        if (overridden) {
          return overridden(argumentsList, newTarget, object);
        }
        if (constructors.callables.length === 0) {
          return realmBinding.throwTypeError('Illegal constructor');
        }
        if (!newTarget) {
          return realmBinding.throwTypeError(
            `Failed to construct '${assembled.primary.name}': use the 'new' operator.`,
          );
        }

        const overload = resolve(argumentsList);
        const behavior = realmBinding.getMemberBinding(assembled, overload.callable.primary)?.constructorBehavior;
        if (!behavior) {
          throw missingImplementation(assembled, 'constructor');
        }
        return realmBinding.constructPlatformObject(
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

    this.interfaceObject = object;
    this.getUnforgeableObject();
    Reflect.setPrototypeOf(
      object,
      assembled.parentAssembled
        ? realmBinding.getImplementationBinding(assembled.parentAssembled).getInterfaceObject()
        : realmBinding.realm.intrinsics.functionPrototype,
    );

    defineProperty(object, 'prototype', {
      configurable: false,
      enumerable: false,
      value: this.getInterfacePrototypeObject(),
      writable: false,
    });
    this.defineConstants(object);
    this.defineAttributes(object, 'static');
    this.defineOperations(object, 'static');
    return object;
  }

  /** Retrieve or create the legacy callback interface object and its constants. */
  // https://webidl.spec.whatwg.org/#legacy-callback-interface-object
  getLegacyCallbackInterfaceObject(
    this: ImplementationBinding<AssembledCallbackInterface>,
  ): object {
    const { binding: realmBinding, assembled } = this;
    const definition = assembled.primary;
    if (this.legacyCallbackInterfaceObject) {
      return this.legacyCallbackInterfaceObject;
    }

    const object = realmBinding.realm.createFunction(
      () => realmBinding.throwTypeError('Illegal invocation'),
      { length: 0, name: definition.name },
    );
    for (const member of assembled.members) {
      if (
        member.kind === 'constant' &&
        realmBinding.isConstructExposed(member)
      ) {
        this.#defineConstant(object, member);
      }
    }
    this.legacyCallbackInterfaceObject = object;
    return object;
  }

  /** Retrieve or create a named constructor alias with its own prepared overloads. */
  // https://webidl.spec.whatwg.org/#legacy-factory-functions
  getLegacyFactoryFunction(
    this: ImplementationBinding<AssembledInterface>,
    name: string,
  ): JSFunction {
    const { binding: realmBinding, assembled } = this;
    const existing = this.legacyFactoryFunctions?.get(name);
    if (existing) return existing;

    const overloads = assembled.getLegacyFactoryOverloads(name, realmBinding.assembly);
    const resolve = createOverloadResolver(overloads, realmBinding);
    const function_ = realmBinding.realm.createFunction(
      (_thisArgument, argumentsList, newTarget) => {
        if (!newTarget) {
          return realmBinding.throwTypeError(
            `Failed to construct '${name}': use the 'new' operator.`,
          );
        }
        const overload = resolve(argumentsList);
        const behavior = realmBinding.getMemberBinding(assembled, overload.callable.primary)?.constructorBehavior;
        if (!behavior) {
          throw new InternalError(
            `Web IDL ${assembled.primary.name} legacy factory function ${name} has no implementation steps`,
          );
        }
        return realmBinding.constructPlatformObject(
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
      value: this.getInterfacePrototypeObject(),
      writable: false,
    });
    (this.legacyFactoryFunctions ??= new Map()).set(name, function_);
    return function_;
  }

  /** Retrieve or create the namespace object with this realm's exposed members. */
  // https://webidl.spec.whatwg.org/#namespace-object
  getNamespaceObject(
    this: ImplementationBinding<AssembledNamespace>,
  ): object {
    const { binding: realmBinding, assembled } = this;
    if (this.namespaceObject) return this.namespaceObject;

    const object = realmBinding.realm.createOrdinaryObject(
      realmBinding.realm.intrinsics.objectPrototype,
    );
    this.namespaceObject = object;
    this.defineAttributes(object, 'regular');
    this.defineOperations(object, 'regular');
    this.defineConstants(object);

    for (const interfaceAssembled of realmBinding.assembly.interfaces.inNamespace(assembled.primary.name)) {
      if (!realmBinding.isExposed(interfaceAssembled)) continue;
      defineProperty(object, interfaceAssembled.primary.name, {
        configurable: true,
        enumerable: false,
        value: realmBinding.getImplementationBinding(interfaceAssembled).getInterfaceObject(),
        writable: true,
      });
    }
    defineProperty(object, Symbol.toStringTag, {
      configurable: true,
      enumerable: false,
      value: assembled.primary.name,
      writable: false,
    });
    return object;
  }

  /** Retrieve or create the interface prototype, retaining its inheritance and member functions. */
  // https://webidl.spec.whatwg.org/#interface-prototype-object
  getInterfacePrototypeObject(
    this: ImplementationBinding<AssembledInterface>,
  ): object {
    const { binding: realmBinding, assembled } = this;
    if (this.interfacePrototypeObject) {
      return this.interfacePrototypeObject;
    }

    this.assertOrdinaryProjection();

    const global = assembled.isGlobal();
    const parentPrototype = global &&
      assembled.findSpecialOperation('getter', 'DOMString') !== undefined
      ? this.#getNamedPropertiesObject()
      : assembled.parentAssembled
        ? realmBinding.getImplementationBinding(assembled.parentAssembled).getInterfacePrototypeObject()
        : assembled.primary.name === 'DOMException'
          ? realmBinding.realm.intrinsics.errorPrototype
          : realmBinding.realm.intrinsics.objectPrototype;
    const allocated = realmBinding.globalAllocation?.prototypes.get(assembled.primary.name);
    const prototype = allocated ?? ((!realmBinding.realm.isGlobalPrototypeChainMutable && realmBinding.assembly.interfaces.isOnGlobalPrototypeChain(assembled))
      ? realmBinding.globalPlatformObjects.createPrototypeObject(parentPrototype)
      : realmBinding.realm.createOrdinaryObject(parentPrototype));
    if (Reflect.getPrototypeOf(prototype) !== parentPrototype) {
      throw new InternalError(`Allocated ${assembled.primary.name} prototype has the wrong parent`);
    }
    this.interfacePrototypeObject = prototype;

    this.#defineUnscopables(prototype);
    if (!global) {
      this.defineAttributes(prototype, 'regular');
      this.defineOperations(prototype, 'regular');
      this.defineStringifier(prototype, 'regular');
      this.defineIterationMethods(prototype);
      this.defineAsyncIterationMethods(prototype);
      this.defineCollectionMembers(prototype);
    }
    this.defineConstants(prototype);

    if (assembled.hasInterfaceObject()) {
      defineProperty(prototype, 'constructor', {
        configurable: true,
        enumerable: false,
        value: this.getInterfaceObject(),
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

  /** Install constants exposed by this interface or namespace in the binding's realm. */
  defineConstants(
    this: ImplementationBinding<MemberOwner>,
    target: object,
  ): void {
    const { binding: realmBinding, assembled } = this;
    for (const entry of assembled.members) {
      if (
        entry.member.kind !== 'constant' ||
        !realmBinding.isMemberExposed(assembled, entry)
      ) continue;

      this.#defineConstant(target, entry.member);
    }
  }

  #defineConstant(
    target: object,
    constant: IDLConstant,
  ): void {
    const realmBinding = this.binding;
    const converter = realmBinding.getConverter(constant.type);
    defineProperty(target, constant.name, {
      configurable: false,
      enumerable: true,
      value: converter.idlToJS(converter.createDefault(constant.value)),
      writable: false,
    });
  }

  /** Install exposed attributes at the selected constructor, prototype, or instance location. */
  defineAttributes(
    this: ImplementationBinding<MemberOwner>,
    target: object,
    kind: MemberPlacement,
  ): void {
    const { binding: realmBinding, assembled } = this;
    for (const entry of assembled.getAttributes(kind)) {
      const attribute = entry.member;
      if (!realmBinding.isMemberExposed(assembled, entry)) continue;

      const memberBinding = this.getOrCreateMemberBinding(attribute);
      defineProperty(target, attribute.name, {
        configurable: kind !== 'unforgeable',
        enumerable: true,
        get: memberBinding.getAttributeGetter(attribute),
        set: memberBinding.getAttributeSetter(attribute),
      });
    }
  }

  /** Install one platform function for each exposed operation overload group. */
  defineOperations(
    this: ImplementationBinding<MemberOwner>,
    target: object,
    kind: MemberPlacement,
  ): void {
    const { binding: realmBinding, assembled } = this;
    const groups = assembled.getOperationGroups(
      kind,
      (_operation, entry) => realmBinding.isMemberExposed(assembled, entry),
      realmBinding.assembly,
    );

    for (const operations of groups.values()) {
      const name = operations.callables[0]?.primary.name;
      if (!name) continue;
      defineProperty(target, name, {
        configurable: kind !== 'unforgeable',
        enumerable: true,
        value: this.getOrCreateMemberBinding(operations.callables[0]!.primary).getOperationFunction(name, operations),
        writable: kind !== 'unforgeable',
      });
    }
  }

  /** Install the exposed stringifier at its declared location. */
  defineStringifier(
    this: ImplementationBinding<AssembledInterface>,
    target: object,
    placement: Extract<MemberPlacement, 'regular' | 'unforgeable'>,
  ): void {
    const { binding: realmBinding, assembled } = this;
    const entry = assembled.getStringifier(placement, (entry) => realmBinding.isMemberExposed(assembled, entry));
    if (!entry) return;
    const unforgeable = placement === 'unforgeable';

    defineProperty(target, 'toString', {
      configurable: !unforgeable,
      enumerable: true,
      value: this.getOrCreateMemberBinding(entry.member).getStringifierFunction(entry.member),
      writable: !unforgeable,
    });
  }

  /** Install synchronous iteration from the interface's indexed getter or iterable declaration. */
  defineIterationMethods(
    this: ImplementationBinding<AssembledInterface>,
    target: object,
  ): void {
    const { binding: realmBinding, assembled } = this;
    const entry = assembled.findMemberByKind('iterable');
    if (assembled.findSpecialOperation('getter', 'unsigned long') !== undefined) {
      realmBinding.iterables.defineIndexedMethods(
        target,
        entry !== undefined &&
        entry.member.key === undefined &&
        realmBinding.isMemberExposed(assembled, entry),
      );
      return;
    }
    if (
      !entry ||
      !realmBinding.isMemberExposed(assembled, entry)
    ) return;

    realmBinding.iterables.defineMethods(
      target,
      assembled,
      entry.member,
    );
  }

  /** Install async iteration using this realm's iterator prototypes and method functions. */
  defineAsyncIterationMethods(
    this: ImplementationBinding<AssembledInterface>,
    target: object,
  ): void {
    const { binding: realmBinding, assembled } = this;
    const entry = assembled.findMemberByKind('async-iterable');
    if (
      !entry ||
      !realmBinding.isMemberExposed(assembled, entry)
    ) return;

    realmBinding.asyncIterables.defineMethods(
      target,
      assembled,
      assembled.callables.get(entry.member),
    );
  }

  /** Install the operations implied by a maplike or setlike declaration. */
  defineCollectionMembers(
    this: ImplementationBinding<AssembledInterface>,
    target: object,
  ): void {
    const { binding: realmBinding, assembled } = this;
    const member = assembled.getCollectionMember();
    if (member?.kind === 'maplike') {
      realmBinding.maplikes.defineMembers(target, assembled, member);
    } else if (member?.kind === 'setlike') {
      realmBinding.setlikes.defineMembers(target, assembled, member);
    }
  }

  /** Build a fresh default-toJSON result, reading each exposed attribute's current value. */
  // https://webidl.spec.whatwg.org/#default-tojson-steps
  runDefaultToJSON(
    this: ImplementationBinding<AssembledInterface>,
    receiver: PlatformRecord,
  ): object {
    const realmBinding = this.binding;
    const result = realmBinding.realm.createOrdinaryObject(
      realmBinding.realm.intrinsics.objectPrototype,
    );

    for (const entry of this.#getDefaultToJSONAttributes()) {
      const { member: attribute, implementation } = entry;
      const steps = realmBinding.getMemberBinding(entry.assembled, implementation)?.attributeSteps;
      if (!steps) throw missingImplementation(entry.assembled, `attribute ${attribute.name}`);
      const idlValue = steps.get(receiver);
      defineProperty(result, attribute.name, {
        configurable: true,
        enumerable: true,
        value: receiver.binding.getConverter(attribute.type, realmBinding.realm).idlToJS(idlValue),
        writable: true,
      });
    }
    return result;
  }

  #getDefaultToJSONAttributes(
    this: ImplementationBinding<AssembledInterface>,
  ): DefaultToJSONAttribute[] {
    return this.defaultToJSONAttributes ??= this.assembled.getDefaultToJSONAttributes(this.binding.assembly)
      .filter((entry) => this.binding.isMemberExposed(entry.assembled, entry));
  }

  /** Reject special operations that the available platform-object machinery cannot implement. */
  assertOrdinaryProjection(
    this: ImplementationBinding<AssembledInterface>,
  ): void {
    const { binding: realmBinding, assembled } = this;
    for (const { member } of assembled.members) {
      if (member.kind === 'operation' && member.special) {
        if (realmBinding.legacyPlatformObjects.supportsSpecialOperation(member)) {
          continue;
        }
        throw new InternalError(
          `${assembled.primary.name} requires deferred legacy platform object machinery`,
        );
      }
    }
  }

  /** Retain unforgeable property descriptors for installation on each platform instance. */
  getUnforgeableObject(
    this: ImplementationBinding<AssembledInterface>,
  ): object {
    const realmBinding = this.binding;
    if (this.unforgeablesObject) return this.unforgeablesObject;

    const object = realmBinding.realm.createOrdinaryObject(null);
    this.unforgeablesObject = object;
    this.defineAttributes(object, 'unforgeable');
    this.defineOperations(object, 'unforgeable');
    this.defineStringifier(object, 'unforgeable');
    return object;
  }

  // https://webidl.spec.whatwg.org/#named-properties-object
  #getNamedPropertiesObject(
    this: ImplementationBinding<AssembledInterface>,
  ): object {
    const { binding: realmBinding, assembled } = this;
    if (this.namedPropertiesObject) return this.namedPropertiesObject;

    const parent = assembled.parentAssembled
      ? realmBinding.getImplementationBinding(assembled.parentAssembled).getInterfacePrototypeObject()
      : realmBinding.realm.intrinsics.objectPrototype;
    const object = realmBinding.globalPlatformObjects.createNamedPropertiesObject(
      assembled,
      parent,
      () => realmBinding.globalObject?.platformObject,
      realmBinding.globalAllocation?.namedProperties,
    );
    this.namedPropertiesObject = object;
    return object;
  }

  #defineUnscopables(
    this: ImplementationBinding<AssembledInterface>,
    target: object,
  ): void {
    const { binding: realmBinding, assembled } = this;
    const names = assembled.getUnscopableNames((entry) => realmBinding.isMemberExposed(assembled, entry));
    if (names.size === 0) return;

    const unscopables = realmBinding.realm.createOrdinaryObject(null);
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

  /** Retain indexed/named property behavior, or null for an ordinary interface. */
  getLegacyPropertyMetadata(
    this: ImplementationBinding<AssembledInterface>,
  ): LegacyPropertyMetadata | null {
    const { binding: realmBinding, assembled } = this;
    // null records an ordinary interface; undefined means it has not been inspected yet.
    if (this.legacyPropertyMetadata === undefined) {
      this.legacyPropertyMetadata = realmBinding.legacyPlatformObjects.createPropertyMetadata(
        assembled,
      );
    }
    return this.legacyPropertyMetadata;
  }
}

export type BoundConstruct = AssembledInterface | AssembledNamespace | AssembledCallbackInterface;
export type IDLMember = IDLInterfaceMember | IDLNamedArguments;

type InterfaceObject = JSFunction & { prototype: object; };

type ImplementationCreationSteps = () => object;

type ImplementationInitializationSteps = (value: object) => void;

type OverriddenConstructorSteps = (
  argumentsList: unknown[],
  newTarget: object | undefined,
  activeFunction: object,
) => unknown;

// Report installation failures without exposing an engine-created exception.
function defineProperty(
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor,
): void {
  if (!Reflect.defineProperty(target, key, descriptor)) {
    throw new InternalError(`Could not define Web IDL property ${String(key)}`);
  }
}

// Describe an incomplete implementation registration.
function missingImplementation(
  assembled: MemberOwner,
  memberName: string,
): Error {
  return new InternalError(
    `Web IDL ${assembled.primary.name} ${memberName} has no implementation steps`,
  );
}
