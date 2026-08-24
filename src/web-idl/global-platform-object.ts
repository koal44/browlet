import type { AssembledInterface, DefinitionAssembly } from './adapter/assembly';
import {
  convertToJavaScript, type ConversionContext,
} from './conversion';
import type { OperationMember } from './adapter/definition';
import type {
  ImplementationRegistry, NamedPropertySteps,
} from './adapter/registry';
import { ordinarySetWithOwnDescriptor } from './platform-object';
import { getUnannotatedType } from './types';

// The Web IDL object kind is shared across realms and binding instances.
const namedPropertiesObjects = new WeakSet<object>();

export function isNamedPropertiesObject(object: object): boolean {
  return namedPropertiesObjects.has(object);
}

export class GlobalPlatformObjectBinding {
  readonly #context: ConversionContext;
  readonly #implementations: ImplementationRegistry;

  constructor(
    context: ConversionContext,
    implementations: ImplementationRegistry,
  ) {
    this.#context = context;
    this.#implementations = implementations;
  }

  createObject(implementation: object): object {
    return this.#withPrototypeBehavior(implementation);
  }

  createNamedPropertiesObject(
    interface_: AssembledInterface,
    prototype: object,
    getGlobalObject: () => object | undefined,
  ): object {
    const properties = this.#getNamedProperties(interface_);
    if (!properties) {
      throw new Error(
        `${interface_.definition.name} does not support named properties`,
      );
    }

    const target = createRealmObject(this.#context, prototype);
    Reflect.defineProperty(target, Symbol.toStringTag, {
      configurable: true,
      enumerable: false,
      value: `${interface_.definition.name}Properties`,
      writable: false,
    });

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
      defineProperty: () => false,
      deleteProperty: () => false,
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
      has: (target_, property) =>
        ownDescriptor(property) !== undefined || Reflect.has(target_, property),
      preventExtensions: () => false,
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
    namedPropertiesObjects.add(object);
    return object;
  }

  createPrototypeObject(prototype: object): object {
    return this.#withPrototypeBehavior(
      createRealmObject(this.#context, prototype),
    );
  }

  supportsNamedProperties(interface_: AssembledInterface): boolean {
    return findNamedGetter(
      interface_,
      this.#context.definitions,
    ) !== undefined;
  }

  #withPrototypeBehavior(target: object): object {
    if (this.#context.realm.isGlobalPrototypeChainMutable) return target;
    return new Proxy(target, {
      setPrototypeOf: (target_, value) =>
        this.#setPrototypeOf(target_, value),
    });
  }

  #setPrototypeOf(target: object, value: object | null): boolean {
    return this.#context.realm.isGlobalPrototypeChainMutable
      ? Reflect.setPrototypeOf(target, value)
      : Reflect.getPrototypeOf(target) === value;
  }

  #getNamedProperty(
    global: object,
    property: string,
    properties: NamedProperties,
  ): PropertyDescriptor {
    const record = this.#context.platformObjects.getRecord(global);
    const target = record?.implementation;
    if (!target) throw new Error('Global object is not a platform object');

    const steps = this.#implementations.getOperationSteps(properties.getter);
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

  #getNamedProperties(
    interface_: AssembledInterface,
  ): NamedProperties | undefined {
    const getter = findNamedGetter(interface_, this.#context.definitions);
    if (!getter) return;
    const steps = this.#implementations.getNamedPropertySteps(getter);
    if (!steps) {
      throw new Error('Missing supported property names implementation');
    }
    return {
      getter,
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
  steps: NamedPropertySteps;
  unenumerable: boolean;
};

function implementsExtendedAttribute(
  interface_: AssembledInterface,
  name: string,
): boolean {
  let current: AssembledInterface | undefined = interface_;
  while (current) {
    if (current.definition.extendedAttributes?.some(
      (attribute) => attribute.kind !== 'raw' && attribute.name === name,
    )) return true;
    current = current.parent;
  }
  return false;
}

function findNamedGetter(
  interface_: AssembledInterface,
  definitions: DefinitionAssembly,
): OperationMember | undefined {
  let current: AssembledInterface | undefined = interface_;
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

function isNamedOperation(
  operation: OperationMember,
  definitions: DefinitionAssembly,
): boolean {
  const key = operation.arguments[0];
  if (!key) return false;
  const type = getUnannotatedType(key.type, definitions);
  return type.kind === 'simple' && type.name === 'DOMString';
}

function createRealmObject(
  context: ConversionContext,
  prototype: object | null,
): object {
  const object = Reflect.construct(context.realm.intrinsics.object, []);
  if (!Reflect.setPrototypeOf(object, prototype)) {
    throw new Error('Could not set a Web IDL object prototype');
  }
  return object;
}

function isDataDescriptor(descriptor: PropertyDescriptor): boolean {
  return Object.hasOwn(descriptor, 'value') ||
    Object.hasOwn(descriptor, 'writable');
}
