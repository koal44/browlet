import {
  createObservableArray, type ObservableArrayHandle,
} from '../infra/observable-array';
import {
  convertToIDL, convertToJavaScript, type ConversionContext,
  type IDLSequenceValue,
} from './conversion';
import {
  idlType, sequence, type AttributeMember, type WebIDLType,
} from './core/index';
import type { ImplementationRegistry } from './registry';

export class ObservableArrayBinding {
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

  // Project helper: retrieve the platform value for an observable-array attribute.
  get(
    object: object,
    attribute: AttributeMember,
    elementType: WebIDLType,
  ): unknown[] {
    return this.#getHandle(object, attribute, elementType).value;
  }

  // Project helper: retrieve the observable-array attribute's retained backing list.
  getBackingList(
    object: object,
    attribute: AttributeMember,
    elementType: WebIDLType,
  ): unknown[] {
    return this.#getHandle(object, attribute, elementType).backingList;
  }

  // Extracted from Web IDL §3.7.6 Attributes — replace an observable array's contents in an attribute setter.
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

  // Project adapter for Web IDL §3.10 Observable array exotic objects — compose conversion and mutation hooks
  // with Infra's backing list.
  #getHandle(
    object: object,
    attribute: AttributeMember,
    elementType: WebIDLType,
  ): ObservableArrayHandle<unknown, unknown> {
    const record = this.#context.platformObjects.getImplementationRecord(
      object,
    );
    if (!record) throw new Error('Observable array object is not associated');

    let attributes = record.observableArrays;
    if (!attributes) {
      attributes = new WeakMap();
      record.observableArrays = attributes;
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
      typeError: this.#context.realm.intrinsics.typeError,
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
