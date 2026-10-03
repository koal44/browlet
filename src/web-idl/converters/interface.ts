import { InternalError } from '../../infra/index';
import { isObject } from '../../js-engine/index';

import type { IDLInterfaceType } from '../assembly/index';
import { getPlatformRecord } from '../binding/platform';
import { Converter, type ConversionSteps } from './converter';

/** Unwrap and project values of one assembled interface. */
export class InterfaceConverter<Type extends IDLInterfaceType = IDLInterfaceType> extends Converter<Type> {
  // https://webidl.spec.whatwg.org/#es-interface
  protected createInputSteps(): ConversionSteps<object> {
    const assembled = this.type.assembled;
    return (value) => {
      const record = getPlatformRecord(value);
      if (
          record?.binding.world === this.binding.world &&
          record.implements(assembled)
      ) return record.implInst;
      return this.throwTypeError(`Value does not implement ${assembled.name}`);
    };
  }

  protected override createOutputSteps(): ConversionSteps<object> {
    const assembled = this.type.assembled;
    return (value) => {
      const object = isObject(value)
          ? this.binding.projectImplementationObject(value, assembled)
          : undefined;
      if (!object) {
        throw new InternalError(`IDL interface value ${assembled.name} is not an implementation target`);
      }
      return object;
    };
  }
}
