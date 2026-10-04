import type { InterfaceMember, NamespaceMember, NamedArgumentsExtendedAttribute } from '../../src/web-idl/core/index';
import { AssembledInterface, type AssembledNamespace } from '../../src/web-idl/assembly/index';
import type { ImplementationBinding } from '../../src/web-idl/binding/realm/implementation';
import type { MemberBinding } from '../../src/web-idl/binding/realm/member';

/** Locate a declaration's compiled member before attaching test-specific binding steps. */
export function getMemberBinding<Assembled extends AssembledInterface | AssembledNamespace>(
  binding: ImplementationBinding<Assembled>,
  declaration: InterfaceMember | NamespaceMember | NamedArgumentsExtendedAttribute,
): MemberBinding<Assembled> {
  const assembled = binding.assembled;
  if (declaration.kind === 'named-arguments' && assembled instanceof AssembledInterface) {
    let index = 0;
    for (const source of [assembled.primary, ...assembled.partials]) {
      for (const attribute of source.extendedAttributes ?? []) {
        if (attribute.kind !== 'named-arguments' || attribute.value !== declaration.value) continue;
        if (attribute === declaration) {
          const factory = assembled.getLegacyFactoryOverloads(declaration.value);
          return binding.getOrCreateMemberBinding(factory.callables[index]!);
        }
        index++;
      }
    }
  }
  const positions = new Map<object, number>();
  for (const { member, source } of assembled.members) {
    const index = positions.get(source) ?? 0;
    if (source.members[index] === declaration) return binding.getOrCreateMemberBinding(member);
    positions.set(source, index + 1);
  }
  throw new Error('The test declaration has no assembled member');
}
