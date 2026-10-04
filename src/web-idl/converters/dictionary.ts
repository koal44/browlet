import { InternalError } from '../../infra/index';
import { defineDataProperty, isObject } from '../../js-engine/index';

import type { WebIDLRealm } from '../environment';
import type { IDLDictionaryType } from '../assembly/index';
import { IDLDictionary } from '../values/index';
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
    const members = assembled.members.map((member) => {
      const converter = this.binding.getConverter(member.type, this.realm);
      return {
        member,
        converter,
        convert: converter.getInputSteps(),
        getDefault: member.default === undefined
            ? undefined
            : converter.createDefaultSteps(member.default),
      };
    });
    // Required/defaulted members always exist after successful conversion. Copy
    // their layout together; sparse dictionaries only create present properties.
    const complete = assembled.hasCompleteShape;
    const template: Record<string, unknown> = {};
    if (complete) {
      for (const { member } of members) defineDataProperty(template, member.name, undefined);
    }
    // Nested dictionaries defer their own member preparation until invocation,
    // so recursive references can reuse the converter without expanding here.
    return (value) => {
      if (!isObject(value) && value !== undefined && value !== null) {
        throw new this.realm.intrinsics.typeError('A dictionary value must be an object');
      }
      const record: Record<string, unknown> = complete ? { ...template } : {};
      const entries: [string, unknown][] | undefined = complete ? undefined : [];
      for (const { member, converter, convert, getDefault } of members) {
        const memberValue = value === undefined || value === null
            ? undefined
            : (value as Record<string, unknown>)[member.name];
        let converted: unknown;
        if (memberValue !== undefined) {
          converted = convert(memberValue);
        } else if (getDefault) {
          converted = getDefault();
        } else if (member.required) {
          converter.throwTypeError(`Required dictionary member ${member.name} is missing`);
        } else {
          continue;
        }
        if (entries) entries.push([member.name, converted]);
        else record[member.name] = converted;
      }
      // Object.fromEntries creates sparse own properties together, without
      // inherited setters or deleting absent fields from the complete layout.
      return new IDLDictionary(entries ? Object.fromEntries(entries) : record);
    };
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
