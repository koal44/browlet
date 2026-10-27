import { InternalError } from '../../../infra/index';

import type { IDLType, IDLAttribute } from '../../assembly/index';
import type { PlatformRecord } from '../platform';

import type { RealmBinding } from '../realm';
import { createObservableArray, type ObservableArrayHandle } from './observable-array-exotic';

/** Retains the platform arrays exposing each implementation's observable-array lists. */
export class ObservableArrayBinding {
  /** Realm whose attribute or array operation supplies conversion and exceptions. */
  #binding: RealmBinding;

  /** Retain the realm's conversion, allocation, and invocation machinery. */
  constructor(binding: RealmBinding) {
    this.#binding = binding;
  }

  /** Retrieve the receiver's retained array, independent of the getter's realm. */
  get(
    record: PlatformRecord,
    attribute: IDLAttribute,
    elementType: IDLType,
  ): unknown[] {
    return record.binding.observableArrays.#getHandle(record, attribute, elementType).value;
  }

  /** Convert the entire assignment before running mutation steps on the retained list. */
  // https://webidl.spec.whatwg.org/#dfn-attribute-setter
  replace(
    record: PlatformRecord,
    attribute: IDLAttribute,
    elementType: IDLType,
    value: unknown,
  ): void {
    const values = this.#binding.getConverter(this.#binding.assembly.getSequenceType(elementType)).jsToIDL(value);
    record.binding.observableArrays.#getHandle(record, attribute, elementType).replaceValues(values);
  }

  /** Read the implementation list once and retain its projected array and declared mutation steps. */
  // https://webidl.spec.whatwg.org/#es-observable-array
  #getHandle(
    record: PlatformRecord,
    attribute: IDLAttribute,
    elementType: IDLType,
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
    const member = this.#binding.getMemberBinding(record.assembled, attribute);
    if (!member?.attributeSteps) {
      throw new InternalError(`Observable array ${attribute.name} has no implementation getter`);
    }
    const backingList = member.attributeSteps.get(record) as unknown[];
    const steps = attribute.observableArraySteps;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- steps are explicitly applied with the implementation object as their this value
    const deleteSteps = steps?.delete;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- steps are explicitly applied with the implementation object as their this value
    const setSteps = steps?.set;
    const handle = createObservableArray({
      backingList,
      array: this.#binding.realm.Array,
      convert: inputConverter.getJSToIDLSteps(),
      delete: deleteSteps
        ? (value, index) => this.#binding.callImplementation(
          deleteSteps,
          record.implInst,
          [value, index],
        )
        : undefined,
      rangeError: this.#binding.realm.RangeError,
      typeError: this.#binding.realm.TypeError,
      set: setSteps
        ? (value, index) => this.#binding.callImplementation(
          setSteps,
          record.implInst,
          [value, index],
        )
        : undefined,
      toJavaScript: outputConverter.getIDLToJSSteps(),
      toNumber: this.#binding.getConverter(this.#binding.assembly.builtinTypes.unrestrictedDouble).getJSToIDLSteps(),
    });
    attributes.set(attribute, handle);
    return handle;
  }
}
