import type { InternalPromise } from '../infra/promises';
import type { AssembledCallable, AssembledInterface } from './assembled';
import type { RealmBinding } from './realm-binding';
import type { BindingContext } from './binding-context';
import {
  callUserObjectOperation, type CallbackConverter,
} from './callback';
import {
  isCallbackFunctionValue, isCallbackInterfaceRecord, stampCallbackFunction,
  type CallbackFunctionAdapter, type CallbackFunctionValue, type CallbackInterfaceValue,
} from './callback-value';
import { hasExtendedAttribute } from './core/helpers';
import type {
  AttributeMember, OperationMember, WebIDLType, CallbackExceptionBehavior,
  ImplementationClass, InjectedArgument, ReferenceType,
} from './core/types';
import type { AsyncIterableMember, ConstructorMember } from './core/declarations';
import type {
  AsyncIteratorSteps, AttributeSteps, ConstructorSteps,
  ImplementationConstructorSteps, MemberBinding, OperationSteps,
  StringificationBehavior, ValuePairsSteps,
} from './definition-binding';
import { missingArgument } from './overload';
import { convertToIDL, IDLDictionaryValue } from './conversion';
import { toImplementationPromise } from './promise';
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
      case 'constructor': {
        const callable = assembled.callables.get(member);
        if (member.construct) {
          const construct = member.construct;
          const adapt = createArgumentAdapter(callable, realmBinding);
          memberBinding.constructorBehavior = {
            kind: 'construct',
            steps: (values) => {
              const args = adapt(values, context);
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
    const adapt = createImplementationAdapter(member.type, {
      callbackExceptionBehavior: member.callbackExceptionBehavior,
    }, realmBinding);
    steps.set = (receiver, value) => {
      const operationContext = receiver?.binding.context ?? context;
      callImplementation(
        set,
        receiver?.implInst ?? null,
        [
          operationContext,
          adapt(value, operationContext),
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
  assembled: AssembledCallable,
  context: BindingContext,
  realmBinding: RealmBinding,
): ConstructorSteps {
  const adapt = createArgumentAdapter(assembled, realmBinding);
  return function(...values) {
    callImplementation(
      invoke,
      this,
      [
        context,
        ...adapt(values, context),
      ],
      realmBinding,
    );
  };
}

// Project helper: adapt converted constructor arguments and inject implementation dependencies.
function createImplementationConstructorSteps(
  implClass: ImplementationClass,
  assembled: AssembledCallable,
  context: BindingContext,
  realmBinding: RealmBinding,
  injectedArguments: InjectedArgument[] = [],
): ImplementationConstructorSteps {
  const adapt = createArgumentAdapter(assembled, realmBinding);
  return (values) => callImplementation(
    constructImplementationObject,
    undefined,
    [
      implClass,
      resolveImplementationArguments(
        adapt(values, context),
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
  assembled: AssembledCallable<OperationMember>,
  context: BindingContext,
  realmBinding: RealmBinding,
): OperationSteps {
  const adapt = createArgumentAdapter(assembled, realmBinding);
  return (receiver, ...values) => {
    const operationContext = receiver?.binding.context ?? context;
    return callImplementation(
      invoke,
      receiver?.implInst ?? null,
      [
        operationContext,
        ...adapt(values, operationContext),
      ],
      realmBinding,
    );
  };
}

// Project helper: adapt an implementation iterator to Web IDL's iteration hooks.
// Web IDL §2.5.10 Asynchronously iterable declarations.
function createAsyncIteratorSteps(
  factory: (this: object, ...values: unknown[]) => object,
  assembled: AssembledCallable<AsyncIterableMember>,
  context: BindingContext,
  realmBinding: RealmBinding,
): AsyncIteratorSteps {
  const adapt = createArgumentAdapter(assembled, realmBinding);
  return {
    // Project adapter for "asynchronous iterator initialization steps": call our iterator factory.
    create(target, argumentsList) {
      return callImplementation(
        factory,
        target,
        adapt(argumentsList, context),
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
  const adapt = set && !member.readonly ? createImplementationAdapter(member.type, {
    callbackExceptionBehavior: member.callbackExceptionBehavior,
  }, realmBinding) : undefined;
  memberBinding.attributeSteps = {
    get,
    ...(set && adapt
      ? {
        // Project helper: adapt the converted attribute value before storing it.
        set(receiver, value) {
          const operationContext = receiver?.binding.context ?? context;
          callImplementation(
            set,
            receiver?.implInst ?? target,
            [
              adapt(value, operationContext),
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
  const adapt = createArgumentAdapter(assembled, realmBinding);

  memberBinding.operationSteps = (receiver, ...values) => {
    const operationContext = receiver?.binding.context ?? context;
    return callImplementation(
      method,
      receiver?.implInst ?? null,
      resolveImplementationArguments(
        adapt(values, operationContext),
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

// Argument conversion has already established each declared IDL type.
function createArgumentAdapter(
  assembled: AssembledCallable,
  realmBinding: RealmBinding,
): (values: unknown[], context: BindingContext) => unknown[] {
  const adapters = assembled.arguments.map((argument) => {
    const adapt = createImplementationAdapter(argument.type, argument.primary, realmBinding);
    // Callback dictionaries also convert an omitted input into an empty dictionary.
    return argument.primary.callbackDictionary ? adapt : (value: unknown, context: BindingContext) =>
      value === missingArgument ? undefined : adapt(value, context);
  });
  const variadic = assembled.variadicArgument && adapters.at(-1);
  return (values, context) => {
    // Consume the invocation's fresh list; the intermediate IDL values are no longer needed.
    for (let index = 0; index < values.length; index++) {
      values[index] = (adapters[index] ?? variadic!)(values[index], context);
    }
    return values;
  };
}

type ImplementationAdapter<Value = unknown> = (
  value: Value, context: BindingContext, callbackThis?: unknown,
) => unknown;

// Select adaptation from the converted type, keeping runtime discrimination for unions and any.
function createImplementationAdapter(
  type: WebIDLType,
  options: ImplementationAdaptationOptions,
  realmBinding: RealmBinding,
): ImplementationAdapter {
  const assembly = realmBinding.assembly;
  if (options.callbackDictionary || options.implClasses?.length) {
    return (value, context) => adaptIDLToImpl(value, type, options, context, realmBinding);
  }
  const resolved = assembly.getConversionType(type).type;
  if (resolved.kind === 'nullable') {
    const adapt = createImplementationAdapter(resolved.type, options, realmBinding);
    return (value, context, callbackThis) => value === null ? null : adapt(value, context, callbackThis);
  }
  if (!assembly.requiresImplementationAdaptation(type)) return (value) => value;
  if (resolved.kind === 'reference') {
    const callbackAssembled = assembly.callbackFunctions.get(resolved.name);
    if (callbackAssembled) {
      const converter = realmBinding.getCallbackConverter(callbackAssembled);
      let resultAdapter: ImplementationAdapter | undefined;
      // A callback can return its own type; prepare that adapter only if invoked.
      const adaptResult: ImplementationAdapter = assembly.requiresImplementationAdaptation(callbackAssembled.primary.returns)
        ? (value, context) => (resultAdapter ??= createImplementationAdapter(
          callbackAssembled.primary.returns, {}, realmBinding,
        ))(value, context)
        : (value) => value;
      const adapt: ImplementationAdapter<CallbackFunctionValue> = (value, context, callbackThis) =>
        adaptCallbackFunction(value, options.callbackExceptionBehavior, context, realmBinding, callbackThis, converter, adaptResult);
      // The declared callback converter is the sole producer at this boundary.
      return adapt as ImplementationAdapter;
    }
    const assembled = assembly.dictionaries.get(resolved.name);
    if (assembled) {
      // Recursive dictionary declarations need the plan only when a value reaches this type.
      let members: { name: string; adapt: ImplementationAdapter; }[] | undefined;
      const adapt: ImplementationAdapter<IDLDictionaryValue> = (value, context, callbackThis) => {
        members ??= assembled.getAdaptedMembers(assembly).map((member) => ({
          name: member.name,
          adapt: createImplementationAdapter(member.type, {
            callbackExceptionBehavior: member.primary.callbackExceptionBehavior ?? options.callbackExceptionBehavior,
          }, realmBinding),
        }));
        const { record } = value;
        for (const member of members) {
          if (!Object.hasOwn(record, member.name)) continue;
          record[member.name] = member.adapt(record[member.name], context, callbackThis);
        }
        return record;
      };
      return adapt as ImplementationAdapter;
    }
  }
  return (value, context, callbackThis) => adaptIDLToImpl(value, type,
    callbackThis === undefined ? options : { ...options, callbackThis: isCallbackFunctionValue(value) ? callbackThis : undefined },
    context, realmBinding);
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
    const dictionaryType = options.callbackDictionary;
    return adaptIDLToImpl(
      convertToIDL(input, dictionaryType, realmBinding.defaultConversionContext), dictionaryType,
      { callbackThis: input }, context, realmBinding,
    );
  }
  if (value === missingArgument) return undefined;
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
  if (value instanceof IDLDictionaryValue) {
    const { assembled, record } = value;
    // Conversion owns this record and has already created its data properties.
    // Adapt in place without copying or touching inherited properties.
    for (const member of assembled.getAdaptedMembers(realmBinding.assembly)) {
      if (!Object.hasOwn(record, member.name)) continue;
      const memberValue = record[member.name];
      if (memberValue === null || (typeof memberValue !== 'object' && typeof memberValue !== 'function')) continue;
      record[member.name] = adaptIDLToImpl(
        memberValue, member.type,
        {
          callbackExceptionBehavior: member.primary.callbackExceptionBehavior ?? options.callbackExceptionBehavior,
          callbackThis: isCallbackFunctionValue(memberValue) ? options.callbackThis : undefined,
        },
        context, realmBinding,
      );
    }
    return record;
  }
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
    if (!elementType || !realmBinding.assembly.requiresImplementationAdaptation(elementType)) return value;
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
  const recordValueType = type && realmBinding.assembly.findRecordValueType(type);
  if (!recordValueType) return value;

  // Arbitrary record keys still use Map during conversion. Create their own
  // data properties together, including __proto__, before adapting values.
  const entries = value as Map<string, unknown>;
  const object = Object.fromEntries(entries);
  for (const [name, memberValue] of entries) {
    if (memberValue === null || (typeof memberValue !== 'object' && typeof memberValue !== 'function')) continue;
    object[name] = adaptIDLToImpl(
      memberValue, recordValueType,
      {
        callbackExceptionBehavior: options.callbackExceptionBehavior,
        callbackThis: isCallbackFunctionValue(memberValue) ? options.callbackThis : undefined,
      },
      context,
      realmBinding,
    );
  }
  return object;
}

type ImplementationAdaptationOptions = {
  callbackDictionary?: ReferenceType;
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
  converter: CallbackConverter = realmBinding.getCallbackConverter(value.assembled),
  adaptResult?: ImplementationAdapter,
): CallbackFunctionAdapter {
  const existing = value.adapter;
  if (existing) return existing;

  // Construction uses constructCallbackFunction, so ordinary calls need no Proxy.
  const adapter = stampCallbackFunction(function callback(this: unknown, ...argumentsList: unknown[]) {
    const result = converter.invoke(value, argumentsList, exceptionBehavior, callbackThis ?? this);
    return adaptResult ? adaptResult(result, context) : adaptIDLToImpl(
      result, value.assembled.primary.returns, {}, context, realmBinding,
    );
  }, value);
  value.adapter = adapter;
  return adapter;
}
