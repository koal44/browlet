import { InternalError } from '../../infra/index';

import { isObject } from '../../js-engine/index';

import type { WebIDLType } from '../core/index';

import type { AssembledInterface } from '../assembled';
import type { ConversionRules } from '../assembly';
import { Converter, type ConversionSteps } from './converter';
import type { WebIDLRealm } from '../environment';

import { getPlatformRecord } from '../binding/platform';
import type { RealmBinding } from '../binding/realm';

/** Unwrap and project values of one assembled interface. */
export class InterfaceConverter<Type extends WebIDLType = WebIDLType> extends Converter<Type> {
  /** Declaration selected once when this converter is created. */
  assembled: AssembledInterface;

  constructor(rules: ConversionRules<Type>, binding: RealmBinding, realm: WebIDLRealm, assembled: AssembledInterface) {
    super(rules, binding, realm);
    this.assembled = assembled;
  }

  // https://webidl.spec.whatwg.org/#es-interface
  protected createInputSteps(): ConversionSteps<object> {
    const assembled = this.assembled;
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
    const assembled = this.assembled;
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
