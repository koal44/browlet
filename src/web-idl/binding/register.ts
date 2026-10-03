import type { InternalPromise } from '../../infra/promises';
import type { AssembledCallable, AssembledInterface } from '../assembled';
import type { RealmBinding } from './realm';
import type { BindingContext } from './context';
import { hasExtendedAttribute } from '../core/helpers';
import type {
  AttributeMember, OperationMember, ImplementationClass, InjectedArgument,
} from '../core/types';
import type { AsyncIterableMember, ConstructorMember } from '../core/declarations';
import type { AsyncIteratorSteps } from './async-iterable';
import type {
  AttributeSteps, ConstructorSteps, ImplementationConstructorSteps,
  MemberBinding, OperationSteps, StringificationBehavior,
} from './member';
import type { ValuePairsSteps } from './iterable';
import { InternalError } from '../../infra/internal-error';

import { constructImplementationObject, resolveImplementationArguments, callImplementation } from '../constructs/implementation';

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
        const callable = assembled.callables.get(member);
        if (member.construct) {
          const construct = member.construct;
          const convert = realmBinding.implementationConverter.createArgumentConverter(callable);
          memberBinding.constructorBehavior = {
            kind: 'construct',
            steps: (values) => {
              const args = convert(values, context);
              return callImplementation(construct, undefined, [context, ...args], realmBinding);
            },
          };
        } else if (member.invoke) {
          memberBinding.constructorBehavior = {
            kind: 'initialize',
            steps: createDefinedConstructorSteps(
              member.invoke, callable, context, realmBinding,
            ),
          };
        } else {
          memberBinding.constructorBehavior = {
            kind: 'construct',
            steps: createImplementationConstructorSteps(
              implClass,
              callable,
              context,
              realmBinding,
              member.constructWith ?? definition.constructWith,
            ),
          };
        }
        break;
      }
      case 'operation': {
        const callable = assembled.callables.get(member);
        if (hasExtendedAttribute(member.extendedAttributes, 'Default')) break;
        if (member.invoke) {
          memberBinding.operationSteps = createDefinedOperationSteps(
            member.invoke, callable, context, realmBinding,
          );
        } else {
          if (member.name === undefined) {
            throw missingMemberBinding(assembled, member);
          }
          registerOperation(
            memberBinding,
            callable,
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
                return callImplementation(
                  indexedGetter.supportsIndex,
                  this,
                  [index, context],
                  realmBinding,
                );
              },
            }),
            // Project adapter for Web IDL §2.5.6.1 Indexed properties — supported property indices.
            getSupportedPropertyIndices() {
              return callImplementation(
                indexedGetter.getSupportedPropertyIndices,
                this,
                [context],
                realmBinding,
              );
            },
          };
        }
        const getSupportedPropertyNames = member.getSupportedPropertyNames;
        if (getSupportedPropertyNames) {
          memberBinding.namedPropertySteps = {
            // Project adapter for Web IDL §2.5.6.2 Named properties — supported property names.
            getSupportedPropertyNames() {
              return callImplementation(
                getSupportedPropertyNames,
                this,
                [context],
                realmBinding,
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
          assembled.callables.get(member),
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

  implementationBinding.createImplementation = () => callImplementation(
    constructImplementationObject,
    undefined,
    [
      implClass,
      resolveImplementationArguments(
        [],
        definition.constructWith ?? [],
        context,
      ),
    ],
    realmBinding,
  );
  const initializeImplementation = definition.initializeImplementation;
  if (initializeImplementation) {
    implementationBinding.initializeImplementation = (value) => callImplementation(
      initializeImplementation,
      undefined,
      [context, value],
      realmBinding,
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
  member: AttributeMember,
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
      return callImplementation(
        member.get,
        receiver?.implInst ?? null,
        [ownerContext],
        realmBinding,
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
      callImplementation(
        set,
        receiver?.implInst ?? null,
        [
          operationContext,
          convert(value, operationContext),
        ],
        realmBinding,
      );
    };
  }
  memberBinding.attributeSteps = steps;
}

// Adapt converted constructor arguments for a declared initializer.
function createDefinedConstructorSteps(
  invoke: NonNullable<ConstructorMember['invoke']>,
  assembled: AssembledCallable,
  context: BindingContext,
  realmBinding: RealmBinding,
): ConstructorSteps {
  const convert = realmBinding.implementationConverter.createArgumentConverter(assembled);
  return function(...values) {
    callImplementation(
      invoke,
      this,
      [
        context,
        ...convert(values, context),
      ],
      realmBinding,
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
  return (values) => callImplementation(
    constructImplementationObject,
    undefined,
    [
      implClass,
      resolveImplementationArguments(
        convert(values, context),
        injectedArguments,
        context,
      ),
    ],
    realmBinding,
  );
}

// Adapt converted arguments and the receiver context for a declared invocation.
function createDefinedOperationSteps(
  invoke: NonNullable<OperationMember['invoke']>,
  assembled: AssembledCallable<OperationMember>,
  context: BindingContext,
  realmBinding: RealmBinding,
): OperationSteps {
  const convert = realmBinding.implementationConverter.createArgumentConverter(assembled);
  return (receiver, ...values) => {
    const operationContext = receiver?.binding.context ?? context;
    return callImplementation(
      invoke,
      receiver?.implInst ?? null,
      [
        operationContext,
        ...convert(values, operationContext),
      ],
      realmBinding,
    );
  };
}

// Adapt an implementation iterator to Web IDL's iteration hooks.
// Web IDL §2.5.10 Asynchronously iterable declarations.
function createAsyncIteratorSteps(
  factory: (this: object, ...values: unknown[]) => object,
  assembled: AssembledCallable<AsyncIterableMember>,
  context: BindingContext,
  realmBinding: RealmBinding,
): AsyncIteratorSteps {
  const convert = realmBinding.implementationConverter.createArgumentConverter(assembled);
  return {
    // Project adapter for "asynchronous iterator initialization steps": call our iterator factory.
    create(target, argumentsList) {
      return callImplementation(
        factory,
        target,
        convert(argumentsList, context),
        realmBinding,
      );
    },
    // Project adapter for "get the next iteration result": invoke the implementation iterator.
    next(iterator: AsyncIteratorValue) {
      return callImplementation(
        iterator.next,
        iterator,
        [],
        realmBinding,
      );
    },
    ...(assembled.primary.return
      ? {
        // Project adapter for "asynchronous iterator return": invoke the implementation iterator.
        return(iterator: AsyncIteratorValue, value: unknown) {
          return callImplementation(
            iterator.return!,
            iterator,
            [value],
            realmBinding,
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
  member: AttributeMember,
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
    ? (receiver) => callImplementation(getter, receiver?.implInst ?? target, [], realmBinding) as unknown
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
          callImplementation(
            set,
            receiver?.implInst ?? target,
            [
              convert(value, operationContext),
            ],
            realmBinding,
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
  assembled: AssembledCallable<OperationMember>,
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
    return callImplementation(
      method,
      receiver?.implInst ?? null,
      resolveImplementationArguments(
        convert(values, operationContext),
        injectedArguments,
        operationContext,
        context,
      ),
      realmBinding,
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
    return callImplementation(getEntryList, this, [], realmBinding);
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
    return callImplementation(
      stringify,
      this,
      [],
      realmBinding,
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
