import { InternalError } from '../../infra/index';

import { toString } from '../../js-engine/index';

import type { WebIDLType } from '../core/index';

import type { AssembledEnumeration, AssembledProxyObject } from '../assembled';
import type { ConversionRules } from '../assembly';
import { Converter, type ConversionSteps } from './converter';
import type { WebIDLRealm } from '../environment';

import type { RealmBinding } from '../binding/realm';

/** Coerce an enum value to a string and check the assembled declaration's membership set. */
export class EnumerationConverter<Type extends WebIDLType = WebIDLType> extends Converter<Type> {
  /** Declaration selected once when this converter is created. */
  assembled: AssembledEnumeration;

  constructor(rules: ConversionRules<Type>, binding: RealmBinding, realm: WebIDLRealm, assembled: AssembledEnumeration) {
    super(rules, binding, realm);
    this.assembled = assembled;
  }

  // https://webidl.spec.whatwg.org/#es-enumeration
  protected createInputSteps(): ConversionSteps<string> {
    const assembled = this.assembled;
    return (value) => {
      const string = toString(value);
      if (!assembled.hasValue(string)) {
        this.throwTypeError(`${string} is not a value of ${assembled.primary.name}`);
      }
      return string;
    };
  }
}

/** Preserve recognized proxy objects, such as a WindowProxy. */
export class ProxyObjectConverter<Type extends WebIDLType = WebIDLType> extends Converter<Type> {
  /** Declaration selected once when this converter is created. */
  assembled: AssembledProxyObject;

  constructor(rules: ConversionRules<Type>, binding: RealmBinding, realm: WebIDLRealm, assembled: AssembledProxyObject) {
    super(rules, binding, realm);
    this.assembled = assembled;
  }

  protected createInputSteps(): ConversionSteps {
    const assembled = this.assembled;
    return (value) => assembled.is(value) ? value : this.throwTypeError(`Value does not implement ${assembled.primary.name}`);
  }

  protected override createOutputSteps(): ConversionSteps {
    const assembled = this.assembled;
    return (value) => {
      if (assembled.is(value)) return value;
      throw new InternalError(`IDL interface value does not implement ${assembled.primary.name}`);
    };
  }
}

/** Defer unsupported-type diagnostics until a conversion is actually requested. */
export class UnsupportedConverter<Type extends WebIDLType = WebIDLType> extends Converter<Type> {
  /** Diagnostic selected while resolving the declared type. */
  #message: string;

  constructor(rules: ConversionRules<Type>, binding: RealmBinding, realm: WebIDLRealm, message: string) {
    super(rules, binding, realm);
    this.#message = message;
  }

  protected createInputSteps(): ConversionSteps { return () => { throw new InternalError(this.#message); }; }
  protected override createOutputSteps(): ConversionSteps { return this.createInputSteps(); }
}
