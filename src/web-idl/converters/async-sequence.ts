import { InternalError } from '../../infra/index';
import { getMethod, isObject } from '../../js-engine/index';

import type { IDLAsyncSequenceType } from '../assembly/index';
import { IDLAsyncSequence } from '../values/index';
import { Converter, type ConversionSteps } from './converter';

/** Capture the selected iteration method without opening or advancing the iterator. */
export class AsyncSequenceConverter<Type extends IDLAsyncSequenceType = IDLAsyncSequenceType> extends Converter<Type> {
  // https://webidl.spec.whatwg.org/#js-to-async-iterable
  protected createInputSteps(): ConversionSteps<IDLAsyncSequence> {
    const type = this.type;
    const { realm } = this;
    return (value) => {
      if (!isObject(value)) {
        throw new realm.intrinsics.typeError(
          'An async sequence value must be an object',
        );
      }

      const asyncMethod = getMethod(value, Symbol.asyncIterator, realm);
      if (asyncMethod) {
        return new IDLAsyncSequence(value, type.elementType, asyncMethod, 'async');
      }
      const syncMethod = getMethod(value, Symbol.iterator, realm);
      if (!syncMethod) {
        throw new realm.intrinsics.typeError('Value is not asynchronously iterable');
      }
      return new IDLAsyncSequence(value, type.elementType, syncMethod, 'sync');
    };
  }

  protected override createOutputSteps(): ConversionSteps<object> {
    return (value) => {
      if (!IDLAsyncSequence.is(value)) throw new InternalError('Expected an IDL async sequence');
      return value.object;
    };
  }
}
