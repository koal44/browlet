import { InternalError } from '../../infra/index';
import {
  hasExtendedAttribute, type CallbackFunctionDefinition, type CallbackInterfaceDefinition,
  type DictionaryDefinition, type DictionaryMember, type EnumerationDefinition, type ProxyObjectDefinition,
  type TypedefDefinition, type PartialDictionaryDefinition, type PrimaryInterfaceDefinition,
  type PartialInterfaceDefinition, type InterfaceMixinDefinition, type PartialInterfaceMixinDefinition,
  type NamespaceDefinition, type PartialNamespaceDefinition, type Definition, type IncludesDefinition,
  type ArgumentDefinition, type ExtendedAttribute, type ImplementationClass, type StringifierMember,
  type WebIDLType, type SerialSteps, type TransferSteps, type AttributeMember, type OperationMember,
  type ConstantMember, type ConstructorMember, type IterableMember, type AsyncIterableMember,
  type MaplikeMember, type SetlikeMember, type NamedArgumentsExtendedAttribute, type InterfaceMember,
  type MixinMember, type NamespaceMember,
} from '../core/index';

import { undefinedType, type IDLType, type IDLInterfaceType } from './types';
import type { DefinitionAssembly } from './assembly';

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
  /** Prepared argument contracts, keyed by compiled members. */
  callables = new AssembledCallables();

  /** Legacy factory declarations grouped by exposed name, with overloads prepared on first use. */
  #legacyFactoriesByName = new Map<string, {
    callables: AssembledCallable<IDLNamedArguments>[];
    overloads?: AssembledOverloads<AssembledCallable<IDLNamedArguments>>;
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
    this.type = { kind: 'interface', assembled: this, attributes: [] };
    finish.push((assembly) => {
      for (const definition of [primary, ...partials]) {
        for (const attribute of definition.extendedAttributes ?? []) {
          if (attribute.kind !== 'named-arguments' || attribute.name !== 'LegacyFactoryFunction') continue;
          const factoryMember = {
            ...attribute,
            arguments: attribute.arguments.map((argument) => new AssembledArgument(argument, assembly)),
          };
          this.callables.add(factoryMember);
          let factory = this.#legacyFactoriesByName.get(attribute.value);
          if (!factory) {
            factory = { callables: [] };
            this.#legacyFactoriesByName.set(attribute.value, factory);
          }
          factory.callables.push(this.callables.get(factoryMember));
        }
      }
    });
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
    assembly: DefinitionAssembly,
  ): Map<string, AssembledOverloads<AssembledCallable<IDLOperation>>> {
    return groupOperations(this.members, this.callables,
      (operation, entry) => belongsAt(operation, placement) && include(operation, entry), assembly);
  }

  /** Find the nearest indexed or named special operation, resolving aliases on its key argument. */
  // https://webidl.spec.whatwg.org/#idl-indexed-properties
  // https://webidl.spec.whatwg.org/#idl-named-properties
  findSpecialOperation(
    special: 'deleter' | 'getter' | 'setter',
    keyType: 'DOMString' | 'unsigned long',
  ): AssembledCallable<IDLOperation> | undefined {
    for (const { member } of this.members) {
      if (member.kind !== 'operation' || member.special !== special) continue;
      const callable = this.callables.get(member);
      const key = callable.arguments[0];
      if (!key) continue;
      const type = key.type;
      if ((type.kind === 'integer' || type.kind === 'string') && type.name === keyType) return callable;
    }
    return this.parentAssembled?.findSpecialOperation(special, keyType);
  }

  /** Prepare constructors accepted by the caller's exposure check. */
  getConstructors(
    include: (entry: AssembledInterfaceMember) => boolean,
    assembly: DefinitionAssembly,
  ): AssembledOverloads<AssembledCallable<IDLConstructor>> {
    const constructors: AssembledCallable<IDLConstructor>[] = [];
    for (const entry of this.members) {
      if (entry.member.kind === 'constructor' && include(entry)) constructors.push(this.callables.get(entry.member));
    }
    return new AssembledOverloads(constructors, assembly);
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
  getDefaultToJSONAttributes(assembly: DefinitionAssembly): DefaultToJSONAttribute[] {
    if (this.#defaultToJSONAttributes) return this.#defaultToJSONAttributes;
    const attributes: DefaultToJSONAttribute[] = [];
    for (const assembled of this.getInheritanceChain()) {
      if (!assembled.hasDefaultToJSON()) continue;
      for (const { member, source } of assembled.members) {
        if (member.kind !== 'attribute' || member.static || !assembly.isJSONType(member.type)) continue;
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
  getLegacyFactoryOverloads(
    name: string,
    assembly: DefinitionAssembly,
  ): AssembledOverloads<AssembledCallable<IDLNamedArguments>> {
    const factory = this.#legacyFactoriesByName.get(name);
    if (!factory) {
      throw new InternalError(`${this.name} has no legacy factory function ${name}`);
    }
    return factory.overloads ??= new AssembledOverloads(factory.callables, assembly);
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

/** A callback interface used for conversion and invocation. */
export class AssembledCallbackInterface {
  /** Original callback-interface declaration, including any custom implementation adapter. */
  primary: CallbackInterfaceDefinition;
  /** Prepared operations used to convert callback arguments and results. */
  operationsByName = new Map<string, AssembledCallable<IDLOperation>>();

  /** Constants and operations with compiled argument and result types. */
  members: (IDLConstant | IDLOperation)[] = [];

  constructor(primary: CallbackInterfaceDefinition, finish: AssemblySteps[]) {
    this.primary = primary;
    finish.push((assembly) => {
      this.members = primary.members.map((member) => assembleMember(member, assembly));
      for (const member of this.members) {
        if (member.kind !== 'operation' || member.name === undefined) continue;
        if (!this.operationsByName.has(member.name)) {
          this.operationsByName.set(member.name, new AssembledCallable(member));
        }
      }
    });
  }

  /** Find the declared operation required by callback invocation. */
  getOperation(name: string): AssembledCallable<IDLOperation> {
    const operation = this.operationsByName.get(name);
    if (!operation) {
      throw new InternalError(
        `Callback interface ${this.primary.name} has no ${name} operation`,
      );
    }
    return operation;
  }

  /** Only exposed callback interfaces with constants receive a legacy interface object. */
  hasInterfaceObject(): boolean {
    return this.primary.exposed !== undefined && this.members.some((member) => member.kind === 'constant');
  }
}

/** Argument-count candidates for one exposure-selected group of callables. */
export class AssembledOverloads<Callable extends AssembledCallable = AssembledCallable> {
  /** Overload declarations admitted by the realm's exposure checks. */
  callables: Callable[];
  /** The length of the installed function. */
  minimumArgumentCount: number;
  /** Extra arguments are ignored above this count; variadic groups use Infinity. */
  maximumArgumentCount = 0;

  /** Applicable callables and distinguishing argument index for each allowed argument count. */
  #candidatesByArgumentCount: OverloadCandidates<Callable>[] = [];

  constructor(callables: Callable[], assembly: DefinitionAssembly) {
    this.callables = callables;
    this.minimumArgumentCount = callables.length === 0 ? 0 : Infinity;
    let maximumDeclaredCount = 0;
    for (const callable of callables) {
      maximumDeclaredCount = Math.max(maximumDeclaredCount, callable.arguments.length);
      this.minimumArgumentCount = Math.min(this.minimumArgumentCount, callable.minimumArgumentCount);
      this.maximumArgumentCount = Math.max(
        this.maximumArgumentCount,
        callable.variadicArgument ? Infinity : callable.arguments.length,
      );
    }

    // Effective overload set: group allowable invocations by argument count.
    // https://webidl.spec.whatwg.org/#dfn-effective-overload-set
    // Optional suffixes admit shorter counts. One final group covers every count
    // beyond the longest declaration, reusing each variadic argument's contract.
    const lastCount = maximumDeclaredCount + (this.maximumArgumentCount === Infinity ? 1 : 0);
    for (let count = 0; count <= lastCount; count++) {
      const candidates = callables.filter((callable) =>
        count >= callable.minimumArgumentCount &&
        (count <= callable.arguments.length || callable.variadicArgument !== undefined));

      // Distinguishing argument index: for valid overloads, the first differing
      // type is distinguishable; all preceding types and optionality must match.
      // https://webidl.spec.whatwg.org/#dfn-distinguishing-argument-index
      let distinguishingIndex = -1;
      if (candidates.length > 1) {
        for (let index = 0; index < count; index++) {
          const first = assembly.getOverloadTypeKey(candidates[0]!.getArgument(index)!.type);
          if (candidates.some((candidate) =>
            assembly.getOverloadTypeKey(candidate.getArgument(index)!.type) !== first)) {
            distinguishingIndex = index;
            break;
          }
        }
      }
      this.#candidatesByArgumentCount.push({ callables: candidates, distinguishingIndex });
    }
  }

  /** Return the shared candidates for an invocation; callers must not modify the list. */
  getCandidates(argumentCount: number): OverloadCandidates<Callable> {
    return this.#candidatesByArgumentCount[Math.min(argumentCount, this.#candidatesByArgumentCount.length - 1)]!;
  }
}

/** Prepared arguments for an operation, constructor, callback, or other declaration taking arguments. */
export class AssembledCallable<Primary extends CallableContract = CallableContract> {
  /** Compiled member or callback metadata; this contract is not itself a function. */
  primary: Primary;
  /** Arguments with aliases, nested types, and applicable conversion rules resolved. */
  arguments: AssembledArgument[];
  /** The final argument's contract, reused for every value in a variadic tail. */
  variadicArgument: AssembledArgument | undefined;
  /** Smallest argument count admitted after omitting the optional and variadic suffix. */
  minimumArgumentCount: number;

  /** Compiled return contract; constructors and iterable declarations return undefined here. */
  returns: IDLType;

  constructor(primary: Primary) {
    this.primary = primary;
    this.returns = primary.returns ?? undefinedType;
    this.arguments = primary.arguments ?? [];
    const last = this.arguments.at(-1);
    this.variadicArgument = last?.optionality === 'variadic' ? last : undefined;
    let minimum = this.arguments.length;
    while (minimum > 0 && this.arguments[minimum - 1]!.optionality !== 'required') minimum--;
    this.minimumArgumentCount = minimum;
  }

  /** Select a fixed argument or the repeated variadic argument. */
  getArgument(index: number): AssembledArgument | undefined {
    return this.arguments[index] ?? this.variadicArgument;
  }
}

/** An argument with its applicable conversion attributes incorporated into its type. */
export class AssembledArgument {
  /** Declaration metadata used for defaulting and implementation binding. */
  primary: Omit<ArgumentDefinition, 'type' | 'callbackDictionary'> & { callbackDictionary?: IDLType; };
  /** Conversion descriptor including applicable attributes such as [Clamp]. */
  type: IDLType;
  /** Whether the argument is required, optional, or repeated in a variadic tail. */
  optionality: ArgumentOptionality;

  constructor(primary: ArgumentDefinition, assembly: DefinitionAssembly) {
    const { type, callbackDictionary, ...options } = primary;
    this.primary = callbackDictionary ? { ...options, callbackDictionary: assembly.getIDLType(callbackDictionary) } : options;
    this.type = assembly.getIDLType(assembleMemberType(type, primary.extendedAttributes));
    this.optionality = primary.variadic ? 'variadic' : primary.optional ? 'optional' : 'required';
  }
}

/** A dictionary member with its conversion type prepared independently of its incoming value. */
export class AssembledDictionaryMember {
  /** Declaration metadata used for defaulting and implementation binding. */
  primary: Omit<DictionaryMember, 'type'>;
  /** Property name read from the incoming dictionary object. */
  name: string;
  /** Conversion descriptor including applicable member attributes. */
  type: IDLType;

  constructor(primary: DictionaryMember, assembly: DefinitionAssembly) {
    const { type, ...options } = primary;
    this.primary = options;
    this.name = primary.name;
    this.type = assembly.getIDLType(assembleMemberType(type, primary.extendedAttributes));
  }
}

/** A callback function's argument and result contract. */
export class AssembledCallbackFunction extends AssembledCallable<Omit<CallbackFunctionDefinition, 'arguments' | 'returns'>> {
  constructor(primary: CallbackFunctionDefinition, finish: AssemblySteps[]) {
    const { arguments: argumentsList, returns, ...metadata } = primary;
    super(metadata);
    finish.push((assembly) => {
      this.returns = assembly.getIDLType(returns);
      this.arguments = argumentsList.map((argument) => new AssembledArgument(argument, assembly));
      this.variadicArgument = this.arguments.at(-1)?.optionality === 'variadic' ? this.arguments.at(-1) : undefined;
      let minimum = this.arguments.length;
      while (minimum > 0 && this.arguments[minimum - 1]!.optionality !== 'required') minimum--;
      this.minimumArgumentCount = minimum;
    });
  }

  /** Whether legacy callback attributes accept non-object values as null. */
  treatsNonObjectAsNull(): boolean {
    return hasExtendedAttribute(this.primary.extendedAttributes, 'LegacyTreatNonObjectAsNull');
  }
}

/** A namespace with the members contributed by its primary and partial declarations. */
// https://webidl.spec.whatwg.org/#idl-namespaces
export class AssembledNamespace {
  /** Original namespace declaration before adding partial members. */
  primary: NamespaceDefinition;
  /** Partial declarations contributing members and exposure conditions. */
  partials: PartialNamespaceDefinition[];
  /** Combined members paired with the declaration supplying their exposure conditions. */
  members: AssembledNamespaceMember[] = [];
  /** Prepared argument contracts for namespace operations. */
  callables = new AssembledCallables();
  /** Attributes grouped by declared placement before realm exposure checks. */
  #attributesByPlacement = new Map<MemberPlacement, AttributeEntry<AssembledNamespaceMember>[]>();

  constructor(primary: NamespaceDefinition, partials: PartialNamespaceDefinition[] = [], finish: AssemblySteps[]) {
    this.primary = primary;
    this.partials = partials;
    finish.push((assembly) => {
      for (const member of primary.members) this.members.push({ member: assembleMember(member, assembly), source: primary });
      for (const partial of partials) {
        for (const member of partial.members) this.members.push({ member: assembleMember(member, assembly), source: partial });
      }
      for (const { member } of this.members) {
        if (member.kind === 'operation') this.callables.add(member);
      }
    });
  }

  /** Select attributes by their declared placement; binding applies the realm's exposure conditions. */
  getAttributes(placement: MemberPlacement): AttributeEntry<AssembledNamespaceMember>[] {
    let attributes = this.#attributesByPlacement.get(placement);
    if (!attributes) {
      attributes = this.members.filter((entry): entry is AttributeEntry<AssembledNamespaceMember> =>
        entry.member.kind === 'attribute' && belongsAt(entry.member, placement));
      this.#attributesByPlacement.set(placement, attributes);
    }
    return attributes;
  }

  /** Group accepted operation overloads by name and static/instance placement. */
  getOperationGroups(
    placement: MemberPlacement,
    include: OperationFilter,
    assembly: DefinitionAssembly,
  ): Map<string, AssembledOverloads<AssembledCallable<IDLOperation>>> {
    return groupOperations(this.members, this.callables,
      (operation, entry) => belongsAt(operation, placement) && include(operation, entry), assembly);
  }
}

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

  /** Members whose converted values may need unpacking or callback binding before implementation use. */
  #membersToConvert: AssembledDictionaryMember[] | undefined;

  constructor(primary: DictionaryDefinition, partials: PartialDictionaryDefinition[] = []) {
    this.primary = primary;
    this.partials = partials;
  }

  /** Get members that may need further conversion; primitives and sequences of primitives pass through. */
  getMembersToConvert(assembly: DefinitionAssembly): AssembledDictionaryMember[] {
    return this.#membersToConvert ??= this.members.filter((member) => !assembly.canPassToImpl(member.type));
  }

  /** A dictionary is a JSON type only when all of its member types are JSON types. */
  isJSONType(assembly: DefinitionAssembly, seen: Set<string>): boolean {
    return this.members.every((member) => assembly.isJSONType(member.type, seen));
  }
}

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

/** A named type alias followed during type resolution. */
export class AssembledTypedef {
  /** Original alias declaration and its referenced type. */
  primary: TypedefDefinition;

  constructor(primary: TypedefDefinition) {
    this.primary = primary;
  }
}

/** A proxy type's recognition and receiver-resolution hooks. */
export class AssembledProxyObject {
  /** Original declaration supplying recognition and current-receiver hooks. */
  primary: ProxyObjectDefinition;

  constructor(primary: ProxyObjectDefinition) {
    this.primary = primary;
  }

  /** Recognize a proxy without replacing its identity during conversion. */
  is(value: unknown): boolean {
    return this.primary.is(value);
  }

  /** Select a recognized proxy's current platform receiver. */
  resolveReceiver(value: unknown): object | undefined {
    return this.is(value) ? this.primary.resolveReceiver?.(value) : undefined;
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
          appendValuesByName(interfacePartialsByName, definition.name, definition);
          break;
        case 'partial-interface-mixin':
          appendValuesByName(mixinPartialsByName, definition.name, definition);
          break;
        case 'includes':
          appendValuesByName(includesByInterfaceName, definition.interface, definition);
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

    for (const name of interfacePartialsByName.keys()) {
      if (!this.byName.has(name)) throw new InternalError(`Partial interface ${name} has no primary interface`);
    }
    for (const name of mixinPartialsByName.keys()) {
      if (!mixinsByName.has(name)) throw new InternalError(`Partial mixin ${name} has no primary mixin`);
    }
    for (const [name, includes] of includesByInterfaceName) {
      if (!this.byName.has(name)) throw new InternalError(`Includes target ${name} is not an interface`);
      const included = new Set<string>();
      for (const include of includes) {
        if (!mixinsByName.has(include.mixin)) throw new InternalError(`Includes source ${include.mixin} is not a mixin`);
        if (included.has(include.mixin)) throw new InternalError(`Duplicate includes statement: ${name} includes ${include.mixin}`);
        included.add(include.mixin);
      }
    }
    for (const assembled of this.values()) {
      const { inherits } = assembled.primary;
      if (!inherits) continue;
      const parent = this.get(inherits);
      if (!parent) throw new InternalError(`Interface ${assembled.name} inherits unknown interface ${inherits}`);
      assembled.parentAssembled = parent;
    }
    validateInheritance(this.values());

    finish.push((assembly) => {
      // Compile every mixin, including unused ones, so invalid member types cannot hide there.
      const mixinMembers = new Map<string, AssembledInterfaceMember[]>();
      for (const mixin of mixinsByName.values()) {
        const members: AssembledInterfaceMember[] = [];
        for (const source of [mixin, ...mixinPartialsByName.get(mixin.name) ?? []]) {
          for (const member of source.members) members.push({ member: assembleMember(member, assembly), source });
        }
        mixinMembers.set(mixin.name, members);
      }
      for (const assembled of this.values()) {
        assembleInterface(
          assembled,
          mixinMembers,
          includesByInterfaceName.get(assembled.name),
          assembly,
        );
        const definition = assembled.primary;
        // https://html.spec.whatwg.org/multipage/structured-data.html#serializable-objects
        // https://html.spec.whatwg.org/multipage/structured-data.html#transferable-objects
        // Steps require exactly one marker; a marker alone can describe unfinished support.
        for (const [name, steps] of [
          ['Serializable', definition.serialSteps],
          ['Transferable', definition.transferSteps],
        ] as const) {
          const markers = definition.extendedAttributes?.filter(
            (attribute) => attribute.kind !== 'raw' && attribute.name === name,
          ) ?? [];
          if (markers.length === 0 && !steps) continue;
          if (markers.length !== 1 || markers[0]?.kind !== 'no-arguments') {
            throw new InternalError(`${definition.name} must declare exactly one [${name}] marker`);
          }
        }

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

/** Index callback interfaces by name and identify declarations with legacy interface objects. */
export class AssembledCallbackInterfaces extends Map<string, AssembledCallbackInterface> {
  constructor(definitions: Definition[], finish: AssemblySteps[]) {
    super();
    for (const definition of definitions) {
      if (definition.kind === 'callback-interface') {
        this.set(definition.name, new AssembledCallbackInterface(definition, finish));
      }
    }
  }

  /** Visit declarations eligible for a legacy callback interface object before realm exposure checks. */
  *withInterfaceObjects(): IterableIterator<AssembledCallbackInterface> {
    for (const assembled of this.values()) {
      if (assembled.hasInterfaceObject()) yield assembled;
    }
  }
}

/** Index callback functions by their IDL names. */
export class AssembledCallbackFunctions extends Map<string, AssembledCallbackFunction> {
  constructor(definitions: Definition[], finish: AssemblySteps[]) {
    super();
    for (const definition of definitions) {
      if (definition.kind === 'callback-function') {
        this.set(definition.name, new AssembledCallbackFunction(definition, finish));
      }
    }
  }
}

/** Combine namespace fragments and index the assembled namespaces by IDL name. */
export class AssembledNamespaces extends Map<string, AssembledNamespace> {
  constructor(definitions: Definition[], finish: AssemblySteps[]) {
    super();
    const partialsByName = new Map<string, PartialNamespaceDefinition[]>();
    for (const definition of definitions) {
      if (definition.kind === 'partial-namespace') appendValuesByName(partialsByName, definition.name, definition);
    }
    for (const definition of definitions) {
      if (definition.kind === 'namespace') {
        this.set(definition.name, new AssembledNamespace(definition, partialsByName.get(definition.name), finish));
      }
    }
    for (const name of partialsByName.keys()) {
      if (!this.has(name)) throw new InternalError(`Partial namespace ${name} has no primary namespace`);
    }
  }
}

/** Assemble dictionary fragments and inheritance, indexed by IDL name. */
export class AssembledDictionaries extends Map<string, AssembledDictionary> {
  constructor(definitions: Definition[], finish: AssemblySteps[]) {
    super();
    const partialsByName = new Map<string, PartialDictionaryDefinition[]>();
    for (const definition of definitions) {
      if (definition.kind === 'partial-dictionary') appendValuesByName(partialsByName, definition.name, definition);
    }
    for (const definition of definitions) {
      if (definition.kind === 'dictionary') {
        this.set(definition.name, new AssembledDictionary(definition, partialsByName.get(definition.name)));
      }
    }
    for (const name of partialsByName.keys()) {
      if (!this.has(name)) throw new InternalError(`Partial dictionary ${name} has no primary dictionary`);
    }
    for (const assembled of this.values()) {
      const { inherits, name } = assembled.primary;
      if (!inherits) continue;
      const parent = this.get(inherits);
      if (!parent) throw new InternalError(`Dictionary ${name} inherits unknown dictionary ${inherits}`);
      assembled.parentAssembled = parent;
    }
    validateInheritance(this.values());

    finish.push((assembly) => {
      const visited = new Set<AssembledDictionary>();
      for (const assembled of this.values()) assembleDictionary(assembled, visited, assembly);
    });
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

/** Resolve alias chains without deciding how a caller uses the resulting type. */
export class AssembledTypedefs extends Map<string, AssembledTypedef> {
  constructor(definitions: Definition[], finish: AssemblySteps[]) {
    super();
    for (const definition of definitions) {
      if (definition.kind === 'typedef') this.set(definition.name, new AssembledTypedef(definition));
    }
    const visited = new Set<WebIDLType>();
    const visiting = new Set<WebIDLType>();
    for (const assembled of this.values()) validateTypedef(assembled.primary.type, this, visited, visiting);
    finish.push((assembly) => {
      for (const name of this.keys()) assembly.getNamedType(name);
    });
  }

  /** Strip aliases and annotations, optionally retaining the encountered conversion attributes. */
  resolve(type: WebIDLType, collectedAttributes?: ExtendedAttribute[]): Exclude<WebIDLType, { kind: 'annotated'; }> {
    while (true) {
      if (type.kind === 'annotated') {
        collectedAttributes?.push(...type.extendedAttributes);
        type = type.type;
        continue;
      }
      if (type.kind === 'reference') {
        const assembled = this.get(type.name);
        if (assembled) {
          type = assembled.primary.type;
          continue;
        }
      }
      return type;
    }
  }
}

/** Search proxy declarations whose recognition depends on the supplied value. */
export class AssembledProxyObjects extends Map<string, AssembledProxyObject> {
  constructor(definitions: Definition[]) {
    super();
    for (const definition of definitions) {
      if (definition.kind === 'proxy-object') this.set(definition.name, new AssembledProxyObject(definition));
    }
  }

  /** Whether any declared proxy type recognizes this value. */
  is(value: unknown): boolean {
    for (const assembled of this.values()) {
      if (assembled.is(value)) return true;
    }
    return false;
  }

  /** Visit live receiver candidates; the binding checks their platform identity and world. */
  *resolveReceivers(value: unknown): IterableIterator<object> {
    for (const assembled of this.values()) {
      const receiver = assembled.resolveReceiver(value);
      if (receiver !== undefined) yield receiver;
    }
  }
}

/** Retain prepared callables under their compiled member identities. */
class AssembledCallables {
  /** Prepared callables keyed by the compiled members used during binding. */
  #byPrimary = new Map<CallableContract, AssembledCallable>();

  add(primary: CallableContract): void {
    if (!this.#byPrimary.has(primary)) this.#byPrimary.set(primary, new AssembledCallable(primary));
  }

  get<Primary extends CallableContract>(primary: Primary): AssembledCallable<Primary> {
    const assembled = this.#byPrimary.get(primary);
    if (!assembled) throw new InternalError('Callable does not belong to this assembled definition');
    // Each entry retains the exact declaration used as its key.
    return assembled as AssembledCallable<Primary>;
  }
}

type CallableContract = { name?: string; arguments?: AssembledArgument[]; returns?: IDLType; };
type ArgumentOptionality = 'required' | 'optional' | 'variadic';
type OverloadCandidates<Callable extends AssembledCallable> = {
  callables: Callable[];
  distinguishingIndex: number;
};

type StringifierEntry = InterfaceMemberEntry<'stringifier' | 'attribute'>;

export type MemberPlacement = 'regular' | 'static' | 'unforgeable';

/** An attribute with the declaration that controls its exposure. */
type AttributeEntry<Member> = Member & { member: IDLAttribute; };

/** A JSON-compatible attribute and the declaration supplying its inherited getter. */
export type DefaultToJSONAttribute = AssembledInterfaceMember & {
  assembled: AssembledInterface;
  member: IDLAttribute;
  implementation: IDLAttribute;
};

export type AssembledInterfaceMember = {
  member: IDLInterfaceMember;
  /** The declaring construct supplies exposure conditions for this member. */
  source:
    | PrimaryInterfaceDefinition
    | PartialInterfaceDefinition
    | InterfaceMixinDefinition
    | PartialInterfaceMixinDefinition;
};

type InterfaceMemberEntry<Kind extends IDLInterfaceMember['kind']> = AssembledInterfaceMember & {
  member: Extract<IDLInterfaceMember, { kind: Kind; }>;
};

export type AssembledNamespaceMember = {
  member: IDLNamespaceMember;
  /** The declaring namespace or partial supplies this member's exposure conditions. */
  source: NamespaceDefinition | PartialNamespaceDefinition;
};

type OperationFilter = (
  operation: IDLOperation,
  entry: AssembledInterfaceMember | AssembledNamespaceMember,
) => boolean;

// https://webidl.spec.whatwg.org/#idl-interfaces
// https://webidl.spec.whatwg.org/#idl-interface-mixins
function assembleInterface(
  assembled: AssembledInterface,
  mixinMembers: Map<string, AssembledInterfaceMember[]>,
  includes: IncludesDefinition[] | undefined,
  assembly: DefinitionAssembly,
): void {
  const definition = assembled.primary;
  for (const member of definition.members) assembled.members.push({ member: assembleMember(member, assembly), source: definition });
  for (const partial of assembled.partials) {
    for (const member of partial.members) assembled.members.push({ member: assembleMember(member, assembly), source: partial });
  }
  for (const include of includes ?? []) {
    assembled.members.push(...mixinMembers.get(include.mixin)!);
  }
  for (const { member } of assembled.members) {
    if (member.kind === 'operation' || member.kind === 'constructor' || member.kind === 'async-iterable') {
      assembled.callables.add(member);
    }
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
  for (const partial of assembled.partials) members.push(...partial.members);
  // Web IDL identifiers are ASCII, so code-unit and code-point order coincide.
  members.sort((left, right) => {
    if (left.name < right.name) return -1;
    if (left.name > right.name) return 1;
    return 0;
  });
  if (assembled.parentAssembled) assembled.members.push(...assembled.parentAssembled.members);
  for (const member of members) assembled.members.push(new AssembledDictionaryMember(member, assembly));
}

// Visit each ancestry once; only an unfinished path can contain an inheritance cycle.
function validateInheritance<Assembled extends {
  primary: { name: string; };
  parentAssembled: Assembled | undefined;
}>(definitions: Iterable<Assembled>): void {
  const visited = new Set<Assembled>();
  const visiting = new Set<Assembled>();
  for (const assembled of definitions) {
    for (let current: Assembled | undefined = assembled; current && !visited.has(current); current = current.parentAssembled) {
      if (visiting.has(current)) throw new InternalError(`Inheritance cycle involving ${current.primary.name}`);
      visiting.add(current);
    }
    for (const current of visiting) visited.add(current);
    visiting.clear();
  }
}

// Expanding an alias must terminate, including aliases nested in containers.
// Named interfaces and dictionaries end expansion, so recursive value shapes remain valid.
function validateTypedef(
  type: WebIDLType, typedefs: AssembledTypedefs,
  visited: Set<WebIDLType>, visiting: Set<WebIDLType>,
): void {
  if (visited.has(type)) return;
  if (visiting.has(type)) throw new InternalError('Typedef expansion contains a cycle');
  visiting.add(type);
  switch (type.kind) {
    case 'reference': {
      const assembled = typedefs.get(type.name);
      if (assembled) validateTypedef(assembled.primary.type, typedefs, visited, visiting);
      break;
    }
    case 'annotated': case 'nullable': case 'sequence': case 'async-sequence':
    case 'frozen-array': case 'observable-array': case 'promise':
      validateTypedef(type.type, typedefs, visited, visiting);
      break;
    case 'union':
      for (const member of type.types) validateTypedef(member, typedefs, visited, visiting);
      break;
    case 'record':
      validateTypedef(type.key, typedefs, visited, visiting);
      validateTypedef(type.value, typedefs, visited, visiting);
      break;
  }
  visiting.delete(type);
  visited.add(type);
}

function appendValuesByName<Value>(
  valuesByName: Map<string, Value[]>,
  name: string,
  value: Value,
): void {
  const existing = valuesByName.get(name);
  if (existing) existing.push(value);
  else valuesByName.set(name, [value]);
}

// https://webidl.spec.whatwg.org/#idl-annotated-types
function assembleMemberType(type: WebIDLType, extendedAttributes: ExtendedAttribute[] | undefined): WebIDLType {
  const applicable = extendedAttributes?.filter((attribute) =>
    attribute.kind !== 'raw' && typeExtendedAttributeNames.has(attribute.name));
  if (!applicable?.length) return type;

  // Direct type annotations precede applicable argument/member attributes;
  // both precede attributes inherited through a typedef.
  if (type.kind === 'annotated') {
    return { ...type, type: assembleMemberType(type.type, applicable) };
  }
  return { extendedAttributes: applicable, kind: 'annotated', type };
}

// Interfaces and namespaces use the same grouping rules, with exposure selected by the binding.
function groupOperations(
  members: (AssembledInterfaceMember | AssembledNamespaceMember)[],
  callables: AssembledCallables,
  include: OperationFilter,
  assembly: DefinitionAssembly,
): Map<string, AssembledOverloads<AssembledCallable<IDLOperation>>> {
  const groups = new Map<string, AssembledCallable<IDLOperation>[]>();
  for (const entry of members) {
    const operation = entry.member;
    if (operation.kind !== 'operation' || !operation.name || !include(operation, entry)) continue;
    const key = `${operation.static === true ? 'static' : 'regular'}:${operation.name}`;
    const group = groups.get(key);
    const callable = callables.get(operation);
    if (group) group.push(callable);
    else groups.set(key, [callable]);
  }
  const overloads = new Map<string, AssembledOverloads<AssembledCallable<IDLOperation>>>();
  for (const [name, group] of groups) overloads.set(name, new AssembledOverloads(group, assembly));
  return overloads;
}

const typeExtendedAttributeNames = new Set([
  'AllowResizable', 'AllowShared', 'Clamp', 'EnforceRange', 'LegacyNullToEmptyString',
]);

function belongsAt(
  member: IDLAttribute | IDLOperation | StringifierMember,
  placement: MemberPlacement,
): boolean {
  const isStatic = member.kind !== 'stringifier' && member.static === true;
  if (placement === 'static') return isStatic;
  if (isStatic) return false;
  const unforgeable = hasExtendedAttribute(
    member.extendedAttributes,
    'LegacyUnforgeable',
  );
  return placement === 'unforgeable' ? unforgeable : !unforgeable;
}

/** Construction work held only until the assembly has indexed all named definitions. */
export type AssemblySteps = (assembly: DefinitionAssembly) => void;

export type IDLAttribute = Omit<AttributeMember, 'type'> & { type: IDLType; };
export type IDLConstant = Omit<ConstantMember, 'type'> & { type: IDLType; };
export type IDLOperation = Omit<OperationMember, 'returns' | 'arguments'> & { returns: IDLType; arguments: AssembledArgument[]; };
export type IDLConstructor = Omit<ConstructorMember, 'arguments'> & { arguments: AssembledArgument[]; };
export type IDLIterable = Omit<IterableMember, 'key' | 'value'> & { key?: IDLType; value: IDLType; };
export type IDLAsyncIterable = Omit<AsyncIterableMember, 'key' | 'value' | 'arguments'> & { key?: IDLType; value: IDLType; arguments?: AssembledArgument[]; };
export type IDLMaplike = Omit<MaplikeMember, 'key' | 'value'> & { key: IDLType; value: IDLType; };
export type IDLSetlike = Omit<SetlikeMember, 'value'> & { value: IDLType; };
export type IDLNamedArguments = Omit<NamedArgumentsExtendedAttribute, 'arguments'> & { arguments: AssembledArgument[]; };
export type IDLInterfaceMember = IDLAttribute | IDLConstant | IDLOperation | IDLConstructor | IDLIterable | IDLAsyncIterable | IDLMaplike | IDLSetlike | StringifierMember;
export type IDLNamespaceMember = IDLAttribute | IDLConstant | IDLOperation;

type MemberFromDeclaration<Member> =
  Member extends AttributeMember ? IDLAttribute : Member extends ConstantMember ? IDLConstant
    : Member extends OperationMember ? IDLOperation : Member extends ConstructorMember ? IDLConstructor
      : Member extends IterableMember ? IDLIterable : Member extends AsyncIterableMember ? IDLAsyncIterable
        : Member extends MaplikeMember ? IDLMaplike : Member extends SetlikeMember ? IDLSetlike : StringifierMember;

function assembleMember<Member extends InterfaceMember | MixinMember | NamespaceMember>(
  member: Member, assembly: DefinitionAssembly,
): MemberFromDeclaration<Member>;
function assembleMember(member: InterfaceMember | MixinMember | NamespaceMember, assembly: DefinitionAssembly): IDLInterfaceMember {
  switch (member.kind) {
    case 'attribute': case 'constant':
      return { ...member, type: assembly.getIDLType(assembleMemberType(member.type, member.extendedAttributes)) };
    case 'operation':
      return {
        ...member, returns: assembly.getIDLType(member.returns),
        arguments: member.arguments.map((argument) => new AssembledArgument(argument, assembly)),
      };
    case 'constructor':
      return { ...member, arguments: member.arguments.map((argument) => new AssembledArgument(argument, assembly)) };
    case 'async-iterable':
      return {
        ...member, key: member.key && assembly.getIDLType(member.key), value: assembly.getIDLType(member.value),
        arguments: member.arguments?.map((argument) => new AssembledArgument(argument, assembly)),
      };
    case 'iterable':
      return { ...member, key: member.key && assembly.getIDLType(member.key), value: assembly.getIDLType(member.value) };
    case 'maplike':
      return { ...member, key: assembly.getIDLType(member.key), value: assembly.getIDLType(member.value) };
    case 'setlike': return { ...member, value: assembly.getIDLType(member.value) };
    case 'stringifier': return member;
  }
}
