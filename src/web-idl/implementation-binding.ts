import type { PromiseValue } from '../js-engine/index';
import type { AssembledDictionaryDefinition, AssembledInterfaceDefinition } from './assembly';
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
import type {
  ArgumentDefinition, AttributeMember, OperationMember,
  StringifierMember, WebIDLType, CallbackExceptionBehavior,
  ImplementationClass, InjectedArgument, RecordType,
} from './core/types';
import type { AsyncIterableMember, ConstructorMember, IterableMember } from './core/declarations';
import type {
  AsyncIteratorSteps, AttributeSteps, ConstructorSteps,
  ImplementationConstructorSteps, ImplementationRegistry, OperationSteps,
  StringificationBehavior, ValuePairsSteps,
} from './implementation-registry';
import { getArgumentDefinition, missingArgument } from './overload';
import { convertToIDL } from './conversion';
import { toImplementationPromise } from './promise';
import { defineDataProperty } from './property';
import { isIDLPromiseRecord } from './promise-record';
import { getUnannotatedType } from './types';
import {
  closeAsyncIterator, endOfIteration, getAsyncIteratorNextValue,
  isIDLAsyncSequence, openAsyncSequence,
} from './async-sequence';

// Project helper: register declaration adapters for one realm.
export function registerDefinitionBindings(binding: RealmBinding): void {
  for (const primaryInterface of binding.definitions.getInterfaces()) {
    registerDefinedInterface(
      binding,
      binding.implementations,
      primaryInterface,
      binding.context,
    );
  }
  binding.platformObjects.registerRealm(binding);
}

// Project helper: connect interface declarations to implementation members and factories.
function registerDefinedInterface(
  realmBinding: RealmBinding,
  registry: ImplementationRegistry,
  primaryInterface: AssembledInterfaceDefinition,
  context: BindingContext,
): void {
  const definition = primaryInterface.definition.implementation;
  if (!definition) return;

  const implClass = definition.implClass;
  registry.setInterfaceForImplementation(implClass, primaryInterface);

  for (const { member } of primaryInterface.members) {
    switch (member.kind) {
      case 'attribute':
        if (member.attributeFunction || member.get || member.set) {
          registerDefinedAttribute(
            registry, member, primaryInterface, context, realmBinding,
          );
        } else {
          registerAttribute(
            registry,
            member,
            member.static ? implClass : implClass.prototype,
            primaryInterface,
            context,
            realmBinding,
          );
        }
        break;
      case 'constructor':
        if (member.construct) {
          const construct = member.construct;
          registry.setImplementationConstructorSteps(member, (values) => {
            const args = adaptArguments(values, member.arguments, context, realmBinding);
            return callImplementation(construct, undefined, [context, ...args], realmBinding);
          });
        } else if (member.invoke) {
          registry.setConstructorSteps(
            member,
            createDefinedConstructorSteps(
              member.invoke, member.arguments, context, realmBinding,
            ),
          );
        } else {
          registry.setImplementationConstructorSteps(
            member,
            createImplementationConstructorSteps(
              implClass,
              member.arguments,
              context,
              realmBinding,
              member.constructWith ?? definition.constructWith,
            ),
          );
        }
        break;
      case 'operation': {
        if (hasExtendedAttribute(member.extendedAttributes, 'Default')) break;
        if (member.invoke) {
          registry.setOperationSteps(
            member,
            createDefinedOperationSteps(
              member.invoke, member, context, realmBinding,
            ),
            primaryInterface,
          );
        } else {
          if (member.name === undefined) {
            throw missingMemberBinding(primaryInterface, member);
          }
          registerOperation(
            registry,
            member,
            member.name,
            member.static ? implClass : implClass.prototype,
            primaryInterface,
            context,
            realmBinding,
            member.invokeWith,
          );
        }
        const indexedGetter = member.indexedGetter;
        if (indexedGetter) {
          registry.setIndexedPropertySteps(member, {
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
          });
        }
        const getSupportedPropertyNames = member.getSupportedPropertyNames;
        if (getSupportedPropertyNames) {
          registry.setNamedPropertySteps(member, {
            // Project adapter for Web IDL §2.5.6.2 Named properties — supported property names.
            getSupportedPropertyNames() {
              return callImplementation(
                getSupportedPropertyNames,
                this,
                [context],
                realmBinding,
              );
            },
          });
        }
        break;
      }
      case 'iterable':
        if (member.key !== undefined) {
          registerPairIterable(
            registry,
            member,
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
          throw missingMemberBinding(primaryInterface, member);
        }
        registry.setAsyncIteratorSteps(
          member,
          createAsyncIteratorSteps(
            factory as (this: object, ...values: unknown[]) => object,
            member,
            context,
            realmBinding,
          ),
        );
        break;
      }
      case 'stringifier':
        registerStringifier(
          registry,
          member,
          implClass.prototype,
          primaryInterface,
          realmBinding,
        );
        break;
    }
  }

  registry.setImplementationCreationSteps(
    primaryInterface.definition,
    () => callImplementation(
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
    ),
  );
  const initializeImplementation = definition.initializeImplementation;
  if (initializeImplementation) {
    registry.setImplementationInitializationSteps(
      primaryInterface.definition,
      (value) => callImplementation(
        initializeImplementation,
        undefined,
        [context, value],
        realmBinding,
      ),
    );
  }
  const allocatePlatformObject = definition.allocatePlatformObject;
  if (allocatePlatformObject) {
    registry.setPlatformObjectAllocationSteps(
      primaryInterface.definition,
      (prototype) => callImplementation(
        allocatePlatformObject,
        undefined,
        [context, prototype],
        realmBinding,
      ),
    );
  }
}

type Constructable = new (...argumentsList: unknown[]) => object;

// Project helper: report an incomplete implementation registration.
function missingMemberBinding(
  primaryInterface: AssembledInterfaceDefinition,
  member: { kind: string; name?: string; },
): TypeError {
  return new TypeError(
    `Web IDL ${primaryInterface.definition.name}.${member.name ?? member.kind} has no binding`,
  );
}

// Project helper: register explicit getter, setter, or attribute-function adapters.
// Supplies attribute behavior to Web IDL §3.7.6 Attributes.
function registerDefinedAttribute(
  registry: ImplementationRegistry,
  member: AttributeMember,
  primaryInterface: AssembledInterfaceDefinition,
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
          primaryInterface, member,
          () => createCallback.call(undefined, ownerContext),
        );
      }
      if (!member.get) {
        throw new TypeError(
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
  registry.setAttributeSteps(member, steps, primaryInterface);
}

// Project helper: adapt converted constructor arguments for a declared initializer.
function createDefinedConstructorSteps(
  invoke: NonNullable<ConstructorMember['invoke']>,
  arguments_: ArgumentDefinition[],
  context: BindingContext,
  realmBinding: RealmBinding,
): ConstructorSteps {
  return function(...values) {
    callImplementation(
      invoke,
      this,
      [
        context,
        ...adaptArguments(values, arguments_, context, realmBinding),
      ],
      realmBinding,
    );
  };
}

// Project helper: adapt converted constructor arguments and inject implementation dependencies.
function createImplementationConstructorSteps(
  implementation: ImplementationClass,
  arguments_: ArgumentDefinition[],
  context: BindingContext,
  realmBinding: RealmBinding,
  injectedArguments: InjectedArgument[] = [],
): ImplementationConstructorSteps {
  return (values) => callImplementation(
    constructImplementationObject,
    undefined,
    [
      implementation,
      resolveImplementationArguments(
        adaptArguments(values, arguments_, context, realmBinding),
        injectedArguments,
        context,
      ),
    ],
    realmBinding,
  );
}

// Project helper: construct the implementation class through Reflect.construct.
export function constructImplementationObject<T extends object>(
  implementation: ImplementationClass<T>,
  argumentsList: unknown[],
): T {
  return Reflect.construct(
    implementation as Constructable,
    argumentsList,
    implementation as Constructable,
  ) as T;
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
  next: (this: object) => Promise<unknown> | PromiseValue<unknown>;
  return?: (this: object, value: unknown) => Promise<unknown> | PromiseValue<unknown>;
};

// Project helper: register adapters for implementation accessors.
// Supplies attribute behavior to Web IDL §3.7.6 Attributes.
function registerAttribute(
  registry: ImplementationRegistry,
  member: AttributeMember,
  target: object,
  primaryInterface: AssembledInterfaceDefinition,
  context: BindingContext,
  realmBinding: RealmBinding,
): void {
  const descriptor = findDescriptor(target, member.name);
  if (!descriptor?.get) {
    throw new TypeError(`Web IDL attribute ${member.name} has no implementation`);
  }

  const getterValue: unknown = Reflect.get(descriptor, 'get');
  const setterValue: unknown = Reflect.get(descriptor, 'set');
  const get = getterValue as (this: object | null) => unknown;
  const set = setterValue as
    ((this: object | null, value: unknown) => void) | undefined;
  registry.setAttributeSteps(member, {
    // Project helper: invoke the implementation getter through our exception boundary.
    get(receiver) {
      return callImplementation(get, receiver?.implInst ?? null, [], realmBinding);
    },
    ...(set && !member.readonly
      ? {
        // Project helper: adapt the converted attribute value before invoking the implementation setter.
        set(receiver, value) {
          const operationContext = receiver?.binding.context ?? context;
          callImplementation(
            set,
            receiver?.implInst ?? null,
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
  }, primaryInterface);
}

// Project helper: register an implementation method adapter.
// Supplies operation behavior to Web IDL §3.7.7 Operations.
function registerOperation(
  registry: ImplementationRegistry,
  member: OperationMember,
  name: string,
  target: object,
  primaryInterface: AssembledInterfaceDefinition,
  context: BindingContext,
  realmBinding: RealmBinding,
  injectedArguments: InjectedArgument[] = [],
): void {
  const value: unknown = findDescriptor(target, name)?.value;
  if (typeof value !== 'function') {
    throw new TypeError(
      `Web IDL operation ${name} has no implementation`,
    );
  }
  const method = value as (this: object | null, ...values: unknown[]) => unknown;

  registry.setOperationSteps(
    member,
    createOperationSteps(
      method,
      member,
      context,
      realmBinding,
      injectedArguments,
    ),
    primaryInterface,
  );
}

// Project helper: adapt converted arguments, inject dependencies, and invoke an implementation method.
function createOperationSteps(
  implementation: (this: object | null, ...values: unknown[]) => unknown,
  member: OperationMember,
  context: BindingContext,
  realmBinding: RealmBinding,
  injectedArguments: InjectedArgument[] = [],
): OperationSteps {
  return (receiver, ...values) => {
    const operationContext = receiver?.binding.context ?? context;
    return callImplementation(
      implementation,
      receiver?.implInst ?? null,
      resolveImplementationArguments(
        adaptArguments(values, member.arguments, operationContext, realmBinding),
        injectedArguments,
        operationContext,
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
): unknown[] {
  if (injectedArguments.length === 0) return argumentsList;

  const result: unknown[] = [];
  for (const { index, resolve } of injectedArguments) {
    if (Object.hasOwn(result, index)) {
      throw new TypeError(`Injected argument ${index} is declared more than once`);
    }
    result[index] = resolve(context);
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
  registry: ImplementationRegistry,
  member: IterableMember,
  target: object,
  realmBinding: RealmBinding,
): void {
  const value: unknown = findDescriptor(target, 'getEntryList')?.value;
  if (typeof value !== 'function') {
    throw new TypeError(
      'Web IDL pair iterable implementation has no getEntryList method',
    );
  }
  const getEntryList = value as ValuePairsSteps;
  registry.setValuePairsSteps(member, function() {
    return callImplementation(getEntryList, this, [], realmBinding);
  });
}

// Project helper: register an implementation's toString method as stringification behavior.
// Web IDL §2.5.5 Stringifiers.
function registerStringifier(
  registry: ImplementationRegistry,
  member: StringifierMember,
  target: object,
  primaryInterface: AssembledInterfaceDefinition,
  realmBinding: RealmBinding,
): void {
  const value: unknown = findDescriptor(target, 'toString')?.value;
  if (typeof value !== 'function') {
    throw new TypeError('Web IDL stringifier has no implementation');
  }
  const stringify = value as StringificationBehavior;
  registry.setStringificationBehavior(member, function() {
    return callImplementation(
      stringify,
      this,
      [],
      realmBinding,
    );
  }, primaryInterface);
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
  values: readonly unknown[],
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
      convertToIDL(input, dictionaryType, realmBinding), dictionaryType,
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
          (item, itemType) => convertToIDL(item, itemType, realmBinding)),
        realmBinding,
        (item) => item === endOfIteration ? item :
          adaptIDLToImpl(item, value.elementType, {}, context, realmBinding),
        context.promises,
      ),
      return: (reason: unknown) => toImplementationPromise(
        closeAsyncIterator(iterator, reason, realmBinding.realm), realmBinding, (result) => result,
        context.promises,
      ),
    };
  }
  if (isIDLPromiseRecord(value)) {
    return toImplementationPromise(value, realmBinding, (result) =>
      adaptIDLToImpl(
        result, value.type, options, context, realmBinding,
      ), context.promises);
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
    const adapt = value.definition.adapt;
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
    const itemType = type && getArrayItemType(
      type,
      realmBinding,
    );
    if (!itemType) return value;
    return value.map((item) =>
      adaptIDLToImpl(
        item,
        itemType,
        { callbackExceptionBehavior: options.callbackExceptionBehavior },
        context,
        realmBinding,
      ));
  }
  if (!(value instanceof Map)) return value;

  const declaration = type && getMapDeclaration(type, realmBinding);
  if (!declaration) return value;
  const members = 'members' in declaration ? declaration.members : undefined;
  const recordValueType = 'value' in declaration ? declaration.value : undefined;

  const object: Record<PropertyKey, unknown> = {};
  const dictionary = value as Map<PropertyKey, unknown>;
  for (const [name, memberValue] of dictionary) {
    const member = members?.find((member) => member.name === name);
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
        result, value.definition.returns, {}, context, realmBinding,
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

// Project helper: find the sequence element type through our nullable, union, and typedef representations.
function getArrayItemType(
  type: WebIDLType,
  binding: RealmBinding,
): WebIDLType | undefined {
  const innerType = getUnannotatedType(type, binding.definitions);
  switch (innerType.kind) {
    case 'nullable':
      return getArrayItemType(innerType.type, binding);
    case 'union':
      for (const memberType of innerType.types) {
        const itemType = getArrayItemType(memberType, binding);
        if (itemType) return itemType;
      }
      return undefined;
    case 'sequence':
      return innerType.type;
    default:
      return undefined;
  }
}

// Project helper: resolve a Map value's dictionary or record declaration for implementation adaptation.
function getMapDeclaration(
  type: WebIDLType,
  binding: RealmBinding,
): AssembledDictionaryDefinition | RecordType | undefined {
  const innerType = getUnannotatedType(type, binding.definitions);
  switch (innerType.kind) {
    case 'nullable':
      return getMapDeclaration(innerType.type, binding);
    case 'union':
      for (const memberType of innerType.types) {
        const declaration = getMapDeclaration(memberType, binding);
        if (declaration) return declaration;
      }
      return undefined;
    case 'record':
      return innerType;
    case 'reference':
      return binding.definitions.getDictionary(innerType.name);
    default:
      return undefined;
  }
}
