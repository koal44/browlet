import { InternalError } from '../../infra/index';

import type { IDLObservableArrayType } from '../assembly/index';
import { Converter, type ConversionSteps } from './converter';

/** Observable arrays use attribute bindings instead of ordinary value conversion. */
// https://webidl.spec.whatwg.org/#js-observable-array
export class ObservableArrayConverter<Type extends IDLObservableArrayType = IDLObservableArrayType> extends Converter<Type> {
  protected createInputSteps(): ConversionSteps {
    return () => { throw new InternalError('Observable arrays must be handled by attribute bindings'); };
  }
  protected override createOutputSteps(): ConversionSteps { return this.createInputSteps(); }
}
