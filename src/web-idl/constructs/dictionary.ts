import { defineDataProperty, isObject } from '../../js-engine/index';
import { InternalError } from '../../infra/internal-error';
import type { AssembledDictionary } from '../assembled';
import type { RealmBinding } from '../binding/realm';
import type { WebIDLRealm } from '../environment';
import type { ConversionContext } from '../conversion-context';
import {
  createJSToIDLValueConverter, createDefaultValueFactory, idlToJS, type ValueConverter,
} from '../conversion';

/** Converted dictionary members with the declaration needed for subsequent conversion. */
// https://webidl.spec.whatwg.org/#idl-dictionaries
// SPEC_MISMATCH: dictionary value = ordered map from member names to values
export class DictionaryCarrier {
  /** Declared member types, including members that may contain nested carriers. */
  assembled: AssembledDictionary;
  /** Converted member payload, consumed in place by implementation conversion. */
  record: Record<string, unknown>;

  constructor(assembled: AssembledDictionary, record: Record<string, unknown>) {
    this.assembled = assembled;
    this.record = record;
  }
}

/** Prepared author-to-IDL conversion for one dictionary in an allocation realm. */
export type DictionaryConverter = ValueConverter<DictionaryCarrier>;

/** Convert an author object using the binding's retained dictionary member converters. */
// https://webidl.spec.whatwg.org/#es-dictionary
export function jsToIDLDictionary(
  value: unknown,
  context: ConversionContext,
  assembled: AssembledDictionary,
): DictionaryCarrier {
  return context.binding.getDictionaryConverter(assembled, context.realm)(value);
}

/** Prepare member conversions once; each call reads the current author object. */
export function createDictionaryConverter(
  assembled: AssembledDictionary,
  binding: RealmBinding,
  realm: WebIDLRealm,
): DictionaryConverter {
  const members = assembled.members.map((member) => {
    const context = binding.getConversionContext(member.type, realm);
    return {
      member,
      context,
      convert: createJSToIDLValueConverter(context),
      getDefault: member.primary.default === undefined
        ? undefined
        : createDefaultValueFactory(member.primary.default),
    };
  });
  // Required/defaulted members always exist after successful conversion. Copy
  // their layout together; sparse dictionaries only create present properties.
  const complete = members.every(({ member, getDefault }) => member.primary.required || getDefault);
  const template: Record<string, unknown> = {};
  if (complete) {
    for (const { member } of members) defineDataProperty(template, member.name, undefined);
  }
  // Dictionary references defer to the binding's converter on invocation, so
  // recursive dictionaries do not recursively expand during preparation.
  return (value) => {
    if (!isObject(value) && value !== undefined && value !== null) {
      throw new realm.intrinsics.typeError('A dictionary value must be an object');
    }
    const record: Record<string, unknown> = complete ? { ...template } : {};
    const entries: [string, unknown][] | undefined = complete ? undefined : [];
    for (const { member, context, convert, getDefault } of members) {
      const memberValue = value === undefined || value === null
        ? undefined
        : (value as Record<string, unknown>)[member.name];
      let converted: unknown;
      if (memberValue !== undefined) {
        converted = convert(memberValue);
      } else if (getDefault) {
        converted = getDefault(context);
      } else if (member.primary.required) {
        context.throwTypeError(`Required dictionary member ${member.name} is missing`);
      } else {
        continue;
      }
      if (entries) entries.push([member.name, converted]);
      else record[member.name] = converted;
    }
    // Object.fromEntries creates sparse own properties together, without
    // inherited setters or deleting absent fields from the complete layout.
    return new DictionaryCarrier(assembled, entries ? Object.fromEntries(entries) : record);
  };
}

/** Project present dictionary members into a new object in the conversion realm. */
// https://webidl.spec.whatwg.org/#es-dictionary
export function idlToJSDictionary(
  value: unknown,
  context: ConversionContext,
  assembled: AssembledDictionary,
): object {
  if (!isObject(value)) {
    throw new InternalError(`IDL dictionary ${assembled.primary.name} is not an object`);
  }
  const members = value instanceof DictionaryCarrier ? value.record : value as Record<string, unknown>;

  const result = context.realm.createOrdinaryObject(
    context.realm.intrinsics.objectPrototype,
  );
  for (const member of assembled.members) {
    if (!Object.hasOwn(members, member.name)) continue;
    defineDataProperty(
      result,
      member.name,
      idlToJS(members[member.name], context.forType(member.type)),
    );
  }
  return result;
}
