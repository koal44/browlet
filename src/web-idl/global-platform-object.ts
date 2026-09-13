import {
  isDataDescriptor, ordinarySetWithOwnDescriptor,
} from '../js-engine/index';
import type { AssembledInterfaceDefinition, DefinitionAssembly } from './assembly';
import {
  convertToJavaScript, type ConversionContext,
} from './conversion';
import {
  hasExtendedAttribute, type OperationMember,
} from './core/definition';
import type {
  ImplementationRegistry, NamedPropertySteps,
} from './registry';
import { getUnannotatedType } from './types';

// The Web IDL object kind is shared across realms and binding instances.
const namedPropertiesObjects = new WeakSet<object>();

// Project predicate: recognize named properties objects allocated by this binding.
export function isNamedPropertiesObject(object: object): boolean {
  return namedPropertiesObjects.has(object);
}

export class GlobalPlatformObjectBinding {
  readonly #context: ConversionContext;
  readonly #implementations: ImplementationRegistry;

  // Project helper: retain the conversion context and implementation registry.
  constructor(
    context: ConversionContext,
    implementations: ImplementationRegistry,
  ) {
    this.#context = context;
    this.#implementations = implementations;
  }

  // Project adapter for Web IDL §3.8.1 [[SetPrototypeOf]] on global platform objects.
  createObject(target: object): object {
    return this.#withPrototypeBehavior(target);
  }

  // Project adapter for Web IDL §3.7.4 Named properties object — allocation and internal methods.
  createNamedPropertiesObject(
    interface_: AssembledInterfaceDefinition,
    prototype: object,
    getGlobalObject: () => object | undefined,
    allocation?: { object: object; setDelegate(delegate: object): void; },
  ): object {
    const properties = this.#getNamedProperties(interface_);
    if (!properties) {
      throw new Error(
        `${interface_.definition.name} does not support named properties`,
      );
    }

    const target = this.#context.realm.createOrdinaryObject(prototype);
    Reflect.defineProperty(target, Symbol.toStringTag, {
      configurable: true,
      enumerable: false,
      value: `${interface_.definition.name}Properties`,
      writable: false,
    });

    // Web IDL §3.7.4.1 [[GetOwnProperty]] of a named properties object.
    const ownDescriptor = (property: PropertyKey) => {
      const global = getGlobalObject();
      if (
        typeof property === 'string' &&
        global &&
        this.#namedPropertyVisible(global, property, properties)
      ) {
        return this.#getNamedProperty(global, property, properties);
      }
      return Reflect.getOwnPropertyDescriptor(target, property);
    };
    const object = new Proxy(target, {
      // Web IDL §3.7.4.2 [[DefineOwnProperty]].
      defineProperty: () => false,
      // Web IDL §3.7.4.3 [[Delete]].
      deleteProperty: () => false,
      // Project Proxy adapter for ECMAScript §10.1.8.1 OrdinaryGet with named [[GetOwnProperty]].
      get: (target_, property, receiver) => {
        const descriptor = ownDescriptor(property);
        if (!descriptor) {
          return Reflect.get(target_, property, receiver) as unknown;
        }
        if (isDataDescriptor(descriptor)) return descriptor.value as unknown;
        if (!descriptor.get) return undefined;
        const getter = Reflect.get(descriptor, 'get') as CallableFunction;
        return Reflect.apply(getter, receiver, []) as unknown;
      },
      getOwnPropertyDescriptor: (_target, property) => ownDescriptor(property),
      // Project Proxy adapter for ECMAScript §10.1.7.1 OrdinaryHasProperty with named [[GetOwnProperty]].
      has: (target_, property) =>
        ownDescriptor(property) !== undefined || Reflect.has(target_, property),
      // Web IDL §3.7.4.5 [[PreventExtensions]].
      preventExtensions: () => false,
      // Project delegate to ECMAScript §10.1.9.2 OrdinarySetWithOwnDescriptor.
      set: (target_, property, value, receiver) =>
        ordinarySetWithOwnDescriptor(
          target_,
          property,
          value,
          receiver,
          ownDescriptor(property),
        ),
      setPrototypeOf: (target_, value) =>
        this.#setPrototypeOf(target_, value),
    });
    if (allocation) {
      if (Reflect.getPrototypeOf(allocation.object) !== prototype) {
        throw new Error('Allocated named-properties object has the wrong parent');
      }
      allocation.setDelegate(object);
    }
    const platformObject = allocation?.object ?? object;
    namedPropertiesObjects.add(platformObject);
    return platformObject;
  }

  // Project allocator for Web IDL §3.7.3 Interface prototype object — global prototype-chain behavior.
  createPrototypeObject(prototype: object): object {
    return this.#withPrototypeBehavior(
      this.#context.realm.createOrdinaryObject(prototype),
    );
  }

  // Project predicate: find an inherited or directly declared named property getter.
  supportsNamedProperties(interface_: AssembledInterfaceDefinition): boolean {
    return findNamedGetter(
      interface_,
      this.#context.definitions,
    ) !== undefined;
  }

  // Project adapter: supply global prototype behavior through a Proxy when needed.
  #withPrototypeBehavior(target: object): object {
    if (this.#context.realm.isGlobalPrototypeChainMutable) return target;
    return new Proxy(target, {
      setPrototypeOf: (target_, value) =>
        this.#setPrototypeOf(target_, value),
    });
  }

  // Web IDL §3.8.1 [[SetPrototypeOf]] and §3.7.4.4 [[SetPrototypeOf]] — global and named properties objects.
  #setPrototypeOf(target: object, value: object | null): boolean {
    return this.#context.realm.isGlobalPrototypeChainMutable
      ? Reflect.setPrototypeOf(target, value)
      : Reflect.getPrototypeOf(target) === value;
  }

  // Extracted from Web IDL §3.7.4.1 [[GetOwnProperty]] — invoke the named getter and build its descriptor.
  #getNamedProperty(
    global: object,
    property: string,
    properties: NamedProperties,
  ): PropertyDescriptor {
    const record = this.#context.platformObjects.getRecord(global);
    const target = record?.implementation;
    if (!target) throw new Error('Global object is not a platform object');

    const steps = this.#implementations.getOperationSteps(
      properties.getter,
      properties.interface_,
    );
    if (!steps) throw new Error('Missing named property getter implementation');
    const value = Reflect.apply(steps, target, [property]);
    return {
      configurable: true,
      enumerable: !properties.unenumerable,
      value: convertToJavaScript(
        value,
        properties.getter.returns,
        this.#context,
      ),
      writable: true,
    };
  }

  // Web IDL §3.9.7 Abstract operations — named property visibility algorithm, applied to a global object.
  #namedPropertyVisible(
    global: object,
    property: string,
    properties: NamedProperties,
  ): boolean {
    const record = this.#context.platformObjects.getRecord(global);
    const target = record?.implementation;
    if (!target || !this.#getSupportedNames(target, properties).has(property)) {
      return false;
    }
    if (Reflect.getOwnPropertyDescriptor(global, property)) return false;

    let prototype = Reflect.getPrototypeOf(global);
    while (prototype) {
      if (
        !isNamedPropertiesObject(prototype) &&
        Reflect.getOwnPropertyDescriptor(prototype, property)
      ) return false;
      prototype = Reflect.getPrototypeOf(prototype);
    }
    return true;
  }

  // Project delegate to Web IDL §2.5.6.2 Named properties — the interface's supported property names.
  #getSupportedNames(
    target: object,
    properties: NamedProperties,
  ): ReadonlySet<string> {
    return Reflect.apply(
      // eslint-disable-next-line @typescript-eslint/unbound-method -- supported-name steps use the implementation as their specified this value
      properties.steps.getSupportedPropertyNames,
      target,
      [],
    );
  }

  // Project helper: collect the named getter, supported-name steps, and enumerability flag.
  #getNamedProperties(
    interface_: AssembledInterfaceDefinition,
  ): NamedProperties | undefined {
    const getter = findNamedGetter(interface_, this.#context.definitions);
    if (!getter) return;
    const steps = this.#implementations.getNamedPropertySteps(getter);
    if (!steps) {
      throw new Error('Missing supported property names implementation');
    }
    return {
      getter,
      interface_,
      steps,
      unenumerable: implementsExtendedAttribute(
        interface_,
        'LegacyUnenumerableNamedProperties',
      ),
    };
  }
}

type NamedProperties = {
  getter: OperationMember;
  interface_: AssembledInterfaceDefinition;
  steps: NamedPropertySteps;
  unenumerable: boolean;
};

// Project helper: search inherited interfaces and partial declarations for an extended attribute.
function implementsExtendedAttribute(
  interface_: AssembledInterfaceDefinition,
  name: string,
): boolean {
  let current: AssembledInterfaceDefinition | undefined = interface_;
  while (current) {
    if (hasExtendedAttribute(current.definition.extendedAttributes, name)) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

// Project helper: locate the most-derived named property getter.
function findNamedGetter(
  interface_: AssembledInterfaceDefinition,
  definitions: DefinitionAssembly,
): OperationMember | undefined {
  let current: AssembledInterfaceDefinition | undefined = interface_;
  while (current) {
    const operation = current.members.find(({ member }) =>
      member.kind === 'operation' &&
      member.special === 'getter' &&
      isNamedOperation(member, definitions))?.member;
    if (operation?.kind === 'operation') return operation;
    current = current.parent;
  }
  return;
}

// Project predicate for Web IDL §2.5.6.2 Named properties — a DOMString property-name argument.
function isNamedOperation(
  operation: OperationMember,
  definitions: DefinitionAssembly,
): boolean {
  const key = operation.arguments[0];
  if (!key) return false;
  const type = getUnannotatedType(key.type, definitions);
  return type.kind === 'simple' && type.name === 'DOMString';
}
