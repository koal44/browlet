import type {
  CallbackInterfaceDefinition, Definition, DictionaryDefinition, DictionaryMember,
  PartialDictionaryDefinition, IncludesDefinition, InterfaceDefinition, InterfaceMember,
  PartialInterfaceDefinition, InterfaceMixinDefinition, MixinMember,
  PartialInterfaceMixinDefinition, NamespaceDefinition, NamespaceMember, PartialNamespaceDefinition,
} from './core/declarations';

// Project helper: build our indexed representation of IDL definitions.
export function assembleDefinitions(
  definitions: Definition[],
): DefinitionAssembly {
  return new DefinitionAssembly(definitions);
}

export class DefinitionAssembly {
  #definitions = new Map<string, PrimaryDefinition>();
  #interfacePartials = new Map<string, PartialInterfaceDefinition[]>();
  #mixinPartials = new Map<string, PartialInterfaceMixinDefinition[]>();
  #namespacePartials = new Map<string, PartialNamespaceDefinition[]>();
  #dictionaryPartials = new Map<string, PartialDictionaryDefinition[]>();
  #includes = new Map<string, IncludesDefinition[]>();
  #interfaces = new Map<string, AssembledInterfaceDefinition>();
  #mixins = new Map<string, AssembledInterfaceMixinDefinition>();
  #namespaces = new Map<string, AssembledNamespaceDefinition>();
  #dictionaries = new Map<string, AssembledDictionaryDefinition>();

  // Project helper: index primary definitions, partials, and includes statements.
  constructor(definitions: Definition[]) {
    for (const definition of definitions) {
      switch (definition.kind) {
        case 'partial-interface':
          append(this.#interfacePartials, definition.name, definition);
          break;
        case 'partial-interface-mixin':
          append(this.#mixinPartials, definition.name, definition);
          break;
        case 'partial-namespace':
          append(this.#namespacePartials, definition.name, definition);
          break;
        case 'partial-dictionary':
          append(this.#dictionaryPartials, definition.name, definition);
          break;
        case 'includes':
          append(this.#includes, definition.interface, definition);
          break;
        default:
          this.#definitions.set(definition.name, definition);
      }
    }
  }

  // Project helper: look up a primary definition by name.
  getDefinition(name: string): PrimaryDefinition | undefined {
    return this.#definitions.get(name);
  }

  // Project helper: enumerate assembled interfaces.
  getInterfaces(): AssembledInterfaceDefinition[] {
    const interfaces: AssembledInterfaceDefinition[] = [];
    for (const definition of this.#definitions.values()) {
      if (definition.kind !== 'interface') continue;
      const primaryInterface = this.getInterface(definition.name);
      if (primaryInterface) interfaces.push(primaryInterface);
    }
    return interfaces;
  }

  // Project helper: assemble inheritance, partials, and included mixins.
  // Web IDL §2.2 Interfaces; §2.3 Interface mixins.
  getInterface(interfaceName: string): AssembledInterfaceDefinition | undefined {
    const existing = this.#interfaces.get(interfaceName);
    if (existing) return existing;

    const definition = this.#definitions.get(interfaceName);
    if (definition?.kind !== 'interface') return;

    const primaryInterface: AssembledInterfaceDefinition = {
      definition,
      includes: [],
      members: [],
      parent: undefined,
      partials: [...(this.#interfacePartials.get(interfaceName) ?? [])],
    };
    this.#interfaces.set(interfaceName, primaryInterface);

    if (definition.inherits) {
      primaryInterface.parent = this.getInterface(definition.inherits);
    }
    primaryInterface.includes = (this.#includes.get(interfaceName) ?? []).map(
      (include) => ({
        mixin: this.getInterfaceMixin(include.mixin),
        statement: include,
      }),
    );
    appendInterfaceMembers(primaryInterface.members, definition.members, definition);
    for (const partial of primaryInterface.partials) {
      appendInterfaceMembers(primaryInterface.members, partial.members, partial);
    }
    for (const { mixin } of primaryInterface.includes) {
      if (!mixin) continue;
      appendInterfaceMembers(
        primaryInterface.members,
        mixin.definition.members,
        mixin.definition,
      );
      for (const partial of mixin.partials) {
        appendInterfaceMembers(primaryInterface.members, partial.members, partial);
      }
    }

    return primaryInterface;
  }

  // Project helper: collect a mixin and its partials.
  // Web IDL §2.3 Interface mixins.
  getInterfaceMixin(name: string): AssembledInterfaceMixinDefinition | undefined {
    const existing = this.#mixins.get(name);
    if (existing) return existing;

    const definition = this.#definitions.get(name);
    if (definition?.kind !== 'interface-mixin') return;

    const assembled = {
      definition,
      partials: [...(this.#mixinPartials.get(name) ?? [])],
    };
    this.#mixins.set(name, assembled);
    return assembled;
  }

  // Project helper: look up a callback interface definition.
  getCallbackInterface(name: string): CallbackInterfaceDefinition | undefined {
    const definition = this.#definitions.get(name);
    return definition?.kind === 'callback-interface' ? definition : undefined;
  }

  // Project helper: enumerate callback interface definitions.
  getCallbackInterfaces(): CallbackInterfaceDefinition[] {
    const interfaces: CallbackInterfaceDefinition[] = [];
    for (const definition of this.#definitions.values()) {
      if (definition.kind === 'callback-interface') {
        interfaces.push(definition);
      }
    }
    return interfaces;
  }

  // Project helper: combine namespace members and retain their source definitions.
  // Web IDL §2.6 Namespaces — partial namespace definitions.
  getNamespace(name: string): AssembledNamespaceDefinition | undefined {
    const existing = this.#namespaces.get(name);
    if (existing) return existing;

    const definition = this.#definitions.get(name);
    if (definition?.kind !== 'namespace') return;

    const partials = [...(this.#namespacePartials.get(name) ?? [])];
    const assembled: AssembledNamespaceDefinition = {
      definition,
      members: [],
      partials,
    };
    appendNamespaceMembers(
      assembled.members,
      definition.members,
      definition,
    );
    for (const partial of partials) {
      appendNamespaceMembers(
        assembled.members,
        partial.members,
        partial,
      );
    }
    this.#namespaces.set(name, assembled);
    return assembled;
  }

  // Project helper: enumerate assembled namespaces.
  getNamespaces(): AssembledNamespaceDefinition[] {
    const namespaces: AssembledNamespaceDefinition[] = [];
    for (const definition of this.#definitions.values()) {
      if (definition.kind !== 'namespace') continue;
      const namespace = this.getNamespace(definition.name);
      if (namespace) namespaces.push(namespace);
    }
    return namespaces;
  }

  // Project helper: assemble dictionary members in specification order.
  // Web IDL §2.7 Dictionaries — inherited members first, then sorted own and partial members.
  getDictionary(name: string): AssembledDictionaryDefinition | undefined {
    const existing = this.#dictionaries.get(name);
    if (existing) return existing;

    const definition = this.#definitions.get(name);
    if (definition?.kind !== 'dictionary') return;

    const partials = [...(this.#dictionaryPartials.get(name) ?? [])];
    const assembled: AssembledDictionaryDefinition = {
      definition,
      members: [],
      parent: undefined,
      partials,
    };
    this.#dictionaries.set(name, assembled);

    if (definition.inherits) {
      assembled.parent = this.getDictionary(definition.inherits);
    }

    const members = [...definition.members];
    for (const partial of partials) members.push(...partial.members);
    members.sort(compareDictionaryMembers);
    assembled.members = [
      ...(assembled.parent?.members ?? []),
      ...members,
    ];

    return assembled;
  }
}

export type AssembledInterfaceDefinition = {
  definition: InterfaceDefinition;
  parent: AssembledInterfaceDefinition | undefined;
  partials: PartialInterfaceDefinition[];
  includes: IncludedMixin[];
  members: AssembledInterfaceMember[];
};

export type AssembledInterfaceMember = {
  member: InterfaceMember | MixinMember;
  source:
    | InterfaceDefinition
    | PartialInterfaceDefinition
    | InterfaceMixinDefinition
    | PartialInterfaceMixinDefinition;
};

export type IncludedMixin = {
  mixin: AssembledInterfaceMixinDefinition | undefined;
  statement: IncludesDefinition;
};

export type AssembledInterfaceMixinDefinition = {
  definition: InterfaceMixinDefinition;
  partials: PartialInterfaceMixinDefinition[];
};

export type AssembledNamespaceDefinition = {
  definition: NamespaceDefinition;
  partials: PartialNamespaceDefinition[];
  members: AssembledNamespaceMember[];
};

export type AssembledNamespaceMember = {
  member: NamespaceMember;
  source: NamespaceDefinition | PartialNamespaceDefinition;
};

export type AssembledDictionaryDefinition = {
  definition: DictionaryDefinition;
  parent: AssembledDictionaryDefinition | undefined;
  partials: PartialDictionaryDefinition[];
  members: DictionaryMember[];
};

export type PrimaryDefinition = Exclude<
  Definition,
  | PartialInterfaceDefinition
  | PartialInterfaceMixinDefinition
  | PartialNamespaceDefinition
  | PartialDictionaryDefinition
  | IncludesDefinition
>;

// Project helper for Web IDL §2.7 Dictionaries — lexicographic dictionary member order.
function compareDictionaryMembers(
  left: DictionaryMember,
  right: DictionaryMember,
): number {
  // Web IDL identifiers are ASCII, so code-unit and code-point order coincide.
  if (left.name < right.name) return -1;
  if (left.name > right.name) return 1;
  return 0;
}

// Project helper: append a definition to a named group.
function append<Value>(
  values: Map<string, Value[]>,
  name: string,
  value: Value,
): void {
  const existing = values.get(name);
  if (existing) existing.push(value);
  else values.set(name, [value]);
}

// Project helper: retain the source definition alongside each interface member.
function appendInterfaceMembers(
  target: AssembledInterfaceMember[],
  members: (InterfaceMember | MixinMember)[],
  source: AssembledInterfaceMember['source'],
): void {
  for (const member of members) target.push({ member, source });
}

// Project helper: retain the source definition alongside each namespace member.
function appendNamespaceMembers(
  target: AssembledNamespaceMember[],
  members: NamespaceMember[],
  source: NamespaceDefinition | PartialNamespaceDefinition,
): void {
  for (const member of members) target.push({ member, source });
}
