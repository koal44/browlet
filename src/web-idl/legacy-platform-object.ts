import {
  isAccessorDescriptor, isDataDescriptor, ordinarySetWithOwnDescriptor,
} from '../js-engine/index';
import type { AssembledInterface } from './assembled';
import { convertToIDL, convertToJavaScript } from './conversion';
import type { OperationMember } from './core/types';
import { getImplementationObject, getImplementationRecord, type PlatformRecord } from './platform-object';
import { isNamedPropertiesObject } from './global-platform-object';
import type { RealmBinding } from './realm-binding';
import type {
  IndexedPropertySteps, NamedPropertySteps,
} from './definition-binding';
import { getTypeWithApplicableExtendedAttributes } from './types';
import { InternalError } from '../infra/internal-error';

export class LegacyPlatformObjectBinding {
  #binding: RealmBinding;

  // Project helper: retain the owning realm binding.
  constructor(binding: RealmBinding) {
    this.#binding = binding;
  }

  // Project adapter for Web IDL §3.9 Legacy platform objects — install the internal methods as Proxy traps.
  createObject(
    target: object,
    implementation: object,
    properties: LegacyPropertyMetadata | null,
  ): object {
    if (!properties) return target;

    const handler = Object.assign(
      Object.create(null) as ProxyHandler<object>,
      {
        defineProperty: (
          target: object,
          property: string | symbol,
          descriptor: PropertyDescriptor,
        ) => this.#defineOwnProperty(
          target,
          implementation,
          property,
          descriptor,
          properties,
        ),
        deleteProperty: (target: object, property: string | symbol) =>
          this.#delete(target, implementation, property, properties),
        get: (
          target: object,
          property: string | symbol,
          receiver: unknown,
        ) => this.#get(
          target,
          implementation,
          property,
          receiver,
          properties,
        ),
        // Web IDL §3.9.1 [[GetOwnProperty]] delegates to LegacyPlatformObjectGetOwnProperty.
        getOwnPropertyDescriptor: (
          target: object,
          property: string | symbol,
        ) => this.#getOwnProperty(
          target,
          implementation,
          property,
          properties,
        ),
        has: (target: object, property: string | symbol) =>
          this.#has(target, implementation, property, properties),
        ownKeys: (target: object) => this.#ownPropertyKeys(
          target,
          implementation,
          properties,
        ),
        // Web IDL §3.9.5 [[PreventExtensions]].
        preventExtensions: () => false,
        set: (
          target: object,
          property: string | symbol,
          value: unknown,
          receiver: unknown,
        ) => this.#set(
          target,
          implementation,
          property,
          value,
          receiver,
          properties,
        ),
      } satisfies ProxyHandler<object>,
    );
    return new Proxy(target, handler);
  }

  // Project helper: assemble inherited property declarations, flags, and registered callbacks.
  createPropertyMetadata(
    assembled: AssembledInterface,
  ): LegacyPropertyMetadata | null {
    const indexedGetter = assembled.findSpecialOperation('getter', 'unsigned long', this.#binding.assembly);
    const namedGetter = assembled.findSpecialOperation('getter', 'DOMString', this.#binding.assembly);
    if (!indexedGetter && !namedGetter) return null;

    let indexed: IndexedProperties | undefined;
    if (indexedGetter) {
      const steps = this.#binding.getMemberBinding(assembled, indexedGetter)?.indexedPropertySteps;
      if (!steps) {
        throw new InternalError('Missing supported property indices implementation');
      }
      indexed = {
        getter: indexedGetter,
        assembled,
        setter: assembled.findSpecialOperation('setter', 'unsigned long', this.#binding.assembly),
        steps,
      };
    }

    let named: NamedProperties | undefined;
    if (namedGetter) {
      const steps = this.#binding.getMemberBinding(assembled, namedGetter)?.namedPropertySteps;
      if (!steps) {
        throw new InternalError('Missing supported property names implementation');
      }
      named = {
        deleter: assembled.findSpecialOperation('deleter', 'DOMString', this.#binding.assembly),
        getter: namedGetter,
        assembled,
        overrideBuiltIns: assembled.inheritsExtendedAttribute('LegacyOverrideBuiltIns'),
        setter: assembled.findSpecialOperation('setter', 'DOMString', this.#binding.assembly),
        steps,
        unenumerable: assembled.inheritsExtendedAttribute('LegacyUnenumerableNamedProperties'),
        unforgeableNames: assembled.getUnforgeablePropertyNames(),
      };
    }
    return { indexed, named };
  }

  // Project predicate: select indexed and named operations supported by this binding.
  supportsSpecialOperation(operation: OperationMember): boolean {
    const key = operation.arguments[0];
    if (!key) return false;
    const type = this.#binding.assembly.getUnannotatedType(key.type);
    return type.kind === 'simple' &&
      (type.name === 'DOMString' || (operation.special !== 'deleter' && type.name === 'unsigned long'));
  }

  // Project Proxy adapter for ECMAScript §10.1.8.1 OrdinaryGet with legacy [[GetOwnProperty]].
  #get(
    target: object,
    implementation: object,
    property: string | symbol,
    receiver: unknown,
    properties: LegacyPropertyMetadata,
  ): unknown {
    if (typeof property === 'symbol') {
      return Reflect.get(target, property, receiver);
    }
    const descriptor = this.#getOwnProperty(
      target,
      implementation,
      property,
      properties,
    );
    if (!descriptor) return Reflect.get(target, property, receiver);
    if (!isAccessorDescriptor(descriptor)) return descriptor.value;
    if (!descriptor.get) return undefined;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- the descriptor's receiver is supplied explicitly
    return Reflect.apply(descriptor.get, receiver, []);
  }

  // Project Proxy adapter for ECMAScript §10.1.7.1 OrdinaryHasProperty with legacy [[GetOwnProperty]].
  #has(
    target: object,
    implementation: object,
    property: string | symbol,
    properties: LegacyPropertyMetadata,
  ): boolean {
    if (typeof property === 'symbol') return Reflect.has(target, property);
    if (this.#getOwnProperty(
      target,
      implementation,
      property,
      properties,
    )) return true;
    const parent = Reflect.getPrototypeOf(target);
    return parent ? Reflect.has(parent, property) : false;
  }

  // Web IDL §3.9.7 Abstract operations — LegacyPlatformObjectGetOwnProperty.
  #getOwnProperty(
    target: object,
    implementation: object,
    property: string | symbol,
    properties: LegacyPropertyMetadata,
    ignoreNamedProperties = false,
  ): PropertyDescriptor | undefined {
    if (typeof property === 'symbol') {
      return Reflect.getOwnPropertyDescriptor(target, property);
    }

    if (properties.indexed && isArrayIndex(property)) {
      const descriptor = this.#getIndexedProperty(
        implementation,
        property,
        properties.indexed,
      );
      if (descriptor) return descriptor;
      ignoreNamedProperties = true;
    }
    if (
      properties.named &&
      !ignoreNamedProperties &&
      this.#namedPropertyVisible(
        target,
        implementation,
        property,
        properties.named,
      )
    ) {
      return this.#getNamedProperty(
        implementation,
        property,
        properties.named,
      );
    }
    return Reflect.getOwnPropertyDescriptor(target, property);
  }

  // Extracted from Web IDL §3.9.7 Abstract operations — LegacyPlatformObjectGetOwnProperty: indexed property
  // steps.
  #getIndexedProperty(
    target: object,
    property: string,
    properties: IndexedProperties,
  ): PropertyDescriptor | undefined {
    const index = toArrayIndex(property);
    const { steps } = properties;
    if ('supportsIndex' in steps && !this.#supportsIndex(target, index, properties)) return;

    const value = this.#getIndexedValue(target, index, properties);
    if ('unsupportedValue' in steps && value === steps.unsupportedValue) return;
    return {
      configurable: true,
      enumerable: true,
      value: convertToJavaScript(
        value,
        properties.getter.returns,
        this.#binding.defaultConversionContext,
      ),
      writable: properties.setter !== undefined,
    };
  }

  // Extracted from Web IDL §3.9.7 Abstract operations — LegacyPlatformObjectGetOwnProperty: named property
  // steps.
  #getNamedProperty(
    target: object,
    property: string,
    properties: NamedProperties,
  ): PropertyDescriptor {
    const steps = this.#binding.getMemberBinding(properties.assembled, properties.getter)?.operationSteps;
    if (!steps) {
      throw new InternalError('Missing named property getter implementation');
    }
    const value = steps(this.#getReceiverRecord(target), property);
    return {
      configurable: true,
      enumerable: !properties.unenumerable,
      value: convertToJavaScript(
        value,
        properties.getter.returns,
        this.#binding.defaultConversionContext,
      ),
      writable: properties.setter !== undefined,
    };
  }

  // Web IDL §3.9.2 [[Set]].
  #set(
    target: object,
    implementation: object,
    property: string | symbol,
    value: unknown,
    receiver: unknown,
    properties: LegacyPropertyMetadata,
  ): boolean {
    const receiverTargetsObject = getImplementationObject(receiver) === implementation;
    if (receiverTargetsObject && typeof property === 'string') {
      if (properties.indexed?.setter && isArrayIndex(property)) {
        this.#invokeIndexedSetter(
          implementation,
          property,
          value,
          properties.indexed,
        );
        return true;
      }
      if (properties.named?.setter) {
        this.#invokeNamedSetter(
          implementation,
          property,
          value,
          properties.named,
        );
        return true;
      }
    }

    const descriptor = this.#getOwnProperty(
      target,
      implementation,
      property,
      properties,
      true,
    );
    return ordinarySetWithOwnDescriptor(
      target,
      property,
      value,
      receiver,
      descriptor,
    );
  }

  // Web IDL §3.9.3 [[DefineOwnProperty]].
  #defineOwnProperty(
    target: object,
    implementation: object,
    property: string | symbol,
    descriptor: PropertyDescriptor,
    properties: LegacyPropertyMetadata,
  ): boolean {
    if (
      properties.indexed &&
      typeof property === 'string' &&
      isArrayIndex(property)
    ) {
      if (!isDataDescriptor(descriptor) || !properties.indexed.setter) {
        return false;
      }
      this.#invokeIndexedSetter(
        implementation,
        property,
        descriptor.value,
        properties.indexed,
      );
      return true;
    }

    const named = properties.named;
    if (
      named &&
      typeof property === 'string' &&
      !named.unforgeableNames.has(property)
    ) {
      const creating = !this.#getSupportedNames(
        implementation,
        named,
      ).has(property);
      if (
        named.overrideBuiltIns ||
        !Reflect.getOwnPropertyDescriptor(target, property)
      ) {
        if (!creating && !named.setter) return false;
        if (named.setter) {
          if (!isDataDescriptor(descriptor)) return false;
          this.#invokeNamedSetter(
            implementation,
            property,
            descriptor.value,
            named,
          );
          return true;
        }
      }
    }
    return Reflect.defineProperty(target, property, descriptor);
  }

  // Web IDL §3.9.4 [[Delete]].
  #delete(
    target: object,
    implementation: object,
    property: string | symbol,
    properties: LegacyPropertyMetadata,
  ): boolean {
    if (
      properties.indexed &&
      typeof property === 'string' &&
      isArrayIndex(property)
    ) {
      return !this.#supportsIndex(
        implementation,
        toArrayIndex(property),
        properties.indexed,
      );
    }
    if (
      properties.named &&
      typeof property === 'string' &&
      this.#namedPropertyVisible(
        target,
        implementation,
        property,
        properties.named,
      )
    ) {
      if (!properties.named.deleter) return false;
      return this.#invokeNamedDeleter(
        implementation,
        property,
        properties.named,
      );
    }
    return Reflect.deleteProperty(target, property);
  }

  // Web IDL §3.9.6 [[OwnPropertyKeys]].
  #ownPropertyKeys(
    target: object,
    implementation: object,
    properties: LegacyPropertyMetadata,
  ): (string | symbol)[] {
    const keys = new Set<string | symbol>();
    if (properties.indexed) {
      const indices = [
        ...this.#getSupportedIndices(implementation, properties.indexed),
      ];
      indices.sort((left, right) => left - right);
      for (const index of indices) keys.add(String(index));
    }
    if (properties.named) {
      const names = this.#getSupportedNames(
        implementation,
        properties.named,
      );
      for (const name of names) {
        if (this.#namedPropertyVisible(
          target,
          implementation,
          name,
          properties.named,
          names,
        )) keys.add(name);
      }
    }

    const ownKeys = Reflect.ownKeys(target);
    for (const key of ownKeys) {
      if (typeof key === 'string') keys.add(key);
    }
    for (const key of ownKeys) {
      if (typeof key === 'symbol') keys.add(key);
    }
    return [...keys];
  }

  // Web IDL §3.9.7 Abstract operations — invoke an indexed property setter.
  #invokeIndexedSetter(
    target: object,
    property: string,
    value: unknown,
    properties: IndexedProperties,
  ): void {
    const { setter } = properties;
    if (!setter) throw new InternalError('Indexed property has no setter');

    const index = toArrayIndex(property);
    const creating = !this.#supportsIndex(
      target,
      index,
      properties,
    );
    const converted = this.#convertSetterValue(setter, value);

    if (setter.name) {
      const steps = this.#binding.getMemberBinding(properties.assembled, setter)?.operationSteps;
      if (!steps) {
        throw new InternalError('Missing indexed property setter implementation');
      }
      steps(this.#getReceiverRecord(target), index, converted);
      return;
    }

    const steps = creating ? properties.steps.setNew : properties.steps.setExisting;
    if (!steps) {
      throw new InternalError(
        `Missing indexed property ${creating ? 'new' : 'existing'} setter implementation`,
      );
    }
    Reflect.apply(steps, target, [index, converted]);
  }

  // Web IDL §3.9.7 Abstract operations — invoke a named property setter.
  #invokeNamedSetter(
    target: object,
    property: string,
    value: unknown,
    properties: NamedProperties,
  ): void {
    const { setter } = properties;
    if (!setter) throw new InternalError('Named property has no setter');

    const creating = !this.#getSupportedNames(target, properties).has(property);
    const converted = this.#convertSetterValue(setter, value);
    if (setter.name) {
      const steps = this.#binding.getMemberBinding(properties.assembled, setter)?.operationSteps;
      if (!steps) {
        throw new InternalError('Missing named property setter implementation');
      }
      steps(this.#getReceiverRecord(target), property, converted);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/unbound-method -- named setter steps use the implementation as their specified this value
    const steps = creating ? properties.steps.setNew : properties.steps.setExisting;
    if (!steps) {
      throw new InternalError(
        `Missing named property ${creating ? 'new' : 'existing'} setter implementation`,
      );
    }
    Reflect.apply(steps, target, [property, converted]);
  }

  // Extracted from Web IDL §3.9.7 Abstract operations — convert the value for an indexed or named property
  // setter.
  #convertSetterValue(setter: OperationMember, value: unknown): unknown {
    const valueArgument = setter.arguments[1];
    if (!valueArgument) {
      throw new InternalError('Legacy property setter has no value argument');
    }
    return convertToIDL(
      value,
      getTypeWithApplicableExtendedAttributes(
        valueArgument.type,
        valueArgument.extendedAttributes,
      ),
      this.#binding.defaultConversionContext,
    );
  }

  // Extracted from Web IDL §3.9.4 [[Delete]] — invoke the named property deleter.
  #invokeNamedDeleter(
    target: object,
    property: string,
    properties: NamedProperties,
  ): boolean {
    const { deleter } = properties;
    if (!deleter) throw new InternalError('Named property has no deleter');
    if (!deleter.name) {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- named deleter steps use the implementation as their specified this value
      const steps = properties.steps.deleteExisting;
      if (!steps) {
        throw new InternalError('Missing anonymous named property deleter implementation');
      }
      return Reflect.apply(steps, target, [property]);
    }

    const steps = this.#binding.getMemberBinding(properties.assembled, deleter)?.operationSteps;
    if (!steps) throw new InternalError('Missing named property deleter implementation');
    const result = steps(this.#getReceiverRecord(target), property);
    const returnType = this.#binding.assembly.getUnannotatedType(deleter.returns);
    return returnType.kind !== 'simple' ||
      returnType.name !== 'boolean' ||
      result !== false;
  }

  // Web IDL §3.9.7 Abstract operations — named property visibility algorithm.
  #namedPropertyVisible(
    target: object,
    implementation: object,
    property: string,
    properties: NamedProperties,
    supportedNames = this.#getSupportedNames(implementation, properties),
  ): boolean {
    if (!supportedNames.has(property)) return false;
    if (Reflect.getOwnPropertyDescriptor(target, property)) return false;
    if (properties.overrideBuiltIns) return true;

    let prototype = Reflect.getPrototypeOf(target);
    while (prototype) {
      if (
        !isNamedPropertiesObject(prototype) &&
        Reflect.getOwnPropertyDescriptor(prototype, property)
      ) return false;
      prototype = Reflect.getPrototypeOf(prototype);
    }
    return true;
  }

  // Project delegate to Web IDL §2.5.6.1 Indexed properties — determine the value of an indexed property.
  #getIndexedValue(
    implementation: object,
    index: number,
    properties: IndexedProperties,
  ): unknown {
    const steps = this.#binding.getMemberBinding(properties.assembled, properties.getter)?.operationSteps;
    if (!steps) throw new InternalError('Missing indexed property getter implementation');
    return steps(this.#getReceiverRecord(implementation), index);
  }

  // Proxy traps run after their implementation has been associated with the platform object.
  #getReceiverRecord(implInst: object): PlatformRecord {
    const record = getImplementationRecord(implInst);
    if (!record) throw new InternalError('Legacy object implementation is not associated');
    return record;
  }

  // Project adapter for Web IDL §2.5.6.1 Indexed properties — query the interface's supported property indices.
  #supportsIndex(
    implementation: object,
    index: number,
    properties: IndexedProperties,
  ): boolean {
    const { steps } = properties;
    return 'supportsIndex' in steps ?
      // eslint-disable-next-line @typescript-eslint/unbound-method -- support steps use the implementation as their specified this value
      Reflect.apply(steps.supportsIndex, implementation, [index]) :
      this.#getIndexedValue(implementation, index, properties) !== steps.unsupportedValue;
  }

  // Project delegate to Web IDL §2.5.6.1 Indexed properties — enumerate supported property indices.
  #getSupportedIndices(
    target: object,
    properties: IndexedProperties,
  ): Iterable<number> {
    return Reflect.apply(
      properties.steps.getSupportedPropertyIndices,
      target,
      [],
    );
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
}

export type LegacyPropertyMetadata = {
  indexed: IndexedProperties | undefined;
  named: NamedProperties | undefined;
};

type IndexedProperties = {
  getter: OperationMember;
  assembled: AssembledInterface;
  setter: OperationMember | undefined;
  steps: IndexedPropertySteps;
};

type NamedProperties = {
  deleter: OperationMember | undefined;
  getter: OperationMember;
  assembled: AssembledInterface;
  overrideBuiltIns: boolean;
  setter: OperationMember | undefined;
  steps: NamedPropertySteps;
  unenumerable: boolean;
  unforgeableNames: Set<string>;
};

// Web IDL §3.9.7 Abstract operations — determine if a property name is an array index.
function isArrayIndex(property: string): boolean {
  const index = toArrayIndex(property);
  return index !== 2 ** 32 - 1 && String(index) === property;
}

// Project delegate to ECMAScript §7.1.9 ToUint32 for an array-index property name.
function toArrayIndex(property: string): number {
  return Number(property) >>> 0;
}
