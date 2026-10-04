import { InternalError } from '../../infra/index';
import { defineDataProperty, isObject } from '../../js-engine/index';

import type { WebIDLRealm } from '../environment';
import type { IDLDictionaryType } from '../assembly/index';
import { IDLDictionary } from '../values/index';
import { compileSteps } from '../compiler';
import type { RealmBinding } from '../binding/realm';
import { Converter, type ConversionSteps } from './converter';

/** Prepare dictionary members once, sharing their plan across references in the same binding and realm. */
export class DictionaryConverter<Type extends IDLDictionaryType = IDLDictionaryType> extends Converter<Type> {
  /** Shared preparation is deferred so recursive dictionary references do not expand forever. */
  #plan: { input?: ConversionSteps<IDLDictionary>; output?: ConversionSteps<object>; };

  constructor(
    type: Type, binding: RealmBinding, realm: WebIDLRealm, shared?: DictionaryConverter,
  ) {
    super(type, binding, realm);
    this.#plan = shared ? shared.#plan : {};
  }

  // https://webidl.spec.whatwg.org/#es-dictionary
  protected createInputSteps(): ConversionSteps<IDLDictionary> {
    const plan = this.#plan;
    return (value) => (plan.input ??= this.#prepareInput())(value);
  }

  #prepareInput(): ConversionSteps<IDLDictionary> {
    const assembled = this.type.assembled;
    const dependencies: Record<string, unknown> = {
      IDLDictionary, isObject, TypeError: this.realm.intrinsics.typeError,
    };
    const complete = assembled.hasCompleteShape;
    const members = assembled.members.map((member, index) => {
      const converter = this.binding.getConverter(member.type, this.realm);
      dependencies[`convert${index}`] = converter.getInputSteps();
      if (member.default !== undefined) dependencies[`default${index}`] = converter.createDefaultSteps(member.default);
      const key = JSON.stringify(member.name);
      const missing = member.default !== undefined ? `converted${index} = default${index}();`
        : member.required ? `throw new TypeError(${JSON.stringify(`Required dictionary member ${member.name} is missing`)});`
        : '';
      // Each declared member gets its own read, conversion, and write sites.
      // Missing optional members never become own properties, including __proto__.
      return `
        const value${index} = value === undefined || value === null ? undefined : value[${key}];
        let converted${index};
        if (value${index} !== undefined) converted${index} = convert${index}(value${index});
        else { ${missing} }
        ${complete ? '' : `
          ${member.required || member.default !== undefined ? '' : `if (value${index} !== undefined)`}
          entries.push([${key}, converted${index}]);
        `}
      `;
    });
    const fields = complete ? assembled.members.map((member, index) =>
      `[${JSON.stringify(member.name)}]: converted${index}`).join(', ') : '';
    // Nested dictionaries keep their lazy entry steps, so recursion does not
    // expand during compilation. Mutable defaults still run per conversion.
    return compileSteps<ConversionSteps<IDLDictionary>>(`${assembled.primary.name}:dictionary-input`, dependencies,
      `function convertDictionary(value) {
        if (!isObject(value) && value !== undefined && value !== null) {
          throw new TypeError('A dictionary value must be an object');
        }
        ${complete ? '' : 'const entries = [];'}
        ${members.join('\n')}
        return new IDLDictionary(${complete ? `{${fields}}` : 'Object.fromEntries(entries)'});
      }`,
    );
  }

  protected override createOutputSteps(): ConversionSteps<object> {
    const plan = this.#plan;
    return (value) => (plan.output ??= this.#prepareOutput())(value);
  }

  #prepareOutput(): ConversionSteps<object> {
    const assembled = this.type.assembled;
    const members = assembled.members.map((member) => ({
      name: member.name,
      convert: this.binding.getConverter(member.type, this.realm).getIDLToJSSteps(),
    }));
    return (value) => {
      if (!isObject(value)) {
        throw new InternalError(`IDL dictionary ${assembled.primary.name} is not an object`);
      }
      const record = value instanceof IDLDictionary ? value.record : value as Record<string, unknown>;

      const result = this.realm.createOrdinaryObject(
        this.realm.intrinsics.objectPrototype,
      );
      for (const { name, convert } of members) {
        if (!Object.hasOwn(record, name)) continue;
        defineDataProperty(result, name, convert(record[name]));
      }
      return result;
    };
  }
}
