import { defineDataProperty, getMethod, isObject, type JSMethod } from '../../js-engine/index';
import { InternalError } from '../../infra/internal-error';
import type { ConversionContext } from '../conversion-context';
import { _jsToIDL, idlToJS } from '../conversion';

/** Converted sequence entries, before any nested carriers become implementation values. */
export type IDLSequence = unknown[];

/** Convert yielded JS values to IDL using the element context and the iterator method already read by the caller. */
// https://webidl.spec.whatwg.org/#create-sequence-from-iterable
export function jsToIDLSequence(
  iterable: object,
  elementContext: ConversionContext,
  iteratorMethod: JSMethod,
): IDLSequence {
  // Overload resolution enters here without jsToIDL's error boundary.
  try {
    const iterator = Reflect.apply(iteratorMethod, iterable, []);
    if (!isObject(iterator)) {
      elementContext.throwTypeError('Iterator method did not return an object');
    }

    const nextMethod = getMethod(iterator, 'next', elementContext.realm);
    if (!nextMethod) elementContext.throwTypeError('Iterator has no next method');

    const sequence: IDLSequence = [];
    while (true) {
      const result = Reflect.apply(nextMethod, iterator, []);
      if (!isObject(result)) {
        elementContext.throwTypeError('Iterator result is not an object');
      }
      const iteration = result as { done?: unknown; value?: unknown; };
      if (iteration.done) return sequence;
      sequence.push(_jsToIDL(iteration.value, elementContext));
    }
  } catch (error) {
    return elementContext.throwConversionError(error);
  }
}

/** Project converted sequence entries into an array in the element context's realm, then freeze it. */
// https://webidl.spec.whatwg.org/#dfn-create-frozen-array
export function createFrozenArray(
  values: IDLSequence,
  elementContext: ConversionContext,
): readonly unknown[] {
  return Object.freeze(idlToJSSequence(values, elementContext));
}

/** Convert yielded JS values into an IDL frozen array using the iterator method already read by the caller. */
// https://webidl.spec.whatwg.org/#create-frozen-array-from-iterable
export function jsToIDLFrozenArray(
  iterable: object,
  elementContext: ConversionContext,
  iteratorMethod: JSMethod,
): readonly unknown[] {
  return createFrozenArray(
    jsToIDLSequence(iterable, elementContext, iteratorMethod),
    elementContext,
  );
}

/** Project converted entries into a new array in the element context's realm. */
// https://webidl.spec.whatwg.org/#es-sequence
// The element context also lets frozen-array creation reuse sequence output conversion.
export function idlToJSSequence(
  value: unknown,
  elementContext: ConversionContext,
): unknown[] {
  if (!Array.isArray(value)) throw new InternalError('IDL sequence is not an array');

  const result = new elementContext.realm.intrinsics.array();
  for (let i = 0; i < value.length; i++) {
    defineDataProperty(
      result,
      String(i),
      idlToJS(value[i], elementContext),
    );
  }
  return result;
}
