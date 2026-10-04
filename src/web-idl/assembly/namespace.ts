import { appendToMapList } from '../../infra/index';
import type { NamespaceDefinition, PartialNamespaceDefinition, Definition } from '../core/index';

import type { WebIDLRealm } from '../environment';

import { matchesExposure } from './exposure';
import {
  assembleMember, groupOperations, belongsAt, type AssembledOverloads, type IDLOperation,
  type IDLNamespaceMember, type MemberPlacement, type AttributeEntry, type OperationFilter,
} from './member';
import type { AssembledInterfaceMember } from './interface';
import type { AssemblySteps } from './assembly';

/** A namespace with the members contributed by its primary and partial declarations. */
// https://webidl.spec.whatwg.org/#idl-namespaces
export class AssembledNamespace {
  /** Original namespace declaration before adding partial members. */
  primary: NamespaceDefinition;
  /** Partial declarations contributing members and exposure conditions. */
  partials: PartialNamespaceDefinition[];
  /** Combined members paired with the declaration supplying their exposure conditions. */
  members: AssembledNamespaceMember[] = [];
  /** Attributes grouped by declared placement before realm exposure checks. */
  #attributesByPlacement = new Map<MemberPlacement, AttributeEntry<AssembledNamespaceMember>[]>();

  constructor(primary: NamespaceDefinition, partials: PartialNamespaceDefinition[] = [], finish: AssemblySteps[]) {
    this.primary = primary;
    this.partials = partials;
    finish.push((assembly) => {
      for (const member of primary.members) {
        this.members.push({
          member: assembleMember(member, assembly), source: primary,
        });
      }
      for (const partial of partials) {
        for (const member of partial.members) {
          this.members.push({
            member: assembleMember(member, assembly), source: partial,
          });
        }
      }
    });
  }

  /** Whether this namespace's declared exposure requirements match the realm. */
  isExposed(realm: WebIDLRealm): boolean {
    return matchesExposure(this.primary, realm);
  }

  /** Whether the namespace, contributing fragment, and member permit exposure. */
  isMemberExposed(entry: AssembledInterfaceMember | AssembledNamespaceMember, realm: WebIDLRealm): boolean {
    return this.isExposed(realm) &&
      matchesExposure(entry.source, realm) &&
      matchesExposure(entry.member, realm);
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
  ): Map<string, AssembledOverloads<IDLOperation>> {
    return groupOperations(this.members,
      (operation, entry) => belongsAt(operation, placement) && include(operation, entry));
  }
}

/** Combine namespace fragments and index the assembled namespaces by IDL name. */
export class AssembledNamespaces extends Map<string, AssembledNamespace> {
  constructor(definitions: Definition[], finish: AssemblySteps[]) {
    super();
    const partialsByName = new Map<string, PartialNamespaceDefinition[]>();
    for (const definition of definitions) {
      if (definition.kind === 'partial-namespace') appendToMapList(partialsByName, definition.name, definition);
    }
    for (const definition of definitions) {
      if (definition.kind === 'namespace') {
        this.set(definition.name, new AssembledNamespace(definition, partialsByName.get(definition.name), finish));
      }
    }
  }
}

export type AssembledNamespaceMember = {
  member: IDLNamespaceMember;
  /** The declaring namespace or partial supplies this member's exposure conditions. */
  source: NamespaceDefinition | PartialNamespaceDefinition;
};
