import { InternalError } from '../../infra/index';
import {
  hasExtendedAttribute, type ArgumentDefinition, type ExtendedAttribute, type ImplementationClass,
  type StringifierMember, type WebIDLType, type AttributeMember, type OperationMember, type ConstantMember,
  type ConstructorMember, type IterableMember, type AsyncIterableMember, type MaplikeMember, type SetlikeMember,
  type NamedArgumentsExtendedAttribute, type InterfaceMember, type MixinMember, type NamespaceMember,
  type DefaultValue, type CallbackExceptionBehavior,
} from '../core/index';

import { undefinedType, type IDLType, type IDLDictionaryType } from './types';
import type { AssembledInterface, AssembledInterfaceMember } from './interface';
import type { AssembledNamespaceMember } from './namespace';
import type { DefinitionAssembly } from './assembly';

/** Shared argument and result contract carried directly by compiled callable members. */
export class AssembledCallable {
  /** Arguments with aliases, nested types, and applicable conversion rules resolved. */
  arguments!: AssembledArgument[];
  /** The final argument's contract, reused for every value in a variadic tail. */
  variadicArgument: AssembledArgument | undefined;
  /** Smallest argument count admitted after omitting the optional and variadic suffix. */
  minimumArgumentCount!: number;
  /** Compiled return contract; constructors and iterable declarations return undefined here. */
  returns: IDLType;

  constructor(argumentsList: AssembledArgument[] = [], returns: IDLType = undefinedType) {
    this.returns = returns;
    this.setArguments(argumentsList);
  }

  /** Select a fixed argument or the repeated variadic argument. */
  getArgument(index: number): AssembledArgument | undefined {
    return this.arguments[index] ?? this.variadicArgument;
  }

  /** Finish a forward-declared callback using the same arity rules as other callables. */
  protected setArguments(argumentsList: AssembledArgument[]): void {
    this.arguments = argumentsList;
    const last = argumentsList.at(-1);
    this.variadicArgument = last?.optionality === 'variadic' ? last : undefined;
    let minimum = argumentsList.length;
    while (minimum > 0 && argumentsList[minimum - 1]!.optionality !== 'required') minimum--;
    this.minimumArgumentCount = minimum;
  }
}

/** An argument with its applicable conversion attributes incorporated into its type. */
export class AssembledArgument {
  /** Argument identifier used in IDL and conversion errors. */
  name: string;
  /** Conversion descriptor including applicable attributes such as [Clamp]. */
  type: IDLType;
  /** Whether the argument is required, optional, or repeated in a variadic tail. */
  optionality: ArgumentOptionality;
  /** IDL default used when an optional argument is absent or undefined. */
  default?: DefaultValue;
  /** Classes to try when implementation binding requests custom unwrapping. */
  implClasses?: ImplementationClass[];
  /** Compiled dictionary whose direct callbacks use the original argument as their receiver. */
  callbackDictionary?: IDLDictionaryType;
  /** Exception policy applied when the converted callback is invoked. */
  callbackExceptionBehavior?: CallbackExceptionBehavior;

  constructor(argument: ArgumentDefinition, assembly: DefinitionAssembly) {
    this.name = argument.name;
    this.type = assembly.getIDLType(assembleMemberType(argument.type, argument.extendedAttributes));
    this.optionality = argument.variadic ? 'variadic' : argument.optional ? 'optional' : 'required';
    this.default = argument.default;
    this.implClasses = argument.implClasses;
    this.callbackExceptionBehavior = argument.callbackExceptionBehavior;
    if (argument.callbackDictionary) {
      const dictionary = assembly.getIDLType(argument.callbackDictionary);
      if (dictionary.kind !== 'dictionary') {
        throw new InternalError(`Callback dictionary for ${argument.name} must be a dictionary`);
      }
      this.callbackDictionary = dictionary;
    }
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
  #candidatesByArgumentCount: OverloadGroup<Callable>[] = [];

  constructor(callables: Callable[]) {
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
          const first = candidates[0]!.getArgument(index)!.type.overloadKey;
          if (candidates.some((candidate) =>
            candidate.getArgument(index)!.type.overloadKey !== first)) {
            distinguishingIndex = index;
            break;
          }
        }
      }
      this.#candidatesByArgumentCount.push(new OverloadGroup(candidates, distinguishingIndex));
    }
  }

  /** Return the shared candidates for an invocation; callers must not modify the list. */
  getCandidates(argumentCount: number): OverloadGroup<Callable> {
    return this.#candidatesByArgumentCount[Math.min(argumentCount, this.#candidatesByArgumentCount.length - 1)]!;
  }
}

export type IDLAttribute = Omit<AttributeMember, 'type'> & { type: IDLType; };
export type IDLConstant = Omit<ConstantMember, 'type'> & { type: IDLType; };
export type IDLOperation = Omit<OperationMember, 'returns' | 'arguments'> & AssembledCallable;
export type IDLConstructor = Omit<ConstructorMember, 'arguments'> & AssembledCallable;
export type IDLIterable = Omit<IterableMember, 'key' | 'value'> & { key?: IDLType; value: IDLType; };
export type IDLAsyncIterable = Omit<AsyncIterableMember, 'key' | 'value' | 'arguments'> & AssembledCallable & { key?: IDLType; value: IDLType; };
export type IDLMaplike = Omit<MaplikeMember, 'key' | 'value'> & { key: IDLType; value: IDLType; };
export type IDLSetlike = Omit<SetlikeMember, 'value'> & { value: IDLType; };
export type IDLNamedArguments = Omit<NamedArgumentsExtendedAttribute, 'arguments'> & AssembledCallable;
export type IDLInterfaceMember = IDLAttribute | IDLConstant | IDLOperation | IDLConstructor | IDLIterable | IDLAsyncIterable | IDLMaplike | IDLSetlike | StringifierMember;
export type IDLNamespaceMember = IDLAttribute | IDLConstant | IDLOperation;
export type MemberPlacement = 'regular' | 'static' | 'unforgeable';

/** An attribute with the declaration that controls its exposure. */
export type AttributeEntry<Member> = Member & { member: IDLAttribute; };

export type OperationFilter = (
  operation: IDLOperation,
  entry: AssembledInterfaceMember | AssembledNamespaceMember,
) => boolean;

type ArgumentOptionality = 'required' | 'optional' | 'variadic';

/** One argument-count group's shared candidates and lazy distinguishing-type selections. */
export class OverloadGroup<Callable extends AssembledCallable> {
  callables: Callable[];
  distinguishingIndex: number;
  /** Proxy recognition depends on the incoming value, not just its assembled interface. */
  hasProxyCandidates: boolean;
  #primitiveCandidates?: PrimitiveOverloadCandidates<Callable>;
  /** Reuse interface and object matches for every instance of the same concrete interface. */
  #candidatesByInterface = new Map<AssembledInterface, Callable[]>();

  constructor(callables: Callable[], distinguishingIndex: number) {
    this.callables = callables;
    this.distinguishingIndex = distinguishingIndex;
    this.hasProxyCandidates = distinguishingIndex >= 0 && callables.some((callable) =>
      callable.getArgument(distinguishingIndex)!.type.candidates.interfaces.some((type) => type.kind === 'proxy-object'));
  }

  /** Retain interface and object matches for this concrete interface; proxy matches remain value-dependent. */
  getInterfaceCandidates(assembled: AssembledInterface): Callable[] {
    let candidates = this.#candidatesByInterface.get(assembled);
    if (!candidates) {
      candidates = this.callables.filter((callable) => {
        const branches = callable.getArgument(this.distinguishingIndex)!.type.candidates;
        return branches.hasObject || branches.interfaces.some((type) =>
          type.kind === 'interface' && assembled.implements(type.assembled));
      });
      this.#candidatesByInterface.set(assembled, candidates);
    }
    return candidates;
  }

  /** Retain every match in declaration order; callers must not modify these lists. */
  get primitiveCandidates(): PrimitiveOverloadCandidates<Callable> {
    if (this.#primitiveCandidates) return this.#primitiveCandidates;
    const candidates: PrimitiveOverloadCandidates<Callable> = {
      boolean: [], numeric: [], bigint: [], symbol: [], string: [], any: [],
    };
    for (const callable of this.callables) {
      const branches = callable.getArgument(this.distinguishingIndex)!.type.candidates;
      if (branches.hasBoolean) candidates.boolean.push(callable);
      if (branches.numeric) candidates.numeric.push(callable);
      if (branches.hasBigInt) candidates.bigint.push(callable);
      if (branches.string) candidates.string.push(callable);
      if (branches.hasAny) candidates.any.push(callable);
      if (branches.hasSymbol) candidates.symbol.push(callable);
    }
    return this.#primitiveCandidates = candidates;
  }
}

type PrimitiveOverloadCandidates<Callable> = Record<'boolean' | 'numeric' | 'bigint' | 'symbol' | 'string' | 'any', Callable[]>;

type MemberFromDeclaration<Member> =
  Member extends AttributeMember ? IDLAttribute : Member extends ConstantMember ? IDLConstant
    : Member extends OperationMember ? IDLOperation : Member extends ConstructorMember ? IDLConstructor
      : Member extends IterableMember ? IDLIterable : Member extends AsyncIterableMember ? IDLAsyncIterable
        : Member extends MaplikeMember ? IDLMaplike : Member extends SetlikeMember ? IDLSetlike : StringifierMember;

export function assembleMember<Member extends InterfaceMember | MixinMember | NamespaceMember>(
  member: Member, assembly: DefinitionAssembly,
): MemberFromDeclaration<Member>;

export function assembleMember(member: InterfaceMember | MixinMember | NamespaceMember, assembly: DefinitionAssembly): IDLInterfaceMember {
  switch (member.kind) {
    case 'attribute': case 'constant':
      return { ...member, type: assembly.getIDLType(assembleMemberType(member.type, member.extendedAttributes)) };
    case 'operation': {
      const { arguments: argumentsList, returns, ...metadata } = member;
      return Object.assign(new AssembledCallable(
        argumentsList.map((argument) => new AssembledArgument(argument, assembly)), assembly.getIDLType(returns),
      ), metadata);
    }
    case 'constructor': {
      const { arguments: argumentsList, ...metadata } = member;
      return Object.assign(new AssembledCallable(
        argumentsList.map((argument) => new AssembledArgument(argument, assembly)),
      ), metadata);
    }
    case 'async-iterable': {
      const { arguments: argumentsList, key, value, ...metadata } = member;
      return Object.assign(new AssembledCallable(
        argumentsList?.map((argument) => new AssembledArgument(argument, assembly)),
      ), metadata, { key: key && assembly.getIDLType(key), value: assembly.getIDLType(value) });
    }
    case 'iterable':
      return { ...member, key: member.key && assembly.getIDLType(member.key), value: assembly.getIDLType(member.value) };
    case 'maplike':
      return { ...member, key: assembly.getIDLType(member.key), value: assembly.getIDLType(member.value) };
    case 'setlike': return { ...member, value: assembly.getIDLType(member.value) };
    case 'stringifier': return member;
  }
}

// https://webidl.spec.whatwg.org/#idl-annotated-types
export function assembleMemberType(type: WebIDLType, extendedAttributes: ExtendedAttribute[] | undefined): WebIDLType {
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

const typeExtendedAttributeNames = new Set([
  'AllowResizable', 'AllowShared', 'Clamp', 'EnforceRange', 'LegacyNullToEmptyString',
]);

// Interfaces and namespaces use the same grouping rules, with exposure selected by the binding.
export function groupOperations(
  members: (AssembledInterfaceMember | AssembledNamespaceMember)[],
  include: OperationFilter,
): Map<string, AssembledOverloads<IDLOperation>> {
  const groups = new Map<string, IDLOperation[]>();
  for (const entry of members) {
    const operation = entry.member;
    if (operation.kind !== 'operation' || !operation.name || !include(operation, entry)) continue;
    const key = `${operation.static === true ? 'static' : 'regular'}:${operation.name}`;
    const group = groups.get(key);
    if (group) group.push(operation);
    else groups.set(key, [operation]);
  }
  const overloads = new Map<string, AssembledOverloads<IDLOperation>>();
  for (const [name, group] of groups) overloads.set(name, new AssembledOverloads(group));
  return overloads;
}

export function belongsAt(
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
