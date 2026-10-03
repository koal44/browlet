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
import type { BindingContext } from './context';

/** Register implementation factories and member steps before the world publishes this realm. */
export function registerImplementationBindings(binding: RealmBinding): void {
  for (const assembled of binding.assembly.interfaces.values()) {
    registerInterfaceImplementation(
      binding,
      assembled,
      binding.context,
    );
  }
}

// Connect interface declarations to implementation members and factories.
function registerInterfaceImplementation(
  realmBinding: RealmBinding,
  assembled: AssembledInterface,
  context: BindingContext,
): void {
  const definition = assembled.primary.implementation;
  if (!definition) return;

  const implClass = definition.implClass;
  const implementationBinding = realmBinding.getImplementationBinding(assembled);

  for (const { member } of assembled.members) {
    const memberBinding = implementationBinding.getOrCreateMemberBinding(member);
    switch (member.kind) {
      case 'attribute':
        if (member.attributeFunction || member.get || member.set) {
          registerDefinedAttribute(
            memberBinding, member, assembled, context, realmBinding,
          );
        } else {
          registerAttribute(
            memberBinding,
            member,
            member.static ? implClass : implClass.prototype,
            context,
            realmBinding,
          );
        }
        break;
      case 'constructor': {
        if (member.construct) {
          const construct = member.construct;
          const convert = realmBinding.implementationConverter.createArgumentConverter(member);
          memberBinding.constructorBehavior = {
            kind: 'construct',
            steps: (values) => {
              const args = convert(values, context);
              return realmBinding.callImplementation(construct, undefined, [context, ...args]);
            },
          };
        } else if (member.invoke) {
          memberBinding.constructorBehavior = {
            kind: 'initialize',
            steps: createDefinedConstructorSteps(
              member.invoke, member, context, realmBinding,
            ),
          };
        } else {
          memberBinding.constructorBehavior = {
            kind: 'construct',
            steps: createImplementationConstructorSteps(
              implClass,
              member,
              context,
              realmBinding,
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
            member.invoke, member, context, realmBinding,
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
            context,
            realmBinding,
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
                return realmBinding.callImplementation(
                  indexedGetter.supportsIndex,
                  this,
                  [index, context],
                );
              },
            }),
            // Project adapter for Web IDL §2.5.6.1 Indexed properties — supported property indices.
            getSupportedPropertyIndices() {
              return realmBinding.callImplementation(
                indexedGetter.getSupportedPropertyIndices,
                this,
                [context],
              );
            },
          };
        }
        const getSupportedPropertyNames = member.getSupportedPropertyNames;
        if (getSupportedPropertyNames) {
          memberBinding.namedPropertySteps = {
            // Project adapter for Web IDL §2.5.6.2 Named properties — supported property names.
            getSupportedPropertyNames() {
              return realmBinding.callImplementation(
                getSupportedPropertyNames,
                this,
                [context],
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
            realmBinding,
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
          context,
          realmBinding,
        );
        break;
      }
      case 'stringifier':
        registerStringifier(
          memberBinding,
          implClass.prototype,
          realmBinding,
        );
        break;
    }
  }

  implementationBinding.createImplementation = () => realmBinding.callImplementation(
    constructImplementationObject,
    undefined,
    [
      implClass,
      context.resolveArguments(
        [],
        definition.constructWith ?? [],
      ),
    ],
  );
  const initializeImplementation = definition.initializeImplementation;
  if (initializeImplementation) {
    implementationBinding.initializeImplementation = (value) => realmBinding.callImplementation(
      initializeImplementation,
      undefined,
      [context, value],
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
  context: BindingContext,
  realmBinding: RealmBinding,
): void {
  const createSteps = member.attributeFunction;
  const steps: AttributeSteps = {
    // Invoke a declared getter or obtain its realm-owned attribute function.
    get(receiver) {
      const owner = receiver?.binding ?? realmBinding;
      const ownerContext = receiver ? owner.context : context;
      if (createSteps) {
        return owner.getImplementationBinding(assembled).getOrCreateMemberBinding(member).getAttributeFunction(member, () => createSteps.call(undefined, ownerContext));
      }
      if (!member.get) {
        throw new InternalError(
          `Web IDL attribute ${member.name} has no getter binding`,
        );
      }
      return realmBinding.callImplementation(
        member.get,
        receiver?.implInst ?? null,
        [ownerContext],
      );
    },
  };
  const set = member.set;
  if (set && !member.readonly) {
    const convert = realmBinding.implementationConverter.createConverter(member.type, {
      callbackExceptionBehavior: member.callbackExceptionBehavior,
    });
    steps.set = (receiver, value) => {
      const operationContext = receiver?.binding.context ?? context;
      realmBinding.callImplementation(
        set,
        receiver?.implInst ?? null,
        [
          operationContext,
          convert(value, operationContext),
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
  context: BindingContext,
  realmBinding: RealmBinding,
): ConstructorSteps {
  const convert = realmBinding.implementationConverter.createArgumentConverter(assembled);
  return function(...values) {
    realmBinding.callImplementation(
      invoke,
      this,
      [
        context,
        ...convert(values, context),
      ],
    );
  };
}

// Adapt converted constructor arguments and inject implementation dependencies.
function createImplementationConstructorSteps(
  implClass: ImplementationClass,
  assembled: AssembledCallable,
  context: BindingContext,
  realmBinding: RealmBinding,
  injectedArguments: InjectedArgument[] = [],
): ImplementationConstructorSteps {
  const convert = realmBinding.implementationConverter.createArgumentConverter(assembled);
  return (values) => realmBinding.callImplementation(
    constructImplementationObject,
    undefined,
    [
      implClass,
      context.resolveArguments(
        convert(values, context),
        injectedArguments,
      ),
    ],
  );
}

// Adapt converted arguments and the receiver context for a declared invocation.
function createDefinedOperationSteps(
  invoke: NonNullable<IDLOperation['invoke']>,
  assembled: IDLOperation,
  context: BindingContext,
  realmBinding: RealmBinding,
): OperationSteps {
  const convert = realmBinding.implementationConverter.createArgumentConverter(assembled);
  return (receiver, ...values) => {
    const operationContext = receiver?.binding.context ?? context;
    return realmBinding.callImplementation(
      invoke,
      receiver?.implInst ?? null,
      [
        operationContext,
        ...convert(values, operationContext),
      ],
    );
  };
}

// Adapt an implementation iterator to Web IDL's iteration hooks.
// Web IDL §2.5.10 Asynchronously iterable declarations.
function createAsyncIteratorSteps(
  factory: (this: object, ...values: unknown[]) => object,
  assembled: IDLAsyncIterable,
  context: BindingContext,
  realmBinding: RealmBinding,
): AsyncIteratorSteps {
  const convert = realmBinding.implementationConverter.createArgumentConverter(assembled);
  return {
    // Project adapter for "asynchronous iterator initialization steps": call our iterator factory.
    create(target, argumentsList) {
      return realmBinding.callImplementation(
        factory,
        target,
        convert(argumentsList, context),
      );
    },
    // Project adapter for "get the next iteration result": invoke the implementation iterator.
    next(iterator: AsyncIteratorValue) {
      return realmBinding.callImplementation(
        iterator.next,
        iterator,
        [],
      );
    },
    ...(assembled.return
      ? {
        // Project adapter for "asynchronous iterator return": invoke the implementation iterator.
        return(iterator: AsyncIteratorValue, value: unknown) {
          return realmBinding.callImplementation(
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
  context: BindingContext,
  realmBinding: RealmBinding,
): void {
  const descriptor = findDescriptor(target, member.name);
  // eslint-disable-next-line @typescript-eslint/unbound-method -- Accessors are explicitly applied to the implementation receiver.
  const { get: getter, set: setter } = descriptor ?? { get: undefined, set: undefined };
  // Instance fields exist only after construction. Check them on access rather
  // than creating an implementation merely to inspect its shape.
  const get: AttributeSteps['get'] = getter
    ? (receiver) => realmBinding.callImplementation(getter, receiver?.implInst ?? target, []) as unknown
    : (receiver) => {
      const impl = receiver?.implInst ?? target;
      try {
        if (!(member.name in impl)) {
          throw new InternalError(`Web IDL attribute ${member.name} has no implementation`);
        }
        return (impl as Record<string, unknown>)[member.name];
      } catch (exception) {
        throw realmBinding.realizeException(exception);
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
  const convert = set && !member.readonly ? realmBinding.implementationConverter.createConverter(member.type, {
    callbackExceptionBehavior: member.callbackExceptionBehavior,
  }) : undefined;
  memberBinding.attributeSteps = {
    get,
    ...(set && convert
      ? {
        // Adapt the converted attribute value before storing it.
        set(receiver, value) {
          const operationContext = receiver?.binding.context ?? context;
          realmBinding.callImplementation(
            set,
            receiver?.implInst ?? target,
            [
              convert(value, operationContext),
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
  context: BindingContext,
  realmBinding: RealmBinding,
  injectedArguments: InjectedArgument[] = [],
): void {
  const value: unknown = findDescriptor(target, name)?.value;
  if (typeof value !== 'function') {
    throw new InternalError(
      `Web IDL operation ${name} has no implementation`,
    );
  }
  const method = value as (this: object | null, ...values: unknown[]) => unknown;
  const convert = realmBinding.implementationConverter.createArgumentConverter(assembled);

  memberBinding.operationSteps = (receiver, ...values) => {
    const operationContext = receiver?.binding.context ?? context;
    return realmBinding.callImplementation(
      method,
      receiver?.implInst ?? null,
      operationContext.resolveArguments(
        convert(values, operationContext),
        injectedArguments,
        context,
      ),
    );
  };
}

// Read the implementation's current entry list without copying its pairs.
// Web IDL §2.5.9 Iterable declarations — value pairs to iterate over.
function registerPairIterable(
  memberBinding: MemberBinding,
  target: object,
  realmBinding: RealmBinding,
): void {
  const value: unknown = findDescriptor(target, 'getEntryList')?.value;
  if (typeof value !== 'function') {
    throw new InternalError(
      'Web IDL pair iterable implementation has no getEntryList method',
    );
  }
  const getEntryList = value as ValuePairsSteps;
  memberBinding.valuePairsSteps = function() {
    return realmBinding.callImplementation(getEntryList, this, []);
  };
}

// Register an implementation's toString method as stringification behavior.
// Web IDL §2.5.5 Stringifiers.
function registerStringifier(
  memberBinding: MemberBinding,
  target: object,
  realmBinding: RealmBinding,
): void {
  const value: unknown = findDescriptor(target, 'toString')?.value;
  if (typeof value !== 'function') {
    throw new InternalError('Web IDL stringifier has no implementation');
  }
  const stringify = value as StringificationBehavior;
  memberBinding.stringificationBehavior = function() {
    return realmBinding.callImplementation(
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
