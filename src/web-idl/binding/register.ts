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
  const definition = assembled.primary.implementation;
  if (!definition) return;

  const implClass = definition.implClass;
  const implementationBinding = binding.getImplementationBinding(assembled);

  for (const { member } of assembled.members) {
    const memberBinding = implementationBinding.getOrCreateMemberBinding(member);
    switch (member.kind) {
      case 'attribute':
        if (member.attributeFunction || member.get || member.set) {
          registerDefinedAttribute(
            memberBinding, member, assembled, binding,
          );
        } else {
          registerAttribute(
            memberBinding,
            member,
            member.static ? implClass : implClass.prototype,
            binding,
          );
        }
        break;
      case 'constructor': {
        if (member.construct) {
          const construct = member.construct;
          const convert = binding.implementationConverter.createArgumentConverter(member);
          memberBinding.constructorBehavior = {
            kind: 'construct',
            steps: (values) => {
              const args = convert(values, binding);
              return binding.callImplementation(construct, undefined, [binding, ...args]);
            },
          };
        } else if (member.invoke) {
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
              implClass,
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
          if (member.name === undefined) {
            throw missingMemberBinding(assembled, member);
          }
          registerOperation(
            memberBinding,
            member,
            member.name,
            member.static ? implClass : implClass.prototype,
            binding,
            member.invokeWith,
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
                  [index, binding],
                );
              },
            }),
            // Project adapter for Web IDL §2.5.6.1 Indexed properties — supported property indices.
            getSupportedPropertyIndices() {
              return binding.callImplementation(
                indexedGetter.getSupportedPropertyIndices,
                this,
                [binding],
              );
            },
          };
        }
        const getSupportedPropertyNames = member.getSupportedPropertyNames;
        if (getSupportedPropertyNames) {
          memberBinding.namedPropertySteps = {
            // Project adapter for Web IDL §2.5.6.2 Named properties — supported property names.
            getSupportedPropertyNames() {
              return binding.callImplementation(
                getSupportedPropertyNames,
                this,
                [binding],
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
            implClass.prototype,
            binding,
          );
        }
        break;
      case 'async-iterable': {
        const factory: unknown = member.create !== undefined
          ? findDescriptor(implClass.prototype, member.create)?.value
          : undefined;
        if (typeof factory !== 'function') {
          throw missingMemberBinding(assembled, member);
        }
        memberBinding.asyncIteratorSteps = createAsyncIteratorSteps(
          factory as (this: object, ...values: unknown[]) => object,
          member,
          binding,
        );
        break;
      }
      case 'stringifier':
        registerStringifier(
          memberBinding,
          implClass.prototype,
          binding,
        );
        break;
    }
  }

  implementationBinding.createImplementation = () => binding.callImplementation(
    constructImplementationObject,
    undefined,
    [
      implClass,
      binding.resolveArguments(
        [],
        definition.constructWith ?? [],
      ),
    ],
  );
  const initializeImplementation = definition.initializeImplementation;
  if (initializeImplementation) {
    implementationBinding.initializeImplementation = (value) => binding.callImplementation(
      initializeImplementation,
      undefined,
      [binding, value],
    );
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
): void {
  const createSteps = member.attributeFunction;
  const steps: AttributeSteps = {
    // Invoke a declared getter or obtain its realm-owned attribute function.
    get(receiver) {
      const owner = receiver?.binding ?? binding;
      if (createSteps) {
        return owner.getImplementationBinding(assembled).getOrCreateMemberBinding(member).getAttributeFunction(member, () => createSteps.call(undefined, owner));
      }
      if (!member.get) {
        throw new InternalError(
          `Web IDL attribute ${member.name} has no getter binding`,
        );
      }
      return binding.callImplementation(
        member.get,
        receiver?.implInst ?? null,
        [owner],
      );
    },
  };
  const set = member.set;
  if (set && !member.readonly) {
    const convert = binding.implementationConverter.createConverter(member.type, {
      callbackExceptionBehavior: member.callbackExceptionBehavior,
    });
    steps.set = (receiver, value) => {
      const operationBinding = receiver?.binding ?? binding;
      binding.callImplementation(
        set,
        receiver?.implInst ?? null,
        [
          operationBinding,
          convert(value, operationBinding),
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
  return function(...values) {
    binding.callImplementation(
      invoke,
      this,
      [
        binding,
        ...convert(values, binding),
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
        convert(values, binding),
        injectedArguments,
      ),
    ],
  );
}

// Adapt converted arguments and the receiver binding for a declared invocation.
function createDefinedOperationSteps(
  invoke: NonNullable<IDLOperation['invoke']>,
  assembled: IDLOperation,
  binding: RealmBinding,
): OperationSteps {
  const convert = binding.implementationConverter.createArgumentConverter(assembled);
  return (receiver, ...values) => {
    const operationBinding = receiver?.binding ?? binding;
    return binding.callImplementation(
      invoke,
      receiver?.implInst ?? null,
      [
        operationBinding,
        ...convert(values, operationBinding),
      ],
    );
  };
}

// Adapt an implementation iterator to Web IDL's iteration hooks.
// Web IDL §2.5.10 Asynchronously iterable declarations.
function createAsyncIteratorSteps(
  factory: (this: object, ...values: unknown[]) => object,
  assembled: IDLAsyncIterable,
  binding: RealmBinding,
): AsyncIteratorSteps {
  const convert = binding.implementationConverter.createArgumentConverter(assembled);
  return {
    // Project adapter for "asynchronous iterator initialization steps": call our iterator factory.
    create(target, argumentsList) {
      return binding.callImplementation(
        factory,
        target,
        convert(argumentsList, binding),
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
    ...(assembled.return
      ? {
        // Project adapter for "asynchronous iterator return": invoke the implementation iterator.
        return(iterator: AsyncIteratorValue, value: unknown) {
          return binding.callImplementation(
            iterator.return!,
            iterator,
            [value],
          );
        },
      }
      : {}),
  };
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
  target: object,
  binding: RealmBinding,
): void {
  const descriptor = findDescriptor(target, member.name);
  // eslint-disable-next-line @typescript-eslint/unbound-method -- Accessors are explicitly applied to the implementation receiver.
  const { get: getter, set: setter } = descriptor ?? { get: undefined, set: undefined };
  // Instance fields exist only after construction. Check them on access rather
  // than creating an implementation merely to inspect its shape.
  const get: AttributeSteps['get'] = getter
    ? (receiver) => binding.callImplementation(getter, receiver?.implInst ?? target, []) as unknown
    : (receiver) => {
      const impl = receiver?.implInst ?? target;
      try {
        if (!(member.name in impl)) {
          throw new InternalError(`Web IDL attribute ${member.name} has no implementation`);
        }
        return (impl as Record<string, unknown>)[member.name];
      } catch (exception) {
        throw binding.realizeException(exception);
      }
    };
  const set = getter !== undefined
    ? setter
    : function(this: object, value: unknown): void {
      if (!(member.name in this)) {
        throw new InternalError(`Web IDL attribute ${member.name} has no implementation`);
      }
      if (!Reflect.set(this, member.name, value)) {
        throw new InternalError(`Web IDL attribute ${member.name} is not writable`);
      }
    };
  const convert = set && !member.readonly ? binding.implementationConverter.createConverter(member.type, {
    callbackExceptionBehavior: member.callbackExceptionBehavior,
  }) : undefined;
  memberBinding.attributeSteps = {
    get,
    ...(set && convert
      ? {
        // Adapt the converted attribute value before storing it.
        set(receiver, value) {
          const operationBinding = receiver?.binding ?? binding;
          binding.callImplementation(
            set,
            receiver?.implInst ?? target,
            [
              convert(value, operationBinding),
            ],
          );
        },
      }
      : {}),
  };
}

// Register an implementation method adapter.
// Supplies operation behavior to Web IDL §3.7.7 Operations.
function registerOperation(
  memberBinding: MemberBinding,
  assembled: IDLOperation,
  name: string,
  target: object,
  binding: RealmBinding,
  injectedArguments: InjectedArgument[] = [],
): void {
  const value: unknown = findDescriptor(target, name)?.value;
  if (typeof value !== 'function') {
    throw new InternalError(
      `Web IDL operation ${name} has no implementation`,
    );
  }
  const method = value as (this: object | null, ...values: unknown[]) => unknown;
  const convert = binding.implementationConverter.createArgumentConverter(assembled);

  memberBinding.operationSteps = (receiver, ...values) => {
    const operationBinding = receiver?.binding ?? binding;
    return binding.callImplementation(
      method,
      receiver?.implInst ?? null,
      operationBinding.resolveArguments(
        convert(values, operationBinding),
        injectedArguments,
        binding,
      ),
    );
  };
}

// Read the implementation's current entry list without copying its pairs.
// Web IDL §2.5.9 Iterable declarations — value pairs to iterate over.
function registerPairIterable(
  memberBinding: MemberBinding,
  target: object,
  binding: RealmBinding,
): void {
  const value: unknown = findDescriptor(target, 'getEntryList')?.value;
  if (typeof value !== 'function') {
    throw new InternalError(
      'Web IDL pair iterable implementation has no getEntryList method',
    );
  }
  const getEntryList = value as ValuePairsSteps;
  memberBinding.valuePairsSteps = function() {
    return binding.callImplementation(getEntryList, this, []);
  };
}

// Register an implementation's toString method as stringification behavior.
// Web IDL §2.5.5 Stringifiers.
function registerStringifier(
  memberBinding: MemberBinding,
  target: object,
  binding: RealmBinding,
): void {
  const value: unknown = findDescriptor(target, 'toString')?.value;
  if (typeof value !== 'function') {
    throw new InternalError('Web IDL stringifier has no implementation');
  }
  const stringify = value as StringificationBehavior;
  memberBinding.stringificationBehavior = function() {
    return binding.callImplementation(
      stringify,
      this,
      [],
    );
  };
}

// Locate a member descriptor in the implementation prototype chain.
function findDescriptor(
  target: object,
  property: PropertyKey,
): PropertyDescriptor | undefined {
  for (
    let current: object | null = target;
    current && current !== Object.prototype;
    current = Reflect.getPrototypeOf(current)
  ) {
    const descriptor = Reflect.getOwnPropertyDescriptor(current, property);
    if (descriptor) return descriptor;
  }
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
