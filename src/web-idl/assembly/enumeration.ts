import type { EnumerationDefinition, Definition } from '../core/index';

/** The strings listed in a Web IDL enum declaration. */
// https://webidl.spec.whatwg.org/#idl-enums
export class AssembledEnumeration {
  /** Original enum declaration and its complete list of string values. */
  primary: EnumerationDefinition;

  /** All declared strings, stored as a set for conversion membership checks. */
  #values: Set<string>;

  constructor(primary: EnumerationDefinition) {
    this.primary = primary;
    this.#values = new Set(primary.values);
  }

  /** Accept only strings declared by this enumeration. */
  hasValue(value: string): boolean {
    return this.#values.has(value);
  }
}

/** Index assembled enumerations by their IDL names. */
export class AssembledEnumerations extends Map<string, AssembledEnumeration> {
  constructor(definitions: Definition[]) {
    super();
    for (const definition of definitions) {
      if (definition.kind === 'enumeration') this.set(definition.name, new AssembledEnumeration(definition));
    }
  }
}
