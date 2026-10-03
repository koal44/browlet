import { InternalError } from '../../infra/index';
import { isObject } from '../../js-engine/index';

import type { WebIDLRealm } from '../environment';
import type {
  IDLCallbackFunctionType, IDLCallbackInterfaceType, AssembledCallbackFunction,
} from '../assembly/index';
import { IDLCallbackFunction, IDLCallbackInterface } from '../values/index';
import { getPlatformRecord } from '../binding/platform';
import { CallbackFunctionStamper } from '../binding/realm/callback';

import { Converter, type ConversionSteps } from './converter';

/** Capture an author function's realm and callback context for later invocation. */
export class CallbackFunctionConverter<Type extends IDLCallbackFunctionType = IDLCallbackFunctionType> extends Converter<Type> {
  // https://webidl.spec.whatwg.org/#es-callback-function
  protected createInputSteps(): ConversionSteps<IDLCallbackFunction> {
    const assembled = this.type.assembled;
    return (value) => {
      if (typeof value !== 'function') {
        return this.throwTypeError(`${assembled.primary.name} is not callable`);
      }
      return new IDLCallbackFunction(
        assembled, value, getCallbackRealm(value, this.realm), this.realm.callbacks.captureContext(), this.binding.callbacks,
      );
    };
  }

  protected override createOutputSteps(): ConversionSteps<object> {
    return (value) => {
      if (typeof value === 'function') return CallbackFunctionStamper.getObject(value);
      if (IDLCallbackFunction.is(value)) return value.object;
      throw new InternalError(`IDL callback function ${this.type.assembled.primary.name} is not callable`);
    };
  }

  /** Prepare the nullable legacy attribute rule without altering the shared ordinary converter. */
  // https://webidl.spec.whatwg.org/#js-to-nullable
  static createAttributeSteps(converter: Converter, assembled: AssembledCallbackFunction): ConversionSteps {
    return (value) => {
      if (!isObject(value)) return null;
      try {
        return new IDLCallbackFunction(
          assembled, value, getCallbackRealm(value, converter.realm), converter.realm.callbacks.captureContext(), converter.binding.callbacks,
        );
      } catch (error) {
        return converter.throwConversionError(error);
      }
    };
  }
}

/** Capture an author callback object while leaving operation lookup until invocation. */
export class CallbackInterfaceConverter<Type extends IDLCallbackInterfaceType = IDLCallbackInterfaceType> extends Converter<Type> {
  protected createInputSteps(): ConversionSteps<IDLCallbackInterface> {
    const assembled = this.type.assembled;
    return (value) => {
      if (!isObject(value)) return this.throwTypeError(`${assembled.primary.name} is not an object`);
      return new IDLCallbackInterface(assembled, value, getCallbackRealm(value, this.realm), this.realm.callbacks.captureContext(), this.binding.callbacks);
    };
  }

  protected override createOutputSteps(): ConversionSteps<object> {
    return (value) => {
      if (!IDLCallbackInterface.is(value)) throw new InternalError(`Expected an IDL callback interface for ${this.type.assembled.primary.name}`);
      return value.object;
    };
  }
}

/** Select a callback object's realm without changing the conversion's allocation realm. */
export function getCallbackRealm(value: object, realm: WebIDLRealm): WebIDLRealm {
  return getPlatformRecord(value)?.realm ?? realm.callbacks.getAssociatedRealm(value);
}
