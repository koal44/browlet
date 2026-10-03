import { InternalError, InternalPromise } from '../../infra/index';

import type { IDLType, IDLPromiseType } from '../assembly/index';
import { IDLPromise, waitForAll } from '../values/index';
import { Converter, type ConversionSteps } from './converter';

/** Adopt author promises and expose promises with the declared fulfillment conversion. */
// https://webidl.spec.whatwg.org/#es-promise
export class PromiseConverter<Type extends IDLPromiseType = IDLPromiseType> extends Converter<Type> {
  /** Project an IDL fulfillment value and resolve a new promise in the converter's realm. */
  // https://webidl.spec.whatwg.org/#js-promise-manipulation
  static fromIDL(value: unknown, converter: Converter): IDLPromise {
    const promise = new IDLPromise(converter.type, converter.realm, converter.binding.realizeException);
    const jsValue = IDLPromise.is(value) ? value.promise : converter.idlToJS(value);
    promise.resolve(jsValue);
    return promise;
  }

  /** Collect promise results and project the aggregate through its declared sequence type. */
  // https://webidl.spec.whatwg.org/#waiting-for-all-promise
  static getPromiseForWaitingForAll(
    promises: IDLPromise[],
    type: IDLType,
    converter: Converter,
  ): IDLPromise {
    const promise = new IDLPromise(converter.binding.assembly.getSequenceType(type), converter.realm, converter.binding.realizeException);
    waitForAll(
      promises,
      (values) => {
        const jsValues = converter.binding.getConverter(promise.type, converter.realm).idlToJS(values);
        promise.resolve(jsValues);
      },
      (reason) => promise.reject(reason),
      converter.realm,
    );
    return promise;
  }

  protected createInputSteps(): ConversionSteps<IDLPromise> {
    const type = this.type.resultType;
    return (value) => IDLPromise.fromJS(value, type, this.realm, this.binding.realizeException);
  }

  protected override createOutputSteps(): ConversionSteps<Promise<unknown>> {
    return (value) => {
      if (IDLPromise.is(value)) return value.promise;
      if (value instanceof InternalPromise) {
        const type = this.type;
        const assembly = this.binding.assembly;
        if (
            value.type.kind === 'implementation' ||
            assembly.getConversionTypeKey(assembly.getPromiseResultType(value.type)) !==
            assembly.getConversionTypeKey(type.resultType)
        ) {
          throw new InternalError('Promise result type does not match its Web IDL declaration');
        }
        return value.backing;
      }
      throw new InternalError('Expected a declared Promise result');
    };
  }
}
