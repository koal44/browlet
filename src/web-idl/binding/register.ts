import { InternalError, type InternalPromise } from '../../infra/index';
import { hasExtendedAttribute, type ImplementationClass, type InjectedArgument } from '../core/index';

import type {
  IDLAttribute, IDLOperation, IDLAsyncIterable, IDLConstructor, AssembledCallable, AssembledInterface,
} from '../assembly/index';

import type {
  AsyncIteratorSteps, ValuePairsSteps, AttributeSteps, ConstructorSteps, ImplementationConstructorSteps,
  MemberBinding, OperationSteps, StringificationBehavior,
} from './realm/index';
import type { RealmBinding } from './realm';
import type { AttributeBinding } from './extended-attributes';

/** Register implementation factories and member steps before the world publishes this realm. */
export function registerImplementationBindings(binding: RealmBinding): void {
  for (const assembled of binding.assembly.interfaces.values()) {
    registerInterfaceImplementation(binding, assembled);
  }
}

// Connect interface declarations to implementation members and factories.
function registerInterfaceImplementation(
  binding: RealmBinding,
  assembled: AssembledInterface,
): void {
  if (assembled.implementations.length === 0) return;
  const definition = assembled.implementations.length === 1 ? assembled.implementations[0] : undefined;

  const implClass = definition?.implClass;
  const implementationBinding = binding.getImplementationBinding(assembled);

  for (const { member } of assembled.members) {
    const memberBinding = implementationBinding.getOrCreateMemberBinding(member);
    switch (member.kind) {
      case 'attribute': {
        const accessors = binding.world.getAttributeBinding(member, assembled);
        if (accessors || member.attributeFunction || member.get || member.set) {
          registerDefinedAttribute(
            memberBinding, member, assembled, binding, accessors,
          );
        } else {
          if (member.static && !implClass) throw missingMemberBinding(assembled, member);
          registerAttribute(
            memberBinding,
            member,
            binding,
            member.static ? implClass : undefined,
          );
        }
        break;
      }
      case 'constructor': {
        if (hasExtendedAttribute(member.extendedAttributes, 'HTMLConstructor')) {
          const construct = binding.world.getHTMLConstructorBinding(assembled);
          if (!construct) throw new InternalError('[HTMLConstructor] requires HTML constructor hooks');
          implementationBinding.overriddenConstructor = (_values, newTarget, activeFunction) =>
            binding.callImplementation(construct, undefined, [binding, newTarget, activeFunction]);
          break;
        }
        if (member.construct) {
          const construct = member.construct;
          const convert = binding.implementationConverter.createArgumentConverter(member);
          memberBinding.constructorBehavior = {
            kind: 'construct',
            steps: (values) => {
              const args = convert ? convert(values, binding) : values;
              return binding.callImplementation(construct, undefined, [binding.getEnvironment(), ...args]);
            },
          };
          break;
        }
        if (!definition) {
          throw new InternalError(`${assembled.name} has multiple implementations; its constructor must select one explicitly`);
        }
        if (member.invoke) {
          memberBinding.constructorBehavior = {
            kind: 'initialize',
            steps: createDefinedConstructorSteps(
              member.invoke, member, binding,
            ),
          };
        } else {
          memberBinding.constructorBehavior = {
            kind: 'construct',
            steps: createImplementationConstructorSteps(
              definition.implClass,
              member,
              binding,
              member.constructWith ?? definition.constructWith,
            ),
          };
        }
        break;
      }
      case 'operation': {
        if (hasExtendedAttribute(member.extendedAttributes, 'Default')) break;
        if (member.invoke) {
          memberBinding.operationSteps = createDefinedOperationSteps(
            member.invoke, member, binding,
          );
        } else {
          const method = member.namedGetter ?? member.name;
          if (method === undefined) {
            throw missingMemberBinding(assembled, member);
          }
          if (member.static && !implClass) throw missingMemberBinding(assembled, member);
          registerOperation(
            memberBinding,
            member,
            method,
            binding,
            member.invokeWith,
            member.static ? implClass : undefined,
          );
        }
        const indexedGetter = member.indexedGetter;
        if (indexedGetter) {
          memberBinding.indexedPropertySteps = {
            ...('unsupportedValue' in indexedGetter ? {
              unsupportedValue: indexedGetter.unsupportedValue,
            } : {
              // Project adapter for Web IDL §2.5.6.1 Indexed properties — supported property indices.
              supportsIndex(index: number) {
                return binding.callImplementation(
                  indexedGetter.supportsIndex,
                  this,
                  [index],
                );
              },
            }),
            // Project adapter for Web IDL §2.5.6.1 Indexed properties — supported property indices.
            getSupportedPropertyIndices() {
              return binding.callImplementation(
                indexedGetter.getSupportedPropertyIndices,
                this,
                [],
              );
            },
          };
        }
        if (member.namedGetter !== undefined) {
          const getMethod = memberBinding.createMethodGetter<() => ReadonlySet<string>>('getSupportedPropertyNames');
          memberBinding.namedPropertySteps = {
            // Project adapter for Web IDL §2.5.6.2 Named properties — supported property names.
            getSupportedPropertyNames() {
              return binding.callImplementation(
                getMethod(this),
                this,
                [],
              );
            },
          };
        }
        break;
      }
      case 'iterable':
        if (member.key !== undefined) {
          registerPairIterable(
            memberBinding,
            binding,
          );
        }
        break;
      case 'async-iterable': {
        if (member.create === undefined) throw missingMemberBinding(assembled, member);
        memberBinding.asyncIteratorSteps = createAsyncIteratorSteps(
          memberBinding.createMethodGetter<(this: object, ...values: unknown[]) => object>(member.create),
          member,
          binding,
        );
        break;
      }
      case 'stringifier':
        registerStringifier(
          memberBinding,
          binding,
        );
        break;
    }
  }

  if (definition) {
    implementationBinding.createImplementation = () => binding.callImplementation(
      constructImplementationObject,
      undefined,
      [definition.implClass, binding.resolveArguments([], definition.constructWith ?? [])],
    );
  }
  if (assembled.implementations.some((implementation) => implementation.initializeImplementation)) {
    implementationBinding.initializeImplementation = (value) => {
      const initialize = assembled.getImplementation(value)?.initializeImplementation;
      if (initialize) binding.callImplementation(initialize, undefined, [binding.getEnvironment(), value]);
    };
  }
}

// Report an incomplete implementation registration.
function missingMemberBinding(
  assembled: AssembledInterface,
  member: { kind: string; name?: string; },
): InternalError {
  return new InternalError(
    `Web IDL ${assembled.primary.name}.${member.name ?? member.kind} has no binding`,
  );
}

// Register explicit getter, setter, or attribute-function adapters.
// Supplies attribute behavior to Web IDL §3.7.6 Attributes.
function registerDefinedAttribute(
  memberBinding: MemberBinding,
  member: IDLAttribute,
  assembled: AssembledInterface,
  binding: RealmBinding,
  accessors?: AttributeBinding,
): void {
  const createSteps = member.attributeFunction;
  const get = member.get;
  const set = member.set;
  const steps: AttributeSteps = {
    // Invoke a declared getter or obtain its realm-owned attribute function.
    get(receiver) {
      const owner = receiver?.binding ?? binding;
      if (createSteps) {
        return owner.getImplementationBinding(assembled).getOrCreateMemberBinding(member).getAttributeFunction(member, () => createSteps.call(undefined, owner.getEnvironment()));
      }
      if (accessors) {
        return binding.callImplementation(accessors.get, receiver?.implInst ?? null, [owner]);
      }
      if (!get) {
        throw new InternalError(
          `Web IDL attribute ${member.name} has no getter binding`,
        );
      }
      return binding.callImplementation(
        get,
        receiver?.implInst ?? null,
        [owner.getEnvironment()],
      );
    },
  };
  if ((accessors?.set || set) && !member.readonly) {
    const convert = binding.implementationConverter.createConverter(member.type, {
      callbackExceptionBehavior: member.callbackExceptionBehavior,
    });
    steps.set = (receiver, value) => {
      const operationBinding = receiver?.binding ?? binding;
      const converted = convert(value, operationBinding);
      if (accessors?.set) {
        binding.callImplementation(accessors.set, receiver?.implInst ?? null, [operationBinding, converted]);
        return;
      }
      binding.callImplementation(
        set!,
        receiver?.implInst ?? null,
        [
          operationBinding.getEnvironment(),
          converted,
        ],
      );
    };
  }
  memberBinding.attributeSteps = steps;
}

// Adapt converted constructor arguments for a declared initializer.
function createDefinedConstructorSteps(
  invoke: NonNullable<IDLConstructor['invoke']>,
  assembled: AssembledCallable,
  binding: RealmBinding,
): ConstructorSteps {
  const convert = binding.implementationConverter.createArgumentConverter(assembled);
  return (receiver, values) => {
    binding.callImplementation(
      invoke,
      receiver,
      [
        binding.getEnvironment(),
        ...(convert ? convert(values, binding) : values),
      ],
    );
  };
}

// Adapt converted constructor arguments and inject implementation dependencies.
function createImplementationConstructorSteps(
  implClass: ImplementationClass,
  assembled: AssembledCallable,
  binding: RealmBinding,
  injectedArguments: InjectedArgument[] = [],
): ImplementationConstructorSteps {
  const convert = binding.implementationConverter.createArgumentConverter(assembled);
  return (values) => binding.callImplementation(
    constructImplementationObject,
    undefined,
    [
      implClass,
      binding.resolveArguments(
        convert ? convert(values, binding) : values,
        injectedArguments,
      ),
    ],
  );
}

// Adapt converted arguments and the receiver environment for a declared invocation.
function createDefinedOperationSteps(
  invoke: NonNullable<IDLOperation['invoke']>,
  assembled: IDLOperation,
  binding: RealmBinding,
): OperationSteps {
  const convert = binding.implementationConverter.createArgumentConverter(assembled);
  return (receiver, values) => {
    const operationBinding = receiver?.binding ?? binding;
    return binding.callImplementation(
      invoke,
      receiver?.implInst ?? null,
      [
        operationBinding.getEnvironment(),
        ...(convert ? convert(values, operationBinding) : values),
      ],
    );
  };
}

// Adapt an implementation iterator to Web IDL's iteration hooks.
// Web IDL §2.5.10 Asynchronously iterable declarations.
function createAsyncIteratorSteps(
  getFactory: (target: object) => (this: object, ...values: unknown[]) => object,
  assembled: IDLAsyncIterable,
  binding: RealmBinding,
): AsyncIteratorSteps {
  const convert = binding.implementationConverter.createArgumentConverter(assembled);
  const steps: AsyncIteratorSteps = {
    // Project adapter for "asynchronous iterator initialization steps": call our iterator factory.
    create(target, argumentsList) {
      const values = convert ? convert(argumentsList, binding) : argumentsList;
      return binding.callImplementation(
        getFactory(target),
        target,
        values,
      );
    },
    // Project adapter for "get the next iteration result": invoke the implementation iterator.
    next(iterator: AsyncIteratorValue) {
      return binding.callImplementation(
        iterator.next,
        iterator,
        [],
      );
    },
  };
  if (assembled.return) {
    // Project adapter for "asynchronous iterator return": invoke the implementation iterator.
    steps.return = (iterator: AsyncIteratorValue, value: unknown) => binding.callImplementation(
      iterator.return!, iterator, [value],
    );
  }
  return steps;
}

type AsyncIteratorValue = {
  next: (this: object) => Promise<unknown> | InternalPromise<unknown>;
  return?: (this: object, value: unknown) => Promise<unknown> | InternalPromise<unknown>;
};

// Register adapters for implementation accessors or fields.
// Supplies attribute behavior to Web IDL §3.7.6 Attributes.
function registerAttribute(
  memberBinding: MemberBinding,
  member: IDLAttribute,
  binding: RealmBinding,
  staticTarget?: object,
): void {
  const steps: AttributeSteps = { get: memberBinding.createPropertyGetter(member, staticTarget) };
  if (!member.readonly) {
    const set = memberBinding.createPropertySetter(member);
    const convert = binding.implementationConverter.createConverter(member.type, {
      callbackExceptionBehavior: member.callbackExceptionBehavior,
    });
    // Adapt the converted attribute value before storing it.
    steps.set = (receiver, value) => {
      const operationBinding = receiver?.binding ?? binding;
      binding.callImplementation(
        set, staticTarget ?? receiver!.implInst, [convert(value, operationBinding)],
      );
    };
  }
  memberBinding.attributeSteps = steps;
}

// Register an implementation method adapter.
// Supplies operation behavior to Web IDL §3.7.7 Operations.
function registerOperation(
  memberBinding: MemberBinding,
  assembled: IDLOperation,
  name: string,
  binding: RealmBinding,
  injectedArguments: InjectedArgument[] = [],
  staticTarget?: object,
): void {
  const getMethod = memberBinding.createMethodGetter(name);
  const convert = binding.implementationConverter.createArgumentConverter(assembled);

  if (!convert && !injectedArguments.length) {
    memberBinding.operationSteps = (receiver, values) => {
      const target = staticTarget ?? receiver!.implInst;
      return binding.callImplementation(getMethod(target), target, values);
    };
    return;
  }

  memberBinding.operationSteps = (receiver, values) => {
    const operationBinding = receiver?.binding ?? binding;
    const target = staticTarget ?? receiver!.implInst;
    const args = operationBinding.resolveArguments(
      convert ? convert(values, operationBinding) : values,
      injectedArguments,
      binding,
    );
    return binding.callImplementation(getMethod(target), target, args);
  };
}

// Read the implementation's current entry list without copying its pairs.
// Web IDL §2.5.9 Iterable declarations — value pairs to iterate over.
function registerPairIterable(
  memberBinding: MemberBinding,
  binding: RealmBinding,
): void {
  const getMethod = memberBinding.createMethodGetter<ValuePairsSteps>('getEntryList');
  memberBinding.valuePairsSteps = function() {
    return binding.callImplementation(getMethod(this), this, []);
  };
}

// Register an implementation's toString method as stringification behavior.
// Web IDL §2.5.5 Stringifiers.
function registerStringifier(
  memberBinding: MemberBinding,
  binding: RealmBinding,
): void {
  const getMethod = memberBinding.createMethodGetter<StringificationBehavior>('toString');
  memberBinding.stringificationBehavior = function() {
    return binding.callImplementation(
      getMethod(this),
      this,
      [],
    );
  };
}

/** Construct an implementation using its already-converted arguments and injected dependencies. */
function constructImplementationObject<T extends object>(
  implClass: ImplementationClass<T>,
  argumentsList: unknown[],
): T {
  return Reflect.construct(
    implClass as new (...argumentsList: unknown[]) => T,
    argumentsList,
  );
}
