import type { CallbackExceptionBehavior } from '../binding';
import type { DefaultValue, ExtendedAttribute, WebIDLType } from '../definition';

export type DictionaryDefinition = {
  kind: 'dictionary';
  name: string;
  members: DictionaryMember[];
  inherits?: string;
  extendedAttributes?: ExtendedAttribute[];
};

// Project builder for Web IDL §2.7 Dictionaries.
export function defineDictionary(
  definition: Omit<DictionaryDefinition, 'kind'>,
): DictionaryDefinition {
  return { kind: 'dictionary', ...definition };
}

export type PartialDictionaryDefinition = {
  kind: 'partial-dictionary';
  name: string;
  members: DictionaryMember[];
  extendedAttributes?: ExtendedAttribute[];
};

// Project builder for Web IDL §2.7 Dictionaries — partial dictionary definitions.
export function definePartialDictionary(
  definition: Omit<PartialDictionaryDefinition, 'kind'>,
): PartialDictionaryDefinition {
  return { kind: 'partial-dictionary', ...definition };
}

export type DictionaryMember = {
  name: string;
  type: WebIDLType;
  required?: boolean;
  default?: DefaultValue;
  extendedAttributes?: ExtendedAttribute[];
  // Project metadata: exception policy for a callback-valued member.
  callbackExceptionBehavior?: CallbackExceptionBehavior;
};

export type DictionaryMemberOptions = Omit<DictionaryMember, 'name' | 'type'>;

// Project builder for Web IDL §2.7 Dictionaries — dictionary members.
export function dictMember(
  name: string,
  type: WebIDLType,
  options: DictionaryMemberOptions = {},
): DictionaryMember {
  return { ...options, name, type };
}
