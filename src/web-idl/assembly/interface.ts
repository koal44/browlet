import { InternalError, appendToMapList } from '../../infra/index';
import {
  hasExtendedAttribute, type PrimaryInterfaceDefinition, type PartialInterfaceDefinition,
  type InterfaceMixinDefinition, type PartialInterfaceMixinDefinition, type Definition, type IncludesDefinition,
  type ImplementationClass, type SerialSteps, type TransferSteps,
} from '../core/index';

import type { WebIDLRealm } from '../environment';

import { IDLInterfaceType } from './types';
import { matchesExposure } from './exposure';
import {
  AssembledCallable, AssembledArgument, AssembledOverloads, assembleMember, groupOperations, belongsAt,
  type IDLAttribute, type IDLOperation, type IDLConstructor, type IDLMaplike, type IDLSetlike,
  type IDLNamedArguments, type IDLInterfaceMember, type MemberPlacement, type AttributeEntry,
  type OperationFilter,
} from './member';
import type { AssembledNamespaceMember } from './namespace';
import type { DefinitionAssembly, AssemblySteps } from './assembly';

/** An interface with its parent, partial declarations, and included mixin members. */
export class AssembledInterface {
  /** The original interface declaration, before applying partials and mixins. */
  primary: PrimaryInterfaceDefinition;
  /** IDL name used for interface lookup and diagnostics. */
  name: string;
  /** Partial declarations retain their own exposure and other extended attributes. */
  partials: PartialInterfaceDefinition[];
  /** The assembled parent named by the primary declaration's inherits clause. */
  parentAssembled: AssembledInterface | undefined;
  /** Own, partial, and included mixin members; inherited members remain on the parent interface. */
  members: AssembledInterfaceMember[] = [];
  /** Serialization steps for this exact interface, including any inherited state. */
  serialSteps: SerialSteps | undefined;
  /** Transfer steps for this exact interface. */
  transferSteps: TransferSteps | undefined;

  /** Compiled interface type reused for implementation-class references. */
  type: IDLInterfaceType;

  /** Legacy factory declarations grouped by exposed name, with overloads prepared on first use. */
  #legacyFactoriesByName = new Map<string, {
    callables: IDLNamedArguments[];
    overloads?: AssembledOverloads<IDLNamedArguments>;
  }>();

  /** Oldest ancestor through this interface, retained after the first inheritance query. */
  #inheritanceChain: AssembledInterface[] | undefined;
  /** Primary declarations supplied by this interface and its ancestors. */
  #implementedPrimaries: Set<PrimaryInterfaceDefinition> | undefined;
  /** Member identities contributed by this interface, its mixins, and its ancestors. */
  #includedMembers: Set<IDLInterfaceMember> | undefined;
  /** Nearest matching ancestor attribute for each queried inherited accessor. */
  #inheritedAttributes = new Map<IDLAttribute, IDLAttribute>();
  /** Own maplike/setlike declaration; undefined is unexamined and null means absent. */
  #collectionMember: IDLMaplike | IDLSetlike | null | undefined;
  /** Nearest ancestor's maplike/setlike declaration, with the same unexamined/absent states. */
  #inheritedCollectionMember: IDLMaplike | IDLSetlike | null | undefined;
  /** Whether own members declare [Default] toJSON; undefined means unexamined. */
  #hasDefaultToJSON: boolean | undefined;
  /** Whether own or inherited members declare toJSON; undefined means unexamined. */
  #hasToJSON: boolean | undefined;
  /** Attributes grouped by their declared installation location, before realm exposure checks. */
  #attributesByPlacement = new Map<MemberPlacement, AttributeEntry<AssembledInterfaceMember>[]>();
  /** JSON-compatible attributes and their inherited getters, before realm exposure checks. */
  #defaultToJSONAttributes: DefaultToJSONAttribute[] | undefined;

  constructor(primary: PrimaryInterfaceDefinition, partials: PartialInterfaceDefinition[] = [], finish: AssemblySteps[]) {
    this.primary = primary;
    this.name = primary.name;
    this.partials = partials;
    this.serialSteps = primary.serialSteps;
    this.transferSteps = primary.transferSteps;
    this.type = new IDLInterfaceType(this);
    finish.push((assembly) => {
      for (const definition of [primary, ...partials]) {
        for (const attribute of definition.extendedAttributes ?? []) {
          if (attribute.kind !== 'named-arguments' || attribute.name !== 'LegacyFactoryFunction') continue;
          const { arguments: argumentsList, ...metadata } = attribute;
          const factoryMember = Object.assign(new AssembledCallable(
            argumentsList.map((argument) => new AssembledArgument(argument, assembly)),
          ), metadata);
          let factory = this.#legacyFactoriesByName.get(attribute.value);
          if (!factory) {
            factory = { callables: [] };
            this.#legacyFactoriesByName.set(attribute.value, factory);
          }
          factory.callables.push(factoryMember);
        }
      }
    });
  }

  /** Whether this interface's declared exposure requirements match the realm. */
  isExposed(realm: WebIDLRealm): boolean {
    return matchesExposure(this.primary, realm);
  }

  /** Whether the including interface, contributing fragment, and member permit exposure. */
  isMemberExposed(entry: AssembledInterfaceMember | AssembledNamespaceMember, realm: WebIDLRealm): boolean {
    return this.isExposed(realm) &&
      matchesExposure(entry.source, realm) &&
      matchesExposure(entry.member, realm);
  }

  /** Whether this interface or one of its ancestors has the requested primary declaration. */
  implements(expectedAssembled: AssembledInterface): boolean {
    if (this.primary === expectedAssembled.primary) return true;
    if (!this.#implementedPrimaries) {
      this.#implementedPrimaries = new Set();
      for (const assembled of this.getInheritanceChain()) this.#implementedPrimaries.add(assembled.primary);
    }
    return this.#implementedPrimaries.has(expectedAssembled.primary);
  }

  /** List interfaces from the oldest ancestor through this interface; the retained list must not be modified. */
  getInheritanceChain(): AssembledInterface[] {
    if (!this.#inheritanceChain) {
      const inheritance: AssembledInterface[] = [this];
      let assembled = this.parentAssembled;
      while (assembled) {
        inheritance.push(assembled);
        assembled = assembled.parentAssembled;
      }
      this.#inheritanceChain = inheritance.reverse();
    }
    return this.#inheritanceChain;
  }

  /** Whether the member belongs to this interface or an ancestor. */
  includesMember(member: IDLInterfaceMember): boolean {
    if (!this.#includedMembers) {
      this.#includedMembers = new Set();
      for (const assembled of this.getInheritanceChain()) {
        for (const entry of assembled.members) this.#includedMembers.add(entry.member);
      }
    }
    return this.#includedMembers.has(member);
  }

  /** Find the nearest ancestor's matching attribute for an inherited accessor. */
  getInheritedAttribute(attribute: IDLAttribute): IDLAttribute {
    const cached = this.#inheritedAttributes.get(attribute);
    if (cached) return cached;
    let assembled = this.parentAssembled;
    while (assembled) {
      for (let i = assembled.members.length - 1; i >= 0; i--) {
        const member = assembled.members[i]?.member;
        if (
          member?.kind === 'attribute' &&
          member.name === attribute.name &&
          Boolean(member.static) === Boolean(attribute.static)
        ) {
          this.#inheritedAttributes.set(attribute, member);
          return member;
        }
      }
      assembled = assembled.parentAssembled;
    }
    throw new InternalError(
      `Inherited attribute ${this.name}.${attribute.name} has no ancestor declaration`,
    );
  }

  /** Find a directly contributed member of the requested kind, retaining its exposure source. */
  findMemberByKind<Kind extends IDLInterfaceMember['kind']>(kind: Kind): InterfaceMemberEntry<Kind> | undefined {
    return this.members.find((entry): entry is InterfaceMemberEntry<Kind> => entry.member.kind === kind);
  }

  /** Find the maplike or setlike declaration, optionally continuing through ancestors. */
  getCollectionMember(includeInherited = false): IDLMaplike | IDLSetlike | undefined {
    if (this.#collectionMember === undefined) {
      this.#collectionMember = null;
      for (const { member } of this.members) {
        if (member.kind === 'maplike' || member.kind === 'setlike') {
          this.#collectionMember = member;
          break;
        }
      }
    }
    if (this.#collectionMember || !includeInherited) return this.#collectionMember ?? undefined;
    if (this.#inheritedCollectionMember === undefined) {
      this.#inheritedCollectionMember = this.parentAssembled?.getCollectionMember(true) ?? null;
    }
    return this.#inheritedCollectionMember ?? undefined;
  }

  /** Whether an explicit instance operation replaces a generated collection method. */
  hasInstanceOperation(name: string): boolean {
    return this.members.some(({ member }) =>
      member.kind === 'operation' && member.name === name && member.static !== true);
  }

  /** Select attributes by their declared placement; binding applies the realm's exposure conditions. */
  getAttributes(placement: MemberPlacement): AttributeEntry<AssembledInterfaceMember>[] {
    let attributes = this.#attributesByPlacement.get(placement);
    if (!attributes) {
      attributes = this.members.filter((entry): entry is AttributeEntry<AssembledInterfaceMember> =>
        entry.member.kind === 'attribute' && belongsAt(entry.member, placement));
      this.#attributesByPlacement.set(placement, attributes);
    }
    return attributes;
  }

  /** Group accepted operation overloads by name and static/instance placement. */
  getOperationGroups(
    placement: MemberPlacement,
    include: OperationFilter,
  ): Map<string, AssembledOverloads<IDLOperation>> {
    return groupOperations(this.members,
      (operation, entry) => belongsAt(operation, placement) && include(operation, entry));
  }

  /** Find the nearest indexed or named special operation, resolving aliases on its key argument. */
  // https://webidl.spec.whatwg.org/#idl-indexed-properties
  // https://webidl.spec.whatwg.org/#idl-named-properties
  findSpecialOperation(
    special: 'deleter' | 'getter' | 'setter',
    keyType: 'DOMString' | 'unsigned long',
  ): IDLOperation | undefined {
    for (const { member } of this.members) {
      if (member.kind !== 'operation' || member.special !== special) continue;
      const key = member.arguments[0];
      if (!key) continue;
      const type = key.type;
      if ((type.kind === 'integer' || type.kind === 'string') && type.name === keyType) return member;
    }
    return this.parentAssembled?.findSpecialOperation(special, keyType);
  }

  /** Prepare constructors accepted by the caller's exposure check. */
  getConstructors(
    include: (entry: AssembledInterfaceMember) => boolean,
  ): AssembledOverloads<IDLConstructor> {
    const constructors: IDLConstructor[] = [];
    for (const entry of this.members) {
      if (entry.member.kind === 'constructor' && include(entry)) constructors.push(entry.member);
    }
    return new AssembledOverloads(constructors);
  }

  /** Find the stringifier accepted by the caller's exposure check. */
  getStringifier(
    placement: Extract<MemberPlacement, 'regular' | 'unforgeable'>,
    include: (entry: AssembledInterfaceMember) => boolean,
  ): StringifierEntry | undefined {
    const entry = this.members.find((entry): entry is StringifierEntry => {
      const member = entry.member;
      return (member.kind === 'stringifier' ||
        (member.kind === 'attribute' && member.stringifier === true)) && include(entry);
    });
    return entry && belongsAt(entry.member, placement) ? entry : undefined;
  }

  /** Collect exposed instance members that must be hidden from with-statement scope. */
  // https://webidl.spec.whatwg.org/#Unscopable
  getUnscopableNames(include: (entry: AssembledInterfaceMember) => boolean): Set<string> {
    const names = new Set<string>();
    for (const entry of this.members) {
      const { member } = entry;
      if (
        (member.kind === 'attribute' || member.kind === 'operation') &&
        !member.static && member.name &&
        hasExtendedAttribute(member.extendedAttributes, 'Unscopable') && include(entry)
      ) names.add(member.name);
    }
    return names;
  }

  /** Whether this interface directly contributes a default toJSON operation. */
  hasDefaultToJSON(): boolean {
    return this.#hasDefaultToJSON ??= this.members.some(({ member }) =>
      member.kind === 'operation' && member.name === 'toJSON' &&
      hasExtendedAttribute(member.extendedAttributes, 'Default'));
  }

  /** Collect default-toJSON attributes in inheritance order without reading implementation values. */
  getDefaultToJSONAttributes(): DefaultToJSONAttribute[] {
    if (this.#defaultToJSONAttributes) return this.#defaultToJSONAttributes;
    const attributes: DefaultToJSONAttribute[] = [];
    for (const assembled of this.getInheritanceChain()) {
      if (!assembled.hasDefaultToJSON()) continue;
      for (const { member, source } of assembled.members) {
        if (member.kind !== 'attribute' || member.static || !member.type.isJSON) continue;
        attributes.push({
          assembled, member, source,
          implementation: member.inherit ? assembled.getInheritedAttribute(member) : member,
        });
      }
    }
    return this.#defaultToJSONAttributes = attributes;
  }

  /** Whether this interface or an ancestor declares a toJSON operation. */
  hasToJSON(): boolean {
    return this.#hasToJSON ??= this.members.some(({ member }) => member.kind === 'operation' && member.name === 'toJSON') ||
      (this.parentAssembled?.hasToJSON() ?? false);
  }

  /** Inspect the primary declaration and, by default, its partial declarations. */
  hasExtendedAttribute(name: string, includePartials = true): boolean {
    return hasExtendedAttribute(this.primary.extendedAttributes, name) ||
      (includePartials && this.partials.some((partial) => hasExtendedAttribute(partial.extendedAttributes, name)));
  }

  /** Search this interface and its ancestors, optionally excluding partial declarations. */
  inheritsExtendedAttribute(name: string, includePartials = true): boolean {
    return this.hasExtendedAttribute(name, includePartials) ||
      (this.parentAssembled?.inheritsExtendedAttribute(name, includePartials) ?? false);
  }

  /** Collect inherited member names reserved by LegacyUnforgeable. */
  getUnforgeablePropertyNames(): Set<string> {
    const names = new Set<string>();
    this.#addUnforgeablePropertyNames(names);
    return names;
  }

  /** Whether the primary or a partial declaration marks this as a global interface. */
  isGlobal(): boolean {
    return this.hasExtendedAttribute('Global');
  }

  /** Whether this interface has a JavaScript interface object. */
  hasInterfaceObject(): boolean {
    return !hasExtendedAttribute(this.primary.extendedAttributes, 'LegacyNoInterfaceObject');
  }

  /** Read the namespace that receives this interface's constructor. */
  getLegacyNamespace(): string | undefined {
    const attribute = this.primary.extendedAttributes?.find((candidate) =>
      candidate.kind === 'identifier' && candidate.name === 'LegacyNamespace');
    return attribute?.kind === 'identifier' ? attribute.value : undefined;
  }

  /** Qualify the interface name for its prototype's toStringTag. */
  getQualifiedName(): string {
    const namespace = this.getLegacyNamespace();
    return namespace ? `${namespace}.${this.name}` : this.name;
  }

  /** Read the additional names used to expose this constructor on Window globals. */
  getLegacyWindowAliases(): string[] {
    const attribute = this.primary.extendedAttributes?.find((candidate) =>
      (candidate.kind === 'identifier' || candidate.kind === 'identifier-list') &&
      candidate.name === 'LegacyWindowAlias');
    if (attribute?.kind === 'identifier') return [attribute.value];
    return attribute?.kind === 'identifier-list' ? attribute.values : [];
  }

  /** Visit the distinct factory names collected from the primary and partial declarations. */
  getLegacyFactoryNames(): MapIterator<string> {
    return this.#legacyFactoriesByName.keys();
  }

  /** Retain each legacy factory's prepared overloads across this binding world's realms. */
  getLegacyFactoryOverloads(name: string): AssembledOverloads<IDLNamedArguments> {
    const factory = this.#legacyFactoriesByName.get(name);
    if (!factory) {
      throw new InternalError(`${this.name} has no legacy factory function ${name}`);
    }
    return factory.overloads ??= new AssembledOverloads(factory.callables);
  }

  #addUnforgeablePropertyNames(names: Set<string>): void {
    for (const { member } of this.members) {
      if (!hasExtendedAttribute(member.extendedAttributes, 'LegacyUnforgeable')) continue;
      if (
        member.kind === 'stringifier' ||
        (member.kind === 'attribute' && member.stringifier === true)
      ) names.add('toString');
      if ((member.kind === 'attribute' || member.kind === 'operation') && member.name) names.add(member.name);
    }
    if (this.parentAssembled) this.parentAssembled.#addUnforgeablePropertyNames(names);
  }
}

/** Index the same assembled interfaces by IDL name and implementation class. */
export class AssembledInterfaces {
  /** One assembled interface per declared IDL name. */
  byName = new Map<string, AssembledInterface>();
  /** The same interfaces indexed by the implementation classes declared for them. */
  byImplClass = new Map<ImplementationClass, AssembledInterface>();

  constructor(definitions: Definition[], finish: AssemblySteps[]) {
    const mixinsByName = new Map<string, InterfaceMixinDefinition>();
    const interfacePartialsByName = new Map<string, PartialInterfaceDefinition[]>();
    const mixinPartialsByName = new Map<string, PartialInterfaceMixinDefinition[]>();
    const includesByInterfaceName = new Map<string, IncludesDefinition[]>();

    // Collect contributions first so they can precede or follow their primary interface.
    for (const definition of definitions) {
      switch (definition.kind) {
        case 'interface-mixin':
          mixinsByName.set(definition.name, definition);
          break;
        case 'partial-interface':
          appendToMapList(interfacePartialsByName, definition.name, definition);
          break;
        case 'partial-interface-mixin':
          appendToMapList(mixinPartialsByName, definition.name, definition);
          break;
        case 'includes':
          appendToMapList(includesByInterfaceName, definition.interface, definition);
          break;
      }
    }

    // Create all interfaces before linking parents, which can appear later in the declarations.
    for (const definition of definitions) {
      if (definition.kind !== 'interface') continue;
      this.byName.set(definition.name, new AssembledInterface(
        definition, interfacePartialsByName.get(definition.name), finish,
      ));
    }

    for (const assembled of this.values()) {
      const { inherits } = assembled.primary;
      if (inherits) assembled.parentAssembled = this.get(inherits)!;
    }

    finish.push((assembly) => {
      // Compile each included mixin once, sharing its members across includers.
      const mixinMembers = new Map<string, AssembledInterfaceMember[]>();
      for (const includes of includesByInterfaceName.values()) {
        for (const include of includes) {
          if (mixinMembers.has(include.mixin)) continue;
          const mixin = mixinsByName.get(include.mixin)!;
          const members: AssembledInterfaceMember[] = [];
          for (const source of [mixin, ...mixinPartialsByName.get(mixin.name) ?? []]) {
            for (const member of source.members) {
              members.push({ member: assembleMember(member, assembly), source });
            }
          }
          mixinMembers.set(mixin.name, members);
        }
      }
      for (const assembled of this.values()) {
        assembleInterface(
          assembled,
          mixinMembers,
          includesByInterfaceName.get(assembled.name),
          assembly,
        );
      }
    });
    for (const assembled of this.values()) {
      const implementation = assembled.primary.implementation;
      if (implementation) this.byImplClass.set(implementation.implClass, assembled);
    }
  }

  /** Find an interface by its IDL name or implementation class. */
  get(key: string | ImplementationClass): AssembledInterface | undefined {
    return typeof key === 'string' ? this.byName.get(key) : this.byImplClass.get(key);
  }

  /** Iterate each interface once, regardless of its two lookup keys. */
  values(): MapIterator<AssembledInterface> {
    return this.byName.values();
  }

  /** Identify an implementation instance through its prototype constructors. */
  findForImplementation(implInst: object): AssembledInterface | undefined {
    for (
      let prototype = Reflect.getPrototypeOf(implInst);
      prototype;
      prototype = Reflect.getPrototypeOf(prototype)
    ) {
      const candidate: unknown = Reflect.getOwnPropertyDescriptor(prototype, 'constructor')?.value;
      if (typeof candidate !== 'function') continue;
      const assembled = this.byImplClass.get(candidate);
      if (assembled) return assembled;
    }
  }

  /** Resolve an implementation class to the IDL name declared in this assembly. */
  getType(implClass: ImplementationClass): IDLInterfaceType {
    const assembled = this.byImplClass.get(implClass);
    if (!assembled) throw new InternalError('No interface declares the referenced implementation class');
    return assembled.type;
  }

  /** Visit interfaces whose constructors belong to the named legacy namespace. */
  *inNamespace(name: string): IterableIterator<AssembledInterface> {
    for (const assembled of this.values()) {
      if (assembled.getLegacyNamespace() === name) yield assembled;
    }
  }

  /** Whether this interface belongs to a declared global interface's prototype chain. */
  isOnGlobalPrototypeChain(assembled: AssembledInterface): boolean {
    for (const candidateAssembled of this.values()) {
      if (!candidateAssembled.isGlobal()) continue;
      let currentAssembled: AssembledInterface | undefined = candidateAssembled;
      while (currentAssembled) {
        if (currentAssembled === assembled) return true;
        currentAssembled = currentAssembled.parentAssembled;
      }
    }
    return false;
  }

  /** Order the selected interfaces so each included parent precedes its descendants. */
  inInheritanceOrder(include: (assembled: AssembledInterface) => boolean): AssembledInterface[] {
    const remaining = new Set<AssembledInterface>();
    for (const assembled of this.values()) {
      if (include(assembled)) remaining.add(assembled);
    }
    const ordered: AssembledInterface[] = [];
    while (remaining.size > 0) {
      let assembled: AssembledInterface | undefined;
      for (const candidateAssembled of remaining) {
        if (!candidateAssembled.parentAssembled || !remaining.has(candidateAssembled.parentAssembled)) {
          assembled = candidateAssembled;
          break;
        }
      }
      if (!assembled) throw new InternalError('Interface inheritance contains a cycle');
      remaining.delete(assembled);
      ordered.push(assembled);
    }
    return ordered;
  }
}

export type AssembledInterfaceMember = {
  member: IDLInterfaceMember;
  /** The declaring construct supplies exposure conditions for this member. */
  source:
    | PrimaryInterfaceDefinition
    | PartialInterfaceDefinition
    | InterfaceMixinDefinition
    | PartialInterfaceMixinDefinition;
};

/** A JSON-compatible attribute and the declaration supplying its inherited getter. */
export type DefaultToJSONAttribute = AssembledInterfaceMember & {
  assembled: AssembledInterface;
  member: IDLAttribute;
  implementation: IDLAttribute;
};

type InterfaceMemberEntry<Kind extends IDLInterfaceMember['kind']> = AssembledInterfaceMember & {
  member: Extract<IDLInterfaceMember, { kind: Kind; }>;
};

type StringifierEntry = InterfaceMemberEntry<'stringifier' | 'attribute'>;

// https://webidl.spec.whatwg.org/#idl-interfaces
// https://webidl.spec.whatwg.org/#idl-interface-mixins
function assembleInterface(
  assembled: AssembledInterface,
  mixinMembers: Map<string, AssembledInterfaceMember[]>,
  includes: IncludesDefinition[] | undefined,
  assembly: DefinitionAssembly,
): void {
  const definition = assembled.primary;
  for (const member of definition.members) {
    assembled.members.push({
      member: assembleMember(member, assembly), source: definition,
    });
  }
  for (const partial of assembled.partials) {
    for (const member of partial.members) {
      assembled.members.push({
        member: assembleMember(member, assembly), source: partial,
      });
    }
  }
  for (const include of includes ?? []) {
    assembled.members.push(...mixinMembers.get(include.mixin)!);
  }
}
