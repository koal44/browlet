import type {
  CallbackFunctionDefinition, CallbackInterfaceDefinition, DictionaryDefinition, DictionaryMember,
  ConstructorMember, EnumerationDefinition, MaplikeMember, ProxyObjectDefinition, SetlikeMember,
  TypedefDefinition, PartialDictionaryDefinition, PrimaryInterfaceDefinition, InterfaceMember,
  PartialInterfaceDefinition, InterfaceMixinDefinition, MixinMember, PartialInterfaceMixinDefinition,
  NamespaceDefinition, NamespaceMember, PartialNamespaceDefinition, Definition, IncludesDefinition,
} from './core/declarations';
import type {
  AttributeMember, ExtendedAttribute, ImplementationClass, NamedArgumentsExtendedAttribute,
  OperationMember, ReferenceType, WebIDLType,
} from './core/types';
import { hasExtendedAttribute } from './core/helpers';
import type { SerialSteps, TransferSteps } from './core/structured-data';
import { InternalError } from '../infra/internal-error';
import type { DefinitionAssembly, ConversionType } from './assembly';

/** An interface with its parent, partial declarations, and included mixin members. */
export class AssembledInterface {
  name: string;
  primary: PrimaryInterfaceDefinition;
  parentAssembled: AssembledInterface | undefined;
  /** Serialization steps for this exact interface, including any inherited state. */
  serialSteps: SerialSteps | undefined;
  /** Transfer steps for this exact interface. */
  transferSteps: TransferSteps | undefined;
  /** Partial declarations retain their own exposure and other extended attributes. */
  partials: PartialInterfaceDefinition[];
  /** Own, partial, and included mixin members; inherited members remain on the parent interface. */
  members: AssembledInterfaceMember[] = [];

  constructor(primary: PrimaryInterfaceDefinition, partials: PartialInterfaceDefinition[] = []) {
    this.name = primary.name;
    this.primary = primary;
    this.serialSteps = primary.serialSteps;
    this.transferSteps = primary.transferSteps;
    this.partials = partials;
  }

  /** Whether this interface or one of its ancestors has the requested primary declaration. */
  implements(expectedAssembled: AssembledInterface): boolean {
    if (this.primary === expectedAssembled.primary) return true;
    let assembled = this.parentAssembled;
    while (assembled) {
      if (assembled.primary === expectedAssembled.primary) return true;
      assembled = assembled.parentAssembled;
    }
    return false;
  }

  /** List interfaces from the oldest ancestor through this interface. */
  getInheritanceChain(): AssembledInterface[] {
    const inheritance: AssembledInterface[] = [this];
    let assembled = this.parentAssembled;
    while (assembled) {
      inheritance.unshift(assembled);
      assembled = assembled.parentAssembled;
    }
    return inheritance;
  }

  /** Whether the member belongs to this interface or an ancestor. */
  includesMember(member: InterfaceMember | MixinMember): boolean {
    if (this.members.some((entry) => entry.member === member)) return true;
    let assembled = this.parentAssembled;
    while (assembled) {
      if (assembled.members.some((entry) => entry.member === member)) return true;
      assembled = assembled.parentAssembled;
    }
    return false;
  }

  /** Find the nearest ancestor's matching attribute for an inherited accessor. */
  getInheritedAttribute(attribute: AttributeMember): AttributeMember {
    let assembled = this.parentAssembled;
    while (assembled) {
      for (let i = assembled.members.length - 1; i >= 0; i--) {
        const member = assembled.members[i]?.member;
        if (
          member?.kind === 'attribute' &&
          member.name === attribute.name &&
          Boolean(member.static) === Boolean(attribute.static)
        ) return member;
      }
      assembled = assembled.parentAssembled;
    }
    throw new InternalError(
      `Inherited attribute ${this.name}.${attribute.name} has no ancestor declaration`,
    );
  }

  /** Find a directly contributed member of the requested kind, retaining its exposure source. */
  findMemberByKind<Kind extends InterfaceMember['kind']>(kind: Kind): InterfaceMemberEntry<Kind> | undefined {
    return this.members.find((entry): entry is InterfaceMemberEntry<Kind> => entry.member.kind === kind);
  }

  /** Find the maplike or setlike declaration, optionally continuing through ancestors. */
  getCollectionDeclaration(includeInherited = false): MaplikeMember | SetlikeMember | undefined {
    for (const { member } of this.members) {
      if (member.kind === 'maplike' || member.kind === 'setlike') return member;
    }
    return includeInherited ? this.parentAssembled?.getCollectionDeclaration(true) : undefined;
  }

  /** Whether an explicit instance operation replaces a generated collection method. */
  hasInstanceOperation(name: string): boolean {
    return this.members.some(({ member }) =>
      member.kind === 'operation' && member.name === name && member.static !== true);
  }

  /** Group accepted operation overloads by name and static/instance placement. */
  getOperationGroups(include: OperationFilter): Map<string, OperationMember[]> {
    return groupOperations(this.members, include);
  }

  /** Find the nearest indexed or named special operation, resolving aliases on its key argument. */
  // https://webidl.spec.whatwg.org/#idl-indexed-properties
  // https://webidl.spec.whatwg.org/#idl-named-properties
  findSpecialOperation(
    special: 'deleter' | 'getter' | 'setter',
    keyType: 'DOMString' | 'unsigned long',
    assembly: DefinitionAssembly,
  ): OperationMember | undefined {
    for (const { member } of this.members) {
      if (member.kind !== 'operation' || member.special !== special) continue;
      const key = member.arguments[0];
      if (!key) continue;
      const type = assembly.getUnannotatedType(key.type);
      if (type.kind === 'simple' && type.name === keyType) return member;
    }
    return this.parentAssembled?.findSpecialOperation(special, keyType, assembly);
  }

  /** Collect constructors accepted by the caller's exposure check. */
  getConstructors(include: (entry: AssembledInterfaceMember) => boolean): ConstructorMember[] {
    const constructors: ConstructorMember[] = [];
    for (const entry of this.members) {
      if (entry.member.kind === 'constructor' && include(entry)) constructors.push(entry.member);
    }
    return constructors;
  }

  /** Find the stringifier accepted by the caller's exposure check. */
  getStringifier(include: (entry: AssembledInterfaceMember) => boolean): StringifierEntry | undefined {
    return this.members.find((entry): entry is StringifierEntry => {
      const member = entry.member;
      return (member.kind === 'stringifier' ||
        (member.kind === 'attribute' && member.stringifier === true)) && include(entry);
    });
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
    return this.members.some(({ member }) =>
      member.kind === 'operation' && member.name === 'toJSON' &&
      hasExtendedAttribute(member.extendedAttributes, 'Default'));
  }

  /** Whether this interface or an ancestor declares a toJSON operation. */
  hasToJSON(): boolean {
    return this.members.some(({ member }) => member.kind === 'operation' && member.name === 'toJSON') ||
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

  /** Collect one legacy factory's overload declarations across interface fragments. */
  getLegacyFactoryOverloads(name: string): NamedArgumentsExtendedAttribute[] {
    const overloads: NamedArgumentsExtendedAttribute[] = [];
    for (const definition of [this.primary, ...this.partials]) {
      for (const attribute of definition.extendedAttributes ?? []) {
        if (
          attribute.kind === 'named-arguments' &&
          attribute.name === 'LegacyFactoryFunction' &&
          attribute.value === name
        ) overloads.push(attribute);
      }
    }
    return overloads;
  }

  /** Collect distinct legacy factory names across interface fragments. */
  getLegacyFactoryNames(): string[] {
    const names = new Set<string>();
    for (const definition of [this.primary, ...this.partials]) {
      for (const attribute of definition.extendedAttributes ?? []) {
        if (
          attribute.kind === 'named-arguments' &&
          attribute.name === 'LegacyFactoryFunction'
        ) names.add(attribute.value);
      }
    }
    return [...names];
  }
}

/** A callback interface used for conversion and invocation. */
export class AssembledCallbackInterface {
  primary: CallbackInterfaceDefinition;
  /** Operation declarations used to convert callback arguments and results. */
  operationsByName = new Map<string, OperationMember>();

  constructor(primary: CallbackInterfaceDefinition) {
    this.primary = primary;
    for (const member of primary.members) {
      if (member.kind !== 'operation' || member.name === undefined) continue;
      if (!this.operationsByName.has(member.name)) this.operationsByName.set(member.name, member);
    }
  }

  /** Find the declared operation required by callback invocation. */
  getOperation(name: string): OperationMember {
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
    return this.primary.exposed !== undefined && this.primary.members.some((member) => member.kind === 'constant');
  }
}

/** A callback function's argument and result contract. */
export class AssembledCallbackFunction {
  primary: CallbackFunctionDefinition;

  constructor(primary: CallbackFunctionDefinition) {
    this.primary = primary;
  }

  /** Whether legacy callback attributes accept non-object values as null. */
  treatsNonObjectAsNull(): boolean {
    return hasExtendedAttribute(this.primary.extendedAttributes, 'LegacyTreatNonObjectAsNull');
  }
}

/** A namespace with the members contributed by its primary and partial declarations. */
// https://webidl.spec.whatwg.org/#idl-namespaces
export class AssembledNamespace {
  primary: NamespaceDefinition;
  partials: PartialNamespaceDefinition[];
  members: AssembledNamespaceMember[] = [];

  constructor(primary: NamespaceDefinition, partials: PartialNamespaceDefinition[] = []) {
    this.primary = primary;
    this.partials = partials;
    for (const member of primary.members) this.members.push({ member, source: primary });
    for (const partial of partials) {
      for (const member of partial.members) this.members.push({ member, source: partial });
    }
  }

  /** Group accepted operation overloads by name and static/instance placement. */
  getOperationGroups(include: OperationFilter): Map<string, OperationMember[]> {
    return groupOperations(this.members, include);
  }
}

/** A dictionary with its inherited and partial members in conversion order. */
export class AssembledDictionary {
  primary: DictionaryDefinition;
  parentAssembled: AssembledDictionary | undefined;
  partials: PartialDictionaryDefinition[];
  /** Conversion reads inherited members first, then lexicographically sorted own and partial members. */
  members: DictionaryMember[] = [];
  /** Member lookup includes inherited, primary, and partial declarations. */
  membersByName = new Map<string, DictionaryMember>();

  constructor(primary: DictionaryDefinition, partials: PartialDictionaryDefinition[] = []) {
    this.primary = primary;
    this.partials = partials;
  }

  /** A dictionary is a JSON type only when all of its member types are JSON types. */
  isJSONType(assembly: DefinitionAssembly, seen: Set<string>): boolean {
    return this.members.every((member) => assembly.isJSONType(member.type, seen));
  }
}

/** An enumeration's accepted string values. */
export class AssembledEnumeration {
  primary: EnumerationDefinition;

  constructor(primary: EnumerationDefinition) {
    this.primary = primary;
  }

  /** Accept only strings declared by this enumeration. */
  hasValue(value: string): boolean {
    return this.primary.values.includes(value);
  }
}

/** A named type alias followed during type resolution. */
export class AssembledTypedef {
  primary: TypedefDefinition;

  constructor(primary: TypedefDefinition) {
    this.primary = primary;
  }
}

/** A proxy type's recognition and receiver-resolution hooks. */
export class AssembledProxyObject {
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
  byName = new Map<string, AssembledInterface>();
  byImplClass = new Map<ImplementationClass, AssembledInterface>();

  constructor(definitions: Definition[]) {
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
          append(interfacePartialsByName, definition.name, definition);
          break;
        case 'partial-interface-mixin':
          append(mixinPartialsByName, definition.name, definition);
          break;
        case 'includes':
          append(includesByInterfaceName, definition.interface, definition);
          break;
      }
    }

    // Create all interfaces before linking parents, which can appear later in the declarations.
    for (const definition of definitions) {
      if (definition.kind !== 'interface') continue;
      this.byName.set(definition.name, new AssembledInterface(
        definition, interfacePartialsByName.get(definition.name),
      ));
    }

    for (const assembled of this.values()) {
      assembleInterface(
        assembled,
        this,
        mixinsByName,
        mixinPartialsByName,
        includesByInterfaceName.get(assembled.name),
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
      const implementation = definition.implementation;
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
  getReference(implClass: ImplementationClass): ReferenceType {
    const assembled = this.byImplClass.get(implClass);
    if (!assembled) throw new InternalError('No interface declares the referenced implementation class');
    return { kind: 'reference', name: assembled.name };
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

/** Select callback interfaces referenced by candidate types or exposed as legacy objects. */
export class AssembledCallbackInterfaces extends Map<string, AssembledCallbackInterface> {
  constructor(definitions: Definition[]) {
    super();
    for (const definition of definitions) {
      if (definition.kind === 'callback-interface') {
        this.set(definition.name, new AssembledCallbackInterface(definition));
      }
    }
  }

  /** Find the first candidate type that names one of these callback interfaces. */
  findReferenced(candidates: ConversionType[]): AssembledCallbackInterface | undefined {
    return findReferencedDefinition(this, candidates);
  }

  /** Visit declarations eligible for a legacy callback interface object before realm exposure checks. */
  *withInterfaceObjects(): IterableIterator<AssembledCallbackInterface> {
    for (const assembled of this.values()) {
      if (assembled.hasInterfaceObject()) yield assembled;
    }
  }
}

/** Select callback functions referenced by candidate types. */
export class AssembledCallbackFunctions extends Map<string, AssembledCallbackFunction> {
  constructor(definitions: Definition[]) {
    super();
    for (const definition of definitions) {
      if (definition.kind === 'callback-function') {
        this.set(definition.name, new AssembledCallbackFunction(definition));
      }
    }
  }

  /** Find the first candidate type that names one of these callback functions. */
  findReferenced(candidates: ConversionType[]): AssembledCallbackFunction | undefined {
    return findReferencedDefinition(this, candidates);
  }
}

/** Combine namespace fragments and index the assembled namespaces by IDL name. */
export class AssembledNamespaces extends Map<string, AssembledNamespace> {
  constructor(definitions: Definition[]) {
    super();
    const partialsByName = new Map<string, PartialNamespaceDefinition[]>();
    for (const definition of definitions) {
      if (definition.kind === 'partial-namespace') append(partialsByName, definition.name, definition);
    }
    for (const definition of definitions) {
      if (definition.kind === 'namespace') {
        this.set(definition.name, new AssembledNamespace(definition, partialsByName.get(definition.name)));
      }
    }
  }
}

/** Select dictionaries referenced by candidate types. */
export class AssembledDictionaries extends Map<string, AssembledDictionary> {
  constructor(definitions: Definition[]) {
    super();
    const partialsByName = new Map<string, PartialDictionaryDefinition[]>();
    for (const definition of definitions) {
      if (definition.kind === 'partial-dictionary') append(partialsByName, definition.name, definition);
    }
    for (const definition of definitions) {
      if (definition.kind === 'dictionary') {
        this.set(definition.name, new AssembledDictionary(definition, partialsByName.get(definition.name)));
      }
    }

    const visited = new Set<AssembledDictionary>();
    for (const assembled of this.values()) assembleDictionary(assembled, this, visited);
  }

  /** Find the first candidate type that names one of these dictionaries. */
  findReferenced(candidates: ConversionType[]): AssembledDictionary | undefined {
    return findReferencedDefinition(this, candidates);
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
  constructor(definitions: Definition[]) {
    super();
    for (const definition of definitions) {
      if (definition.kind === 'typedef') this.set(definition.name, new AssembledTypedef(definition));
    }
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

type StringifierEntry = InterfaceMemberEntry<'stringifier' | 'attribute'>;

export type AssembledInterfaceMember = {
  member: InterfaceMember | MixinMember;
  /** The declaring construct supplies exposure conditions for this member. */
  source:
    | PrimaryInterfaceDefinition
    | PartialInterfaceDefinition
    | InterfaceMixinDefinition
    | PartialInterfaceMixinDefinition;
};

type InterfaceMemberEntry<Kind extends InterfaceMember['kind']> = AssembledInterfaceMember & {
  member: Extract<InterfaceMember, { kind: Kind; }>;
};

export type AssembledNamespaceMember = {
  member: NamespaceMember;
  /** The declaring namespace or partial supplies this member's exposure conditions. */
  source: NamespaceDefinition | PartialNamespaceDefinition;
};

type OperationFilter = (
  operation: OperationMember,
  entry: AssembledInterfaceMember | AssembledNamespaceMember,
) => boolean;

// https://webidl.spec.whatwg.org/#idl-interfaces
// https://webidl.spec.whatwg.org/#idl-interface-mixins
function assembleInterface(
  assembled: AssembledInterface,
  interfaces: AssembledInterfaces,
  mixinsByName: Map<string, InterfaceMixinDefinition>,
  mixinPartialsByName: Map<string, PartialInterfaceMixinDefinition[]>,
  includes?: IncludesDefinition[],
): void {
  const definition = assembled.primary;
  if (definition.inherits) assembled.parentAssembled = interfaces.get(definition.inherits);
  for (const member of definition.members) assembled.members.push({ member, source: definition });
  for (const partial of assembled.partials) {
    for (const member of partial.members) assembled.members.push({ member, source: partial });
  }
  for (const include of includes ?? []) {
    const mixin = mixinsByName.get(include.mixin);
    if (!mixin) continue;
    for (const member of mixin.members) assembled.members.push({ member, source: mixin });
    for (const partial of mixinPartialsByName.get(mixin.name) ?? []) {
      for (const member of partial.members) assembled.members.push({ member, source: partial });
    }
  }
}

// https://webidl.spec.whatwg.org/#js-dictionary
function assembleDictionary(
  assembled: AssembledDictionary,
  dictionaries: AssembledDictionaries,
  visited: Set<AssembledDictionary>,
): void {
  if (visited.has(assembled)) return;
  visited.add(assembled);

  const definition = assembled.primary;
  if (definition.inherits) {
    assembled.parentAssembled = dictionaries.get(definition.inherits);
    if (assembled.parentAssembled) assembleDictionary(assembled.parentAssembled, dictionaries, visited);
  }

  const members = [...definition.members];
  for (const partial of assembled.partials) members.push(...partial.members);
  // Web IDL identifiers are ASCII, so code-unit and code-point order coincide.
  members.sort((left, right) => {
    if (left.name < right.name) return -1;
    if (left.name > right.name) return 1;
    return 0;
  });
  if (assembled.parentAssembled) assembled.members.push(...assembled.parentAssembled.members);
  assembled.members.push(...members);
  for (const member of assembled.members) {
    if (!assembled.membersByName.has(member.name)) assembled.membersByName.set(member.name, member);
  }
}

function append<Value>(
  valuesByName: Map<string, Value[]>,
  name: string,
  value: Value,
): void {
  const existing = valuesByName.get(name);
  if (existing) existing.push(value);
  else valuesByName.set(name, [value]);
}

// Interfaces and namespaces use the same grouping rules, with exposure selected by the binding.
function groupOperations(
  members: (AssembledInterfaceMember | AssembledNamespaceMember)[],
  include: OperationFilter,
): Map<string, OperationMember[]> {
  const groups = new Map<string, OperationMember[]>();
  for (const entry of members) {
    const operation = entry.member;
    if (operation.kind !== 'operation' || !operation.name || !include(operation, entry)) continue;
    const key = `${operation.static === true ? 'static' : 'regular'}:${operation.name}`;
    const group = groups.get(key);
    if (group) group.push(operation);
    else groups.set(key, [operation]);
  }
  return groups;
}

// Preserve the candidate type order supplied by union conversion.
function findReferencedDefinition<Assembled>(
  assembledByName: Map<string, Assembled>,
  candidates: ConversionType[],
): Assembled | undefined {
  for (const { type } of candidates) {
    if (type.kind !== 'reference') continue;
    const assembled = assembledByName.get(type.name);
    if (assembled) return assembled;
  }
}
