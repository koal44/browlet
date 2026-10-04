import { appendToMapList } from '../../infra/index';
import type {
  DictionaryDefinition, DictionaryMember, PartialDictionaryDefinition, Definition, DefaultValue,
  CallbackExceptionBehavior,
} from '../core/index';

import type { IDLType } from './types';
import { assembleMemberType } from './member';
import type { DefinitionAssembly, AssemblySteps } from './assembly';

/** A dictionary with its inherited and partial members in conversion order. */
export class AssembledDictionary {
  /** Original dictionary declaration before adding inherited and partial members. */
  primary: DictionaryDefinition;
  /** Partial declarations contributing additional dictionary members. */
  partials: PartialDictionaryDefinition[];
  /** Dictionary named by the primary declaration's inherits clause. */
  parentAssembled: AssembledDictionary | undefined;
  /** Conversion reads inherited members first, then lexicographically sorted own and partial members. */
  members: AssembledDictionaryMember[] = [];
  /** Whether required members and defaults guarantee every member is present after conversion. */
  hasCompleteShape = false;

  /** Members whose converted values may need unpacking or callback binding before implementation use. */
  #membersToConvert: AssembledDictionaryMember[] | undefined;

  constructor(primary: DictionaryDefinition, partials: PartialDictionaryDefinition[] = []) {
    this.primary = primary;
    this.partials = partials;
  }

  /** Get members that may need further conversion; primitives and sequences of primitives pass through. */
  getMembersToConvert(): AssembledDictionaryMember[] {
    return this.#membersToConvert ??= this.members.filter((member) => !member.type.canPassToImpl);
  }
}

/** A dictionary member with its conversion type prepared independently of its incoming value. */
export class AssembledDictionaryMember {
  /** Property name read from the incoming dictionary object. */
  name: string;
  /** Conversion descriptor including applicable member attributes. */
  type: IDLType;
  /** Whether conversion rejects an absent or undefined member. */
  required: boolean;
  /** IDL default used when the supplied value is undefined. */
  default?: DefaultValue;
  /** Exception policy overriding the dictionary's fallback for this callback member. */
  callbackExceptionBehavior?: CallbackExceptionBehavior;

  constructor(member: DictionaryMember, assembly: DefinitionAssembly) {
    this.name = member.name;
    this.type = assembly.getIDLType(assembleMemberType(member.type, member.extendedAttributes));
    this.required = member.required === true;
    this.default = member.default;
    this.callbackExceptionBehavior = member.callbackExceptionBehavior;
  }
}

/** Assemble dictionary fragments and inheritance, indexed by IDL name. */
export class AssembledDictionaries extends Map<string, AssembledDictionary> {
  constructor(definitions: Definition[], finish: AssemblySteps[]) {
    super();
    const partialsByName = new Map<string, PartialDictionaryDefinition[]>();
    for (const definition of definitions) {
      if (definition.kind === 'partial-dictionary') appendToMapList(partialsByName, definition.name, definition);
    }
    for (const definition of definitions) {
      if (definition.kind === 'dictionary') {
        this.set(definition.name, new AssembledDictionary(definition, partialsByName.get(definition.name)));
      }
    }
    for (const assembled of this.values()) {
      const { inherits } = assembled.primary;
      if (inherits) assembled.parentAssembled = this.get(inherits)!;
    }

    finish.push((assembly) => {
      const visited = new Set<AssembledDictionary>();
      for (const assembled of this.values()) assembleDictionary(assembled, visited, assembly);
    });
  }
}

// https://webidl.spec.whatwg.org/#js-dictionary
function assembleDictionary(
  assembled: AssembledDictionary,
  visited: Set<AssembledDictionary>,
  assembly: DefinitionAssembly,
): void {
  if (visited.has(assembled)) return;
  visited.add(assembled);

  const definition = assembled.primary;
  if (assembled.parentAssembled) assembleDictionary(assembled.parentAssembled, visited, assembly);

  const members = [...definition.members];
  for (const partial of assembled.partials) {
    for (const member of partial.members) members.push(member);
  }
  // Web IDL identifiers are ASCII, so code-unit and code-point order coincide.
  members.sort((left, right) => {
    if (left.name < right.name) return -1;
    if (left.name > right.name) return 1;
    return 0;
  });
  if (assembled.parentAssembled) {
    for (const member of assembled.parentAssembled.members) assembled.members.push(member);
  }
  for (const member of members) assembled.members.push(new AssembledDictionaryMember(member, assembly));
  assembled.hasCompleteShape = assembled.members.every((member) =>
    member.required || member.default !== undefined);
}
