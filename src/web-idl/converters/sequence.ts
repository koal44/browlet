import { InternalError } from '../../infra/index';
import { defineDataProperty, getMethod, isObject, type JSMethod } from '../../js-engine/index';

import type { IDLSequenceType, IDLFrozenArrayType } from '../assembly/index';
import type { IDLSequence } from '../values/index';
import { Converter, type ConversionSteps } from './converter';

/** Convert iterable elements and allocate author arrays in the selected realm. */
export class SequenceConverter<Type extends IDLSequenceType | IDLFrozenArrayType = IDLSequenceType> extends Converter<Type> {
  /** Reused element conversion with its own annotations and this converter's realm. */
  #element?: Converter;

  protected get element(): Converter {
    return this.#element ??= this.forType(this.type.elementType);
  }

  // https://webidl.spec.whatwg.org/#es-sequence
  protected createInputSteps(): ConversionSteps<readonly unknown[]> {
    const description = this.type.kind === 'frozen-array' ? 'frozen array' : 'sequence';
    return (value) => {
      if (!isObject(value)) this.throwTypeError(`A ${description} value must be an object`);
      const method = getMethod(value, Symbol.iterator, this.realm);
      if (!method) this.throwTypeError('Value is not iterable');
      return this.readIterable(value, method);
    };
  }

  /** Enter conversion using the iterator method already selected by overload or union resolution. */
  // https://webidl.spec.whatwg.org/#create-sequence-from-iterable
  jsToIDLIterable(iterable: object, iteratorMethod: JSMethod): readonly unknown[] {
    try { return this.readIterable(iterable, iteratorMethod); }
    catch (error) { return this.throwConversionError(error); }
  }

  protected readIterable(iterable: object, iteratorMethod: JSMethod): readonly unknown[] {
    const convert = this.element.inputSteps;
    const iterator = Reflect.apply(iteratorMethod, iterable, []);
    if (!isObject(iterator)) this.throwTypeError('Iterator method did not return an object');
    const nextMethod = getMethod(iterator, 'next', this.realm);
    if (!nextMethod) this.throwTypeError('Iterator has no next method');
    const sequence: IDLSequence = [];
    while (true) {
      const result = Reflect.apply(nextMethod, iterator, []);
      if (!isObject(result)) this.throwTypeError('Iterator result is not an object');
      const iteration = result as { done?: unknown; value?: unknown; };
      if (iteration.done) return sequence;
      sequence.push(convert(iteration.value));
    }
  }

  protected override createOutputSteps(): ConversionSteps<unknown[]> {
    const convert = this.element.getIDLToJSSteps();
    return (value) => {
      if (!Array.isArray(value)) throw new InternalError('IDL sequence is not an array');
      const result: unknown[] = new this.realm.intrinsics.array();
      for (let i = 0; i < value.length; i++) defineDataProperty(result, String(i), convert(value[i]));
      return result;
    };
  }
}

/** A frozen-array input projects converted elements immediately; output preserves that array. */
export class FrozenArrayConverter<Type extends IDLFrozenArrayType = IDLFrozenArrayType> extends SequenceConverter<Type> {
  /** Element projection used to create each incoming frozen array. */
  #project?: ConversionSteps<unknown[]>;

  /** Project converted sequence entries into an array in this realm, then freeze it. */
  // https://webidl.spec.whatwg.org/#dfn-create-frozen-array
  createFrozenArray(values: readonly unknown[]): readonly unknown[] {
    const project = this.#project ??= super.createOutputSteps();
    return Object.freeze(project(values));
  }

  // https://webidl.spec.whatwg.org/#create-frozen-array-from-iterable
  protected override readIterable(iterable: object, iteratorMethod: JSMethod): readonly unknown[] {
    return this.createFrozenArray(super.readIterable(iterable, iteratorMethod));
  }

  protected override createOutputSteps(): ConversionSteps<unknown[]> {
    return (value) => value as unknown[];
  }
}
