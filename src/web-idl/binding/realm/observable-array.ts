import { createObservableArray, type ObservableArrayHandle } from '../../../infra/index';

import { idlType, type AttributeMember, type WebIDLType } from '../../core/index';

import type { PlatformRecord } from '../platform';
import type { RealmBinding } from '../realm';

export class ObservableArrayBinding {
  #binding: RealmBinding;

  // Project helper: retain the owning realm binding.
  constructor(binding: RealmBinding) {
    this.#binding = binding;
  }

  // Project helper: retrieve the platform value for an observable-array attribute.
  get(
    record: PlatformRecord,
    attribute: AttributeMember,
    elementType: WebIDLType,
  ): unknown[] {
    return this.#getHandle(record, attribute, elementType).value;
  }

  // Project helper: retrieve the observable-array attribute's retained backing list.
  getBackingList(
    record: PlatformRecord,
    attribute: AttributeMember,
    elementType: WebIDLType,
  ): unknown[] {
    return this.#getHandle(record, attribute, elementType).backingList;
  }

  // Extracted from Web IDL §3.7.6 Attributes — replace an observable array's contents in an attribute setter.
  replace(
    record: PlatformRecord,
    attribute: AttributeMember,
    elementType: WebIDLType,
    value: unknown,
  ): void {
    const values = this.#binding.getConverter(this.#binding.assembly.getSequenceType(elementType)).jsToIDL(value);
    this.#getHandle(record, attribute, elementType).replaceValues(values);
  }

  // Project adapter for Web IDL §3.10 Observable array exotic objects — compose conversion and mutation hooks
  // with Infra's backing list.
  #getHandle(
    record: PlatformRecord,
    attribute: AttributeMember,
    elementType: WebIDLType,
  ): ObservableArrayHandle<unknown, unknown> {
    let attributes = record.observableArrays;
    if (!attributes) {
      attributes = new Map();
      record.observableArrays = attributes;
    }

    const existing = attributes.get(attribute);
    if (existing) return existing;

    const inputConverter = this.#binding.getConverter(elementType);
    const outputConverter = record.binding.getConverter(elementType, this.#binding.realm);
    const steps = this.#binding.getMemberBinding(record.assembled, attribute)?.observableArraySteps;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- steps are explicitly applied with the implementation object as their this value
    const deleteSteps = steps?.delete;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- steps are explicitly applied with the implementation object as their this value
    const setSteps = steps?.set;
    const handle = createObservableArray({
      array: this.#binding.realm.intrinsics.array,
      convert: inputConverter.getJSToIDLSteps(),
      delete: deleteSteps
        ? (value, index) => Reflect.apply(
          deleteSteps,
          record.implInst,
          [value, index],
        )
        : undefined,
      rangeError: this.#binding.realm.intrinsics.rangeError,
      typeError: this.#binding.realm.intrinsics.typeError,
      set: setSteps
        ? (value, index) => Reflect.apply(
          setSteps,
          record.implInst,
          [value, index],
        )
        : undefined,
      toJavaScript: outputConverter.getIDLToJSSteps(),
      toNumber: this.#binding.getConverter(idlType.unrestrictedDouble).getJSToIDLSteps(),
    });
    attributes.set(attribute, handle);
    return handle;
  }
}

/** Implementation hooks run when an observable array element is set or removed. */
export type ObservableArraySteps = {
  delete?(this: object, value: unknown, index: number): void;
  set?(this: object, value: unknown, index: number): void;
};
