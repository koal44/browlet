import type { InternalPromise } from '../infra/promises';
import { AssembledDictionary, type AssembledInterface } from './assembled';
import type { RealmBinding } from './realm-binding';
import type { BindingContext } from './binding-context';
import {
  callUserObjectOperation, constructCallbackFunction, invokeCallbackFunction,
} from './callback';
import {
  isCallbackFunctionValue, isCallbackInterfaceRecord,
  type CallbackFunctionValue, type CallbackInterfaceValue,
} from './callback-value';
import { hasExtendedAttribute, reference } from './core/helpers';
import type { ArgumentDefinition, AttributeMember, OperationMember, WebIDLType, CallbackExceptionBehavior, ImplementationClass, InjectedArgument } from './core/types';
import type { AsyncIterableMember, ConstructorMember } from './core/declarations';
import type {
  AsyncIteratorSteps, AttributeSteps, ConstructorSteps,
  ImplementationConstructorSteps, MemberBinding, OperationSteps,
  StringificationBehavior, ValuePairsSteps,
} from './definition-binding';
import { getArgumentDefinition, missingArgument } from './overload';
import { convertToIDL } from './conversion';
import { toImplementationPromise } from './promise';
import { defineDataProperty } from './property';
import { isIDLPromiseRecord } from './promise-record';
import {
  closeAsyncIterator, endOfIteration, getAsyncIteratorNextValue,
  isIDLAsyncSequence, openAsyncSequence,
} from './async-sequence';
import { InternalError } from '../infra/internal-error';

// Project helper: register declaration adapters for one realm.
export function registerDefinitionBindings(binding: RealmBinding): void {
  for (const assembled of binding.assembly.interfaces.values()) {
    registerDefinedInterface(
      binding,
      assembled,
      binding.context,
    );
  }
  binding.world.registerRealm(binding);
}

// Project helper: connect interface declarations to implementation members and factories.
function registerDefinedInterface(
  realmBinding: RealmBinding,
  assembled: AssembledInterface,
  context: BindingContext,
): void {
  const definition = assembled.primary.implementation;
  if (!definition) return;

  const implClass = definition.implClass;
  const definitionBinding = realmBinding.getDefinitionBinding(assembled);

  for (const { member } of assembled.members) {
    const memberBinding = definitionBinding.getOrCreateMemberRecord(member);
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
      case 'constructor':
        if (member.construct) {
          const construct = member.construct;
          memberBinding.constructorBehavior = {
            kind: 'construct',
            steps: (values) => {
              const args = adaptArguments(values, member.arguments, context, realmBinding);
              return callImplementation(construct, undefined, [context, ...args], realmBinding);
            },
          };
        } else if (member.invoke) {
          memberBinding.constructorBehavior = {
            kind: 'initialize',
            steps: createDefinedConstructorSteps(
              member.invoke, member.arguments, context, realmBinding,
            ),
          };
        } else {
          memberBinding.constructorBehavior = {
            kind: 'construct',
            steps: createImplementationConstructorSteps(
              implClass,
              member.arguments,
              context,
              realmBinding,
              member.constructWith ?? definition.constructWith,
            ),
          };
        }
        break;
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

  definitionBinding.createImplementation = () => callImplementation(
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
    definitionBinding.initializeImplementation = (value) => callImplementation(
      initializeImplementation,
      undefined,
      [context, value],
      realmBinding,
    );
  }
  const allocatePlatformObject = definition.allocatePlatformObject;
  if (allocatePlatformObject) {
    definitionBinding.allocatePlatformObject = (prototype) => callImplementation(
      allocatePlatformObject,
      undefined,
      [context, prototype],
      realmBinding,
    );
  }
}

// Project helper: report an incomplete implementation registration.
function missingMemberBinding(
  assembled: AssembledInterface,
  member: { kind: string; name?: string; },
): InternalError {
  return new InternalError(
    `Web IDL ${assembled.primary.name}.${member.name ?? member.kind} has no binding`,
  );
}

// Project helper: register explicit getter, setter, or attribute-function adapters.
// Supplies attribute behavior to Web IDL §3.7.6 Attributes.
function registerDefinedAttribute(
  memberBinding: MemberBinding,
  member: AttributeMember,
  assembled: AssembledInterface,
  context: BindingContext,
  realmBinding: RealmBinding,
): void {
  const createCallback = member.attributeFunction;
  const steps: AttributeSteps = {
    // Project helper: invoke a declared getter or obtain its realm-owned attribute function.
    get(receiver) {
      const owner = receiver?.binding ?? realmBinding;
      const ownerContext = receiver ? owner.context : context;
      if (createCallback) {
        return owner.getAttributeFunction(
          assembled, member,
          () => createCallback.call(undefined, ownerContext),
        );
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
    steps.set = (receiver, value) => {
      const operationContext = receiver?.binding.context ?? context;
      callImplementation(
        set,
        receiver?.implInst ?? null,
        [
          operationContext,
          adaptIDLToImpl(
            value,
            member.type,
            { callbackExceptionBehavior: member.callbackExceptionBehavior },
            operationContext,
            realmBinding,
          ),
        ],
        realmBinding,
      );
    };
  }
  memberBinding.attributeSteps = steps;
}

// Project helper: adapt converted constructor arguments for a declared initializer.
function createDefinedConstructorSteps(
  invoke: NonNullable<ConstructorMember['invoke']>,
  args: ArgumentDefinition[],
  context: BindingContext,
  realmBinding: RealmBinding,
): ConstructorSteps {
  return function(...values) {
    callImplementation(
      invoke,
      this,
      [
        context,
        ...adaptArguments(values, args, context, realmBinding),
      ],
      realmBinding,
    );
  };
}

// Project helper: adapt converted constructor arguments and inject implementation dependencies.
function createImplementationConstructorSteps(
  implClass: ImplementationClass,
  args: ArgumentDefinition[],
  context: BindingContext,
  realmBinding: RealmBinding,
  injectedArguments: InjectedArgument[] = [],
): ImplementationConstructorSteps {
  return (values) => callImplementation(
    constructImplementationObject,
    undefined,
    [
      implClass,
      resolveImplementationArguments(
        adaptArguments(values, args, context, realmBinding),
        injectedArguments,
        context,
      ),
    ],
    realmBinding,
  );
}

// Project helper: construct the implementation class through Reflect.construct.
export function constructImplementationObject<T extends object>(
  implClass: ImplementationClass<T>,
  argumentsList: unknown[],
): T {
  return Reflect.construct(
    implClass as new (...argumentsList: unknown[]) => T,
    argumentsList,
  );
}

// Project helper: adapt converted arguments and the receiver context for a declared invocation.
function createDefinedOperationSteps(
  invoke: NonNullable<OperationMember['invoke']>,
  member: OperationMember,
  context: BindingContext,
  realmBinding: RealmBinding,
): OperationSteps {
  return (receiver, ...values) => {
    const operationContext = receiver?.binding.context ?? context;
    return callImplementation(
      invoke,
      receiver?.implInst ?? null,
      [
        operationContext,
        ...adaptArguments(values, member.arguments, operationContext, realmBinding),
      ],
      realmBinding,
    );
  };
}

// Project helper: adapt an implementation iterator to Web IDL's iteration hooks.
// Web IDL §2.5.10 Asynchronously iterable declarations.
function createAsyncIteratorSteps(
  factory: (this: object, ...values: unknown[]) => object,
  member: AsyncIterableMember,
  context: BindingContext,
  realmBinding: RealmBinding,
): AsyncIteratorSteps {
  return {
    // Project adapter for "asynchronous iterator initialization steps": call our iterator factory.
    create(target, argumentsList) {
      return callImplementation(
        factory,
        target,
        adaptArguments(argumentsList, member.arguments ?? [], context, realmBinding),
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
    ...(member.return
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

// Project helper: register adapters for implementation accessors or fields.
// Supplies attribute behavior to Web IDL §3.7.6 Attributes.
function registerAttribute(
  memberBinding: MemberBinding,
  member: AttributeMember,
  target: object,
  context: BindingContext,
  realmBinding: RealmBinding,
): void {
  const descriptor = findDescriptor(target, member.name);
  const getterValue: unknown = descriptor && Reflect.get(descriptor, 'get');
  const setterValue: unknown = descriptor && Reflect.get(descriptor, 'set');
  // Instance fields exist only after construction. Check them on access rather
  // than creating an implementation merely to inspect its shape.
  const get = getterValue as ((this: object) => unknown) | undefined ?? function(this: object): unknown {
    if (!Reflect.has(this, member.name)) {
      throw new InternalError(`Web IDL attribute ${member.name} has no implementation`);
    }
    return Reflect.get(this, member.name);
  };
  const set = getterValue !== undefined
    ? setterValue as ((this: object, value: unknown) => void) | undefined
    : function(this: object, value: unknown): void {
      if (!Reflect.has(this, member.name)) {
        throw new InternalError(`Web IDL attribute ${member.name} has no implementation`);
      }
      if (!Reflect.set(this, member.name, value)) {
        throw new InternalError(`Web IDL attribute ${member.name} is not writable`);
      }
    };
  memberBinding.attributeSteps = {
    // Project helper: read the implementation through our exception boundary.
    get(receiver) {
      return callImplementation(get, receiver?.implInst ?? target, [], realmBinding);
    },
    ...(set && !member.readonly
      ? {
        // Project helper: adapt the converted attribute value before storing it.
        set(receiver, value) {
          const operationContext = receiver?.binding.context ?? context;
          callImplementation(
            set,
            receiver?.implInst ?? target,
            [
              adaptIDLToImpl(
                value,
                member.type,
                {
                  callbackExceptionBehavior:
                    member.callbackExceptionBehavior,
                },
                operationContext,
                realmBinding,
              ),
            ],
            realmBinding,
          );
        },
      }
      : {}),
  };
}

// Project helper: register an implementation method adapter.
// Supplies operation behavior to Web IDL §3.7.7 Operations.
function registerOperation(
  memberBinding: MemberBinding,
  member: OperationMember,
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

  memberBinding.operationSteps = (receiver, ...values) => {
    const operationContext = receiver?.binding.context ?? context;
    return callImplementation(
      method,
      receiver?.implInst ?? null,
      resolveImplementationArguments(
        adaptArguments(values, member.arguments, operationContext, realmBinding),
        injectedArguments,
        operationContext,
        context,
      ),
      realmBinding,
    );
  };
}

// Project helper: merge converted arguments with explicitly positioned implementation dependencies.
export function resolveImplementationArguments(
  argumentsList: unknown[],
  injectedArguments: InjectedArgument[],
  context: BindingContext,
  methodContext = context,
): unknown[] {
  if (injectedArguments.length === 0) return argumentsList;

  const result: unknown[] = [];
  for (const { index, resolve } of injectedArguments) {
    if (Object.hasOwn(result, index)) {
      throw new InternalError(`Injected argument ${index} is declared more than once`);
    }
    result[index] = resolve(context, methodContext);
  }

  let index = 0;
  for (const value of argumentsList) {
    while (Object.hasOwn(result, index)) index++;
    result[index++] = value;
  }
  return result;
}

// Project helper: read the implementation's current entry list without copying its pairs.
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

// Project helper: register an implementation's toString method as stringification behavior.
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

// Project helper: invoke implementation code and realize exceptions at the binding boundary.
function callImplementation<This, Values extends unknown[], Result>(
  implementation: (this: This, ...values: Values) => Result,
  thisArgument: This,
  values: Values,
  binding: RealmBinding,
): Result {
  try {
    return Reflect.apply(implementation, thisArgument, values);
  } catch (exception) {
    throw binding.realizeException(exception);
  }
}

// Project helper: locate a member descriptor in the implementation prototype chain.
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

// Project helper: adapt each converted argument using its fixed or variadic declaration.
function adaptArguments(
  values: unknown[],
  definitions: ArgumentDefinition[],
  context: BindingContext,
  realmBinding: RealmBinding,
): unknown[] {
  return values.map((value, index) => {
    const argument = getArgumentDefinition(definitions, index);
    return adaptIDLToImpl(value, argument?.type, argument ?? {}, context, realmBinding);
  });
}

// Project helper: adapt converted IDL values to our implementation representations.
// Web IDL §3.2 JavaScript type mapping is delegated to conversion.ts where conversion is needed.
export function adaptIDLToImpl(
  value: unknown,
  type: WebIDLType | undefined,
  options: ImplementationAdaptationOptions,
  context: BindingContext,
  realmBinding: RealmBinding,
): unknown {
  if (options.callbackDictionary !== undefined) {
    const input = value === missingArgument ? undefined : value;
    const dictionaryType = reference(options.callbackDictionary);
    return adaptIDLToImpl(
      convertToIDL(input, dictionaryType, realmBinding.defaultConversionContext), dictionaryType,
      { callbackThis: input }, context, realmBinding,
    );
  }
  if (value === missingArgument) return undefined;
  if (isIDLAsyncSequence(value)) {
    // Delegates Web IDL §3.2.22.1 Iterating async sequences to async-sequence.ts.
    const iterator = openAsyncSequence(value, realmBinding.realm);
    return {
      next: () => toImplementationPromise(
        getAsyncIteratorNextValue(iterator, realmBinding.realm,
          (item, itemType) => convertToIDL(item, itemType, realmBinding.defaultConversionContext)),
        realmBinding.defaultConversionContext,
        (item) => item === endOfIteration ? item :
          adaptIDLToImpl(item, value.elementType, {}, context, realmBinding),
        context.Promise,
      ),
      return: (reason: unknown) => toImplementationPromise(
        closeAsyncIterator(iterator, reason, realmBinding.realm), realmBinding.defaultConversionContext, (result) => result,
        context.Promise,
      ),
    };
  }
  if (isIDLPromiseRecord(value)) {
    return toImplementationPromise(value, realmBinding.defaultConversionContext, (result) =>
      adaptIDLToImpl(
        result, value.type, options, context, realmBinding,
      ), context.Promise);
  }
  for (const implClass of options.implClasses ?? []) {
    const resolved = context.unwrap(value, implClass);
    if (resolved) return resolved;
  }
  if (isCallbackFunctionValue(value)) {
    return adaptCallbackFunction(
      value,
      options.callbackExceptionBehavior,
      context,
      realmBinding,
      options.callbackThis,
    );
  }
  if (isCallbackInterfaceRecord(value)) {
    const adapt = value.assembled.primary.adapt;
    if (!adapt) return value;

    const callback: CallbackInterfaceValue = {
      // Delegates Web IDL §3.11 Callback interfaces — call a user object's operation.
      callUserObjectOperation: (
        operationName,
        argumentsList,
        thisArgument,
      ) => callUserObjectOperation(
        value,
        operationName,
        argumentsList,
        thisArgument,
      ),
      object: value.object,
      realm: value.realm,
    };
    return callImplementation(
      adapt,
      undefined,
      [context, callback],
      realmBinding,
    );
  }
  if (Array.isArray(value)) {
    const elementType = type && realmBinding.assembly.findSequenceElementType(type);
    if (!elementType) return value;
    return value.map((item) =>
      adaptIDLToImpl(
        item,
        elementType,
        { callbackExceptionBehavior: options.callbackExceptionBehavior },
        context,
        realmBinding,
      ));
  }
  if (!(value instanceof Map)) return value;

  const dictionaryOrRecord = type && realmBinding.assembly.findDictionaryOrRecord(type);
  if (!dictionaryOrRecord) return value;
  const assembled = dictionaryOrRecord instanceof AssembledDictionary ? dictionaryOrRecord : undefined;
  const recordValueType = 'value' in dictionaryOrRecord ? dictionaryOrRecord.value : undefined;

  const object: Record<PropertyKey, unknown> = {};
  const entries = value as Map<string, unknown>;
  for (const [name, memberValue] of entries) {
    const member = assembled?.membersByName.get(name);
    defineDataProperty(object, name, adaptIDLToImpl(
      memberValue,
      member?.type ?? recordValueType,
      {
        callbackExceptionBehavior:
          member?.callbackExceptionBehavior ??
          options.callbackExceptionBehavior,
        callbackThis: isCallbackFunctionValue(memberValue) ? options.callbackThis : undefined,
      },
      context,
      realmBinding,
    ));
  }
  return object;
}

type ImplementationAdaptationOptions = {
  callbackDictionary?: string;
  callbackExceptionBehavior?: CallbackExceptionBehavior;
  callbackThis?: unknown;
  implClasses?: ImplementationClass[];
};

// Project helper: expose a retained IDL callback to implementations as an ordinary callable.
function adaptCallbackFunction(
  value: CallbackFunctionValue,
  exceptionBehavior: CallbackExceptionBehavior | undefined,
  context: BindingContext,
  realmBinding: RealmBinding,
  callbackThis?: unknown,
): CallableFunction {
  const existing = value.adapter;
  if (existing) return existing;

  /*
   * Present Web IDL callback machinery to implementations as an ordinary
   * callable. Copying the callback record onto the wrapper preserves its
   * Web IDL identity, so returning the callable projects the original
   * JavaScript function rather than exposing this wrapper.
   * A callback dictionary fixes the receiver to its original input object.
   */
  const adapter = new Proxy(function callback() {}, {
    // Project adapter: delegate Web IDL §3.12 Invoking callback functions — invoke, then adapt the result.
    apply(_target, thisArgument, argumentsList) {
      const result = invokeCallbackFunction(
        value,
        argumentsList,
        exceptionBehavior,
        callbackThis ?? thisArgument,
      );
      return adaptIDLToImpl(
        result, value.assembled.primary.returns, {}, context, realmBinding,
      );
    },
    // Project adapter: delegate Web IDL §3.12 Invoking callback functions — construct.
    construct(_target, argumentsList) {
      return constructCallbackFunction(value, argumentsList) as object;
    },
  });
  Object.defineProperties(adapter, Object.getOwnPropertyDescriptors(value));
  value.adapter = adapter;
  return adapter;
}
