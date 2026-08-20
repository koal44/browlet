import {
  createObservableArray, type ObservableArrayHandle,
} from '../shared/observable-array';
import {
  convertToIDL, convertToJavaScript, type ConversionContext,
  type IDLSequenceValue,
} from './conversion';
import {
  idlType, sequence, type AttributeMember, type WebIDLType,
} from './definition';
import type { ImplementationRegistry } from './implementation';

export class ObservableArrayBinding {
  readonly #context: ConversionContext;
  readonly #implementations: ImplementationRegistry;
  #objects = new WeakMap<
    object,
    WeakMap<AttributeMember, ObservableArrayHandle<unknown, unknown>>
  >();

  constructor(
    context: ConversionContext,
    implementations: ImplementationRegistry,
  ) {
    this.#context = context;
    this.#implementations = implementations;
  }

  get(
    object: object,
    attribute: AttributeMember,
    elementType: WebIDLType,
  ): unknown[] {
    return this.#getHandle(object, attribute, elementType).value;
  }

  getBackingList(
    object: object,
    attribute: AttributeMember,
    elementType: WebIDLType,
  ): unknown[] {
    return this.#getHandle(object, attribute, elementType).backingList;
  }

  replace(
    object: object,
    attribute: AttributeMember,
    elementType: WebIDLType,
    value: unknown,
  ): void {
    const values = convertToIDL(
      value,
      sequence(elementType),
      this.#context,
    ) as IDLSequenceValue;
    this.#getHandle(object, attribute, elementType).replaceValues(values);
  }

  #getHandle(
    object: object,
    attribute: AttributeMember,
    elementType: WebIDLType,
  ): ObservableArrayHandle<unknown, unknown> {
    let attributes = this.#objects.get(object);
    if (!attributes) {
      attributes = new WeakMap();
      this.#objects.set(object, attributes);
    }

    const existing = attributes.get(attribute);
    if (existing) return existing;

    const steps = this.#implementations.getObservableArraySteps(attribute);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- steps are explicitly applied with the implementation object as their this value
    const deleteSteps = steps?.delete;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- steps are explicitly applied with the implementation object as their this value
    const setSteps = steps?.set;
    const handle = createObservableArray({
      array: this.#context.realm.intrinsics.array,
      convert: (value) => convertToIDL(value, elementType, this.#context),
      delete: deleteSteps
        ? (value, index) => Reflect.apply(
          deleteSteps,
          object,
          [value, index],
        )
        : undefined,
      rangeError: this.#context.realm.intrinsics.rangeError,
      set: setSteps
        ? (value, index) => Reflect.apply(
          setSteps,
          object,
          [value, index],
        )
        : undefined,
      toJavaScript: (value) => convertToJavaScript(
        value,
        elementType,
        this.#context,
      ),
      toNumber: (value) => convertToIDL(
        value,
        idlType.unrestrictedDouble,
        this.#context,
      ) as number,
    });
    attributes.set(attribute, handle);
    return handle;
  }
}
