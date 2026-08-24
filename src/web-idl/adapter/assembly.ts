import type {
  CallbackInterfaceDefinition, Definition, DictionaryDefinition,
  DictionaryMember, IncludesDefinition, InterfaceDefinition,
  InterfaceMember, InterfaceMixinDefinition, MixinMember,
  NamespaceDefinition, NamespaceMember,
  PartialDictionaryDefinition, PartialInterfaceDefinition,
  PartialInterfaceMixinDefinition, PartialNamespaceDefinition,
} from './definition';

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
  #interfaces = new Map<string, AssembledInterface>();
  #mixins = new Map<string, AssembledInterfaceMixin>();
  #namespaces = new Map<string, AssembledNamespace>();
  #dictionaries = new Map<string, AssembledDictionary>();

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

  getDefinition(name: string): PrimaryDefinition | undefined {
    return this.#definitions.get(name);
  }

  getInterfaces(): AssembledInterface[] {
    const interfaces: AssembledInterface[] = [];
    for (const definition of this.#definitions.values()) {
      if (definition.kind !== 'interface') continue;
      const interface_ = this.getInterface(definition.name);
      if (interface_) interfaces.push(interface_);
    }
    return interfaces;
  }

  getInterface(name: string): AssembledInterface | undefined {
    const existing = this.#interfaces.get(name);
    if (existing) return existing;

    const definition = this.#definitions.get(name);
    if (definition?.kind !== 'interface') return;

    const assembled: AssembledInterface = {
      definition,
      includes: [],
      members: [],
      parent: undefined,
      partials: [...(this.#interfacePartials.get(name) ?? [])],
    };
    this.#interfaces.set(name, assembled);

    if (definition.inherits) {
      assembled.parent = this.getInterface(definition.inherits);
    }
    assembled.includes = (this.#includes.get(name) ?? []).map(
      (include) => ({
        mixin: this.getInterfaceMixin(include.mixin),
        statement: include,
      }),
    );
    appendInterfaceMembers(assembled.members, definition.members, definition);
    for (const partial of assembled.partials) {
      appendInterfaceMembers(assembled.members, partial.members, partial);
    }
    for (const { mixin } of assembled.includes) {
      if (!mixin) continue;
      appendInterfaceMembers(
        assembled.members,
        mixin.definition.members,
        mixin.definition,
      );
      for (const partial of mixin.partials) {
        appendInterfaceMembers(assembled.members, partial.members, partial);
      }
    }

    return assembled;
  }

  getInterfaceMixin(name: string): AssembledInterfaceMixin | undefined {
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

  getCallbackInterface(name: string): CallbackInterfaceDefinition | undefined {
    const definition = this.#definitions.get(name);
    return definition?.kind === 'callback-interface' ? definition : undefined;
  }

  getCallbackInterfaces(): CallbackInterfaceDefinition[] {
    const interfaces: CallbackInterfaceDefinition[] = [];
    for (const definition of this.#definitions.values()) {
      if (definition.kind === 'callback-interface') {
        interfaces.push(definition);
      }
    }
    return interfaces;
  }

  getNamespace(name: string): AssembledNamespace | undefined {
    const existing = this.#namespaces.get(name);
    if (existing) return existing;

    const definition = this.#definitions.get(name);
    if (definition?.kind !== 'namespace') return;

    const partials = [...(this.#namespacePartials.get(name) ?? [])];
    const assembled: AssembledNamespace = {
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

  getNamespaces(): AssembledNamespace[] {
    const namespaces: AssembledNamespace[] = [];
    for (const definition of this.#definitions.values()) {
      if (definition.kind !== 'namespace') continue;
      const namespace = this.getNamespace(definition.name);
      if (namespace) namespaces.push(namespace);
    }
    return namespaces;
  }

  getDictionary(name: string): AssembledDictionary | undefined {
    const existing = this.#dictionaries.get(name);
    if (existing) return existing;

    const definition = this.#definitions.get(name);
    if (definition?.kind !== 'dictionary') return;

    const partials = [...(this.#dictionaryPartials.get(name) ?? [])];
    const assembled: AssembledDictionary = {
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

export type AssembledInterface = {
  definition: InterfaceDefinition;
  parent: AssembledInterface | undefined;
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
  mixin: AssembledInterfaceMixin | undefined;
  statement: IncludesDefinition;
};

export type AssembledInterfaceMixin = {
  definition: InterfaceMixinDefinition;
  partials: PartialInterfaceMixinDefinition[];
};

export type AssembledNamespace = {
  definition: NamespaceDefinition;
  partials: PartialNamespaceDefinition[];
  members: AssembledNamespaceMember[];
};

export type AssembledNamespaceMember = {
  member: NamespaceMember;
  source: NamespaceDefinition | PartialNamespaceDefinition;
};

export type AssembledDictionary = {
  definition: DictionaryDefinition;
  parent: AssembledDictionary | undefined;
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

function compareDictionaryMembers(
  left: DictionaryMember,
  right: DictionaryMember,
): number {
  // Web IDL identifiers are ASCII, so code-unit and code-point order coincide.
  if (left.name < right.name) return -1;
  if (left.name > right.name) return 1;
  return 0;
}

function append<Value>(
  values: Map<string, Value[]>,
  name: string,
  value: Value,
): void {
  const existing = values.get(name);
  if (existing) existing.push(value);
  else values.set(name, [value]);
}

function appendInterfaceMembers(
  target: AssembledInterfaceMember[],
  members: (InterfaceMember | MixinMember)[],
  source: AssembledInterfaceMember['source'],
): void {
  for (const member of members) target.push({ member, source });
}

function appendNamespaceMembers(
  target: AssembledNamespaceMember[],
  members: NamespaceMember[],
  source: NamespaceDefinition | PartialNamespaceDefinition,
): void {
  for (const member of members) target.push({ member, source });
}
