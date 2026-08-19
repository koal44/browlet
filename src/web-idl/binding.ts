export function defineInterface(
  definition: InterfaceDefinition,
): InterfaceDefinition {
  return definition;
}

export function defineMixin(
  definition: MixinDefinition,
): MixinDefinition {
  return definition;
}

export function definePartialInterface(
  definition: PartialInterfaceDefinition,
): PartialInterfaceDefinition {
  return definition;
}

export function operation(
  implementation?: PropertyKey,
): OperationDefinition {
  return implementation === undefined
    ? { kind: 'operation' }
    : { kind: 'operation', implementation };
}

export function attribute(
  implementation?: PropertyKey,
): AttributeDefinition {
  return implementation === undefined
    ? { kind: 'attribute', readonly: false }
    : { kind: 'attribute', implementation, readonly: false };
}

export function readonlyAttribute(
  implementation?: PropertyKey,
): AttributeDefinition {
  return implementation === undefined
    ? { kind: 'attribute', readonly: true }
    : { kind: 'attribute', implementation, readonly: true };
}

export function constant(
  implementation?: PropertyKey,
): ConstantDefinition {
  return implementation === undefined
    ? { kind: 'constant' }
    : { kind: 'constant', implementation };
}

export function assembleInterfaceMembers(
  definition: InterfaceDefinition,
  partials: readonly PartialInterfaceDefinition[] = [],
): ReadonlyMap<string, MemberDefinition> {
  const members = new Map<string, MemberDefinition>();

  for (const mixin of definition.includes ?? []) {
    addMembers(members, mixin.members);

    for (const partial of partials) {
      if (partial.target === mixin) addMembers(members, partial.members);
    }
  }

  addMembers(members, definition.members ?? {});

  for (const partial of partials) {
    if (partial.target === definition) addMembers(members, partial.members);
  }

  return members;
}

export function bindInterface(
  binding: InterfaceBinding,
  parent: InterfaceConstructor | undefined,
  partials: readonly PartialInterfaceDefinition[] = [],
): InterfaceConstructor {
  const construction = binding.construct;
  const Interface = function(this: object, ...argumentsList: unknown[]) {
    const newTarget = new.target as unknown as InterfaceConstructor | undefined;
    if (newTarget === undefined) {
      throw new TypeError(
        `Failed to construct '${binding.interface.name}': use the 'new' operator.`,
      );
    }

    if (!binding.interface.constructible || !construction) {
      throw new TypeError('Illegal constructor');
    }

    return construction(argumentsList, newTarget);
  };

  Object.defineProperty(Interface, 'name', {
    value: binding.interface.name,
  });
  if (parent) Object.setPrototypeOf(Interface, parent);

  const prototype = Object.create(
    parent?.prototype ?? Object.prototype,
  ) as object;
  Object.defineProperty(prototype, Symbol.toStringTag, {
    configurable: true,
    value: binding.interface.name,
  });
  const sources = binding.prototypeSources ?? [
    binding.implementation.prototype,
  ];

  for (const [name, member] of assembleInterfaceMembers(
    binding.interface,
    partials,
  )) {
    installMember(Interface, prototype, sources, name, member);
  }

  Object.defineProperty(prototype, 'constructor', {
    configurable: true,
    value: Interface,
    writable: true,
  });
  Object.defineProperty(Interface, 'prototype', { value: prototype });
  return Interface as unknown as InterfaceConstructor;
}

export type InterfaceDefinition = {
  readonly name: string;
  readonly parent?: InterfaceDefinition;
  readonly exposed?: '*' | readonly string[];
  readonly constructible?: boolean;
  readonly includes?: readonly MixinDefinition[];
  readonly members?: MemberDefinitions;
};

export type MixinDefinition = {
  readonly name: string;
  readonly members: MemberDefinitions;
};

export type PartialInterfaceDefinition = {
  readonly target: InterfaceDefinition | MixinDefinition;
  readonly members: MemberDefinitions;
};

export type InterfaceBinding = {
  readonly interface: InterfaceDefinition;
  readonly implementation: ImplementationConstructor<object>;
  readonly prototypeSources?: readonly object[];
  readonly construct?: InterfaceConstruction;
};

export type InterfaceConstruction = (
  argumentsList: readonly unknown[],
  newTarget: InterfaceConstructor,
) => object;

export type InterfaceConstructor = ImplementationConstructor<object> & {
  readonly prototype: object;
};

export type ImplementationConstructor<T extends object> = abstract new (
  ...argumentsList: never[]
) => T;

export type MemberDefinitions = Readonly<
  Record<string, MemberDefinition>
>;

export type MemberDefinition =
  | OperationDefinition
  | AttributeDefinition
  | ConstantDefinition;

export type OperationDefinition = {
  readonly kind: 'operation';
  readonly implementation?: PropertyKey;
};

export type AttributeDefinition = {
  readonly kind: 'attribute';
  readonly implementation?: PropertyKey;
  readonly readonly: boolean;
};

export type ConstantDefinition = {
  readonly kind: 'constant';
  readonly implementation?: PropertyKey;
};

function addMembers(
  target: Map<string, MemberDefinition>,
  source: MemberDefinitions,
): void {
  for (const [name, member] of Object.entries(source)) {
    target.set(name, member);
  }
}

function installMember(
  Interface: object,
  prototype: object,
  sources: readonly object[],
  name: string,
  member: MemberDefinition,
): void {
  const implementation = member.implementation ?? name;

  if (member.kind === 'constant') {
    const property = findProperty(sources, implementation, true);

    if (!property) {
      throw new TypeError(`Web IDL member ${name} has no implementation`);
    }

    const descriptor = {
      configurable: false,
      enumerable: true,
      value: Reflect.get(property.target, implementation) as unknown,
      writable: false,
    };

    Object.defineProperty(Interface, name, descriptor);
    Object.defineProperty(prototype, name, descriptor);
    return;
  }

  const property = findProperty(sources, implementation, false);
  if (!property) {
    throw new TypeError(`Web IDL member ${name} has no implementation`);
  }

  const { descriptor } = property;

  if (member.kind === 'operation') {
    if (typeof descriptor.value !== 'function') {
      throw new TypeError(
        `Web IDL operation ${name} is not implemented by a method`,
      );
    }

    Object.defineProperty(prototype, name, {
      configurable: true,
      enumerable: true,
      value: descriptor.value,
      writable: true,
    });
    return;
  }

  if (typeof descriptor.get !== 'function') {
    throw new TypeError(
      `Web IDL attribute ${name} is not implemented by an accessor`,
    );
  }

  Object.defineProperty(prototype, name, {
    ...descriptor,
    configurable: true,
    enumerable: true,
    // eslint-disable-next-line @typescript-eslint/unbound-method -- the Web IDL accessor keeps its dynamic receiver
    set: member.readonly ? undefined : descriptor.set,
  });
}

function findProperty(
  sources: readonly object[],
  property: PropertyKey,
  constructor: boolean,
): DescriptorSource | undefined {
  for (const source of sources) {
    const target = constructor
      ? (source as { constructor: object; }).constructor
      : source;
    const descriptor = Object.getOwnPropertyDescriptor(target, property);
    if (descriptor) return { descriptor, target };
  }
}

type DescriptorSource = {
  readonly descriptor: PropertyDescriptor;
  readonly target: object;
};
