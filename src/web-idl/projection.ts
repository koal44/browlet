import type { AssembledInterfaceDefinition } from './assembly';
import type { RealmBinding } from './binding';
import type { BindingContext } from './binding-context';
import {
  callUserObjectOperation, constructCallbackFunction, invokeCallbackFunction,
} from './callback';
import {
  isCallbackFunctionValue, isCallbackInterfaceRecord,
  type CallbackFunctionValue, type CallbackInterfaceValue,
} from './callback-value';
import {
  hasExtendedAttribute, idlType, reference, type ArgumentDefinition, type AttributeMember,
  type OperationMember, type StringifierMember, type WebIDLType,
} from './core/definition';
import type {
  AsyncIterableMember, ConstructorMember, IterableMember,
} from './core/definitions/interface';
import type {
  CallbackExceptionBehavior, ImplementationClass, InjectedArgument,
} from './core/binding';
import type {
  AsyncIteratorSteps, AttributeSteps, ConstructorSteps,
  ImplementationConstructorSteps, ImplementationRegistry, OperationSteps,
  StringificationBehavior,
} from './registry';
import type { ValuePair } from './iterable';
import type { WebIDLRealmHost } from './js-realm';
import { missingArgument } from './overload';
import { convertToIDL } from './conversion';
import { projectPromise, toImplementationPromise } from './promise';
import { isIDLPromise } from './promise-value';
import { getUnannotatedType } from './types';
import {
  closeAsyncIterator, endOfIteration, getAsyncIteratorNextValue,
  isIDLAsyncSequence, openAsyncSequence,
} from './async-sequence';

// Project helper: register declaration adapters for one realm.
export function registerDefinitionBindings<Realm extends WebIDLRealmHost>(
  binding: RealmBinding<Realm>,
  context: BindingContext<Realm>,
): void {
  for (const interface_ of binding.definitions.getInterfaces()) {
    registerDefinedInterface(
      binding,
      binding.implementations,
      interface_,
      context,
    );
  }
  binding.platformObjects.registerRealm(binding, context);
}

// Project helper: connect interface declarations to implementation members and factories.
function registerDefinedInterface(
  realmBinding: RealmBinding,
  registry: ImplementationRegistry,
  interface_: AssembledInterfaceDefinition,
  context: BindingContext,
): void {
  const definition = interface_.definition.implementation;
  if (!definition) return;

  const implementation = definition.implementation;
  registry.setInterfaceForImplementation(implementation, interface_);

  for (const { member } of interface_.members) {
    switch (member.kind) {
      case 'attribute':
        if (member.attributeFunction || member.get || member.set) {
          registerDefinedAttribute(
            registry, member, interface_, context, realmBinding,
          );
        } else {
          registerAttribute(
            registry,
            member,
            member.static ? implementation : implementation.prototype,
            interface_,
            context,
            realmBinding,
          );
        }
        break;
      case 'constructor':
        if (member.construct) {
          const construct = member.construct;
          registry.setImplementationConstructorSteps(member, (values) => {
            const args = values.map((value, index) => {
              const argument = getArgument(member.arguments, index);
              return adaptIDLToImpl(
                value, argument?.type, argument ?? {}, context, realmBinding,
              );
            });
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
              implementation,
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
            interface_,
          );
        } else {
          if (member.name === undefined) {
            throw missingMemberBinding(interface_, member);
          }
          registerOperation(
            registry,
            member,
            member.name,
            member.static ? implementation : implementation.prototype,
            interface_,
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
            implementation.prototype,
            realmBinding,
          );
        }
        break;
      case 'async-iterable': {
        const factory: unknown = member.create !== undefined
          ? findDescriptor(implementation.prototype, member.create)?.value
          : undefined;
        if (typeof factory !== 'function') {
          throw missingMemberBinding(interface_, member);
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
          implementation.prototype,
          interface_,
          realmBinding,
        );
        break;
    }
  }

  registry.setImplementationCreationSteps(
    interface_.definition,
    () => callImplementation(
      constructImplementationObject,
      undefined,
      [
        implementation,
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
      interface_.definition,
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
      interface_.definition,
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
  interface_: AssembledInterfaceDefinition,
  member: { kind: string; name?: string; },
): TypeError {
  return new TypeError(
    `Web IDL ${interface_.definition.name}.${member.name ?? member.kind} has no binding`,
  );
}

// Project helper: register explicit getter, setter, or attribute-function adapters.
// Supplies attribute behavior to Web IDL §3.7.6 Attributes.
function registerDefinedAttribute(
  registry: ImplementationRegistry,
  member: AttributeMember,
  interface_: AssembledInterfaceDefinition,
  context: BindingContext,
  realmBinding: RealmBinding,
): void {
  const createCallback = member.attributeFunction;
  const steps: AttributeSteps = {
    // Project helper: invoke a declared getter or obtain its realm-owned attribute function.
    get() {
      if (createCallback) {
        const ownerContext = getMemberBindingContext(member, this, context, realmBinding);
        const owner = realmBinding.platformObjects.getRealmBinding(ownerContext.realm);
        if (!owner) throw new Error('Attribute function realm has no binding');
        return owner.getAttributeFunction(
          interface_, member,
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
        this,
        [getMemberBindingContext(member, this, context, realmBinding)],
        realmBinding,
      );
    },
  };
  const set = member.set;
  if (set && !member.readonly) {
    steps.set = function(value) {
      const operationContext = getMemberBindingContext(member, this, context, realmBinding);
      callImplementation(
        set,
        this,
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
  registry.setAttributeSteps(member, steps, interface_);
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
        ...values.map((value, index) => {
          const argument = getArgument(arguments_, index);
          return adaptIDLToImpl(
            value,
            argument?.type,
            argument ?? {},
            context,
            realmBinding,
          );
        }),
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
        values.map((value, index) => {
          const argument = getArgument(arguments_, index);
          return adaptIDLToImpl(
            value,
            argument?.type,
            argument ?? {},
            context,
            realmBinding,
          );
        }),
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
  return function(...values) {
    const operationContext = getMemberBindingContext(
      member,
      this,
      context,
      realmBinding,
    );
    return callImplementation(
      invoke,
      this,
      [
        operationContext,
        ...values.map((value, index) => {
          const argument = getArgument(member.arguments, index);
          return adaptIDLToImpl(
            value,
            argument?.type,
            argument ?? {},
            operationContext,
            realmBinding,
          );
        }),
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
        argumentsList.map((value, index) => {
          const argument = getArgument(member.arguments ?? [], index);
          return adaptIDLToImpl(
            value,
            argument?.type,
            argument ?? {},
            context,
            realmBinding,
          );
        }),
        realmBinding,
      );
    },
    // Project adapter for "get the next iteration result": invoke next and project its promise.
    next(iterator: AsyncIteratorValue) {
      return projectPromise(callImplementation(
        iterator.next,
        iterator,
        [],
        realmBinding,
      ), idlType.any, realmBinding);
    },
    ...(member.return
      ? {
        // Project adapter for "asynchronous iterator return": invoke return and project its promise.
        return(iterator: AsyncIteratorValue, value: unknown) {
          return projectPromise(callImplementation(
            iterator.return!,
            iterator,
            [value],
            realmBinding,
          ), idlType.any, realmBinding);
        },
      }
      : {}),
  };
}

type AsyncIteratorValue = {
  next: (this: object) => unknown;
  return?: (this: object, value: unknown) => unknown;
};

// Project helper: register adapters for implementation accessors.
// Supplies attribute behavior to Web IDL §3.7.6 Attributes.
function registerAttribute(
  registry: ImplementationRegistry,
  member: AttributeMember,
  target: object,
  interface_: AssembledInterfaceDefinition,
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
    get() {
      return callImplementation(get, this, [], realmBinding);
    },
    ...(set && !member.readonly
      ? {
        // Project helper: adapt the converted attribute value before invoking the implementation setter.
        set(value: unknown) {
          const operationContext = getMemberBindingContext(member, this, context, realmBinding);
          callImplementation(
            set,
            this,
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
  }, interface_);
}

// Project helper: register an implementation method adapter.
// Supplies operation behavior to Web IDL §3.7.7 Operations.
function registerOperation(
  registry: ImplementationRegistry,
  member: OperationMember,
  name: string,
  target: object,
  interface_: AssembledInterfaceDefinition,
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
  const method = value as OperationSteps;

  registry.setOperationSteps(
    member,
    createOperationSteps(
      method,
      member,
      context,
      realmBinding,
      injectedArguments,
    ),
    interface_,
  );
}

// Project helper: adapt converted arguments, inject dependencies, and invoke an implementation method.
function createOperationSteps(
  implementation: OperationSteps,
  member: OperationMember,
  context: BindingContext,
  realmBinding: RealmBinding,
  injectedArguments: InjectedArgument[] = [],
): OperationSteps {
  return function(...values) {
    const operationContext = getMemberBindingContext(
      member,
      this,
      context,
      realmBinding,
    );
    return callImplementation(
      implementation,
      this,
      resolveImplementationArguments(
        values.map((value, index) => {
          const argument = getArgument(member.arguments, index);
          return adaptIDLToImpl(
            value,
            argument?.type,
            argument ?? {},
            operationContext,
            realmBinding,
          );
        }),
        injectedArguments,
        operationContext,
      ),
      realmBinding,
    );
  };
}

// Project helper: select the receiver's context, or the installed context for a static member.
function getMemberBindingContext(
  member: OperationMember | AttributeMember,
  receiver: object | null,
  installedContext: BindingContext,
  realmBinding: RealmBinding,
): BindingContext {
  if (member.static) return installedContext;
  if (!receiver) {
    throw new Error('Instance member has no implementation receiver');
  }
  const record = realmBinding.platformObjects.getImplementationRecord(receiver);
  if (!record) {
    throw new Error('Instance member receiver has no platform-object record');
  }
  const context = realmBinding.platformObjects.getBindingContext(record.realm);
  if (!context) {
    throw new Error('Member receiver realm has no binding context');
  }
  return context;
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

// Project helper: adapt an implementation's entries method to an IDL pair iterable.
// Web IDL §2.5.9 Iterable declarations — value pairs to iterate over.
function registerPairIterable(
  registry: ImplementationRegistry,
  member: IterableMember,
  target: object,
  realmBinding: RealmBinding,
): void {
  const value: unknown = findDescriptor(target, 'entries')?.value;
  if (typeof value !== 'function') {
    throw new TypeError(
      'Web IDL pair iterable implementation has no entries method',
    );
  }
  const entries = value as PairEntries;
  registry.setValuePairsSteps(member, function() {
    return callImplementation(
      collectValuePairs,
      this,
      [entries],
      realmBinding,
    );
  });
}

// Project helper: turn implementation entry tuples into our value-pair records.
function collectValuePairs(
  this: object,
  entries: PairEntries,
): ValuePair[] {
  const pairs = Reflect.apply(entries, this, []);
  return Array.from(pairs, ([key, value]) => ({ key, value }));
}

type PairEntries = (
  this: object,
) => Iterable<[key: unknown, value: unknown]>;

// Project helper: register an implementation's toString method as stringification behavior.
// Web IDL §2.5.5 Stringifiers.
function registerStringifier(
  registry: ImplementationRegistry,
  member: StringifierMember,
  target: object,
  interface_: AssembledInterfaceDefinition,
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
  }, interface_);
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
  if (isIDLPromise(value)) {
    return toImplementationPromise(value, realmBinding, (result) =>
      adaptIDLToImpl(
        result, value.type, options, context, realmBinding,
      ), context.promises);
  }
  for (const implementation of options.implementations ?? []) {
    const resolved = context.unwrap(value, implementation);
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
    const callbackAdapter = value.definition.adapter;
    if (!callbackAdapter) return value;

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
      callbackAdapter.adapt,
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

  const getMemberType = type && getMapMemberType(
    type,
    realmBinding,
  );
  if (!getMemberType) return value;

  const object: Record<PropertyKey, unknown> = {};
  const dictionary = value as Map<PropertyKey, unknown>;
  for (const [name, memberValue] of dictionary) {
    object[name] = adaptIDLToImpl(
      memberValue,
      getMemberType(name),
      {
        callbackExceptionBehavior:
          getMapMemberExceptionBehavior(type, name, realmBinding) ??
          options.callbackExceptionBehavior,
        callbackThis: isCallbackFunctionValue(memberValue) ? options.callbackThis : undefined,
      },
      context,
      realmBinding,
    );
  }
  return object;
}

type ImplementationAdaptationOptions = {
  callbackDictionary?: string;
  callbackExceptionBehavior?: CallbackExceptionBehavior;
  callbackThis?: unknown;
  implementations?: ImplementationClass[];
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

// Project helper: select argument metadata, reusing the final definition for variadic arguments.
function getArgument(
  definitions: ArgumentDefinition[],
  index: number,
): ArgumentDefinition | undefined {
  const definition = definitions[index];
  if (definition) return definition;
  const variadic = definitions.at(-1);
  return variadic?.variadic ? variadic : undefined;
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
      return innerType.types
        .map((memberType) => getArrayItemType(memberType, binding))
        .find((memberType) => memberType !== undefined);
    case 'sequence':
      return innerType.type;
    default:
      return undefined;
  }
}

// Project helper: resolve a dictionary member type or record value type for implementation adaptation.
function getMapMemberType(
  type: WebIDLType,
  binding: RealmBinding,
): ((name: PropertyKey) => WebIDLType | undefined) | undefined {
  const innerType = getUnannotatedType(type, binding.definitions);
  switch (innerType.kind) {
    case 'nullable':
      return getMapMemberType(innerType.type, binding);
    case 'union':
      return innerType.types
        .map((memberType) => getMapMemberType(memberType, binding))
        .find((getMemberType) => getMemberType !== undefined);
    case 'record':
      return () => innerType.value;
    case 'reference': {
      const dictionary = binding.definitions.getDictionary(innerType.name);
      if (!dictionary) return undefined;
      return (name) => typeof name === 'string'
        ? dictionary.members.find((member) => member.name === name)?.type
        : undefined;
    }
    default:
      return undefined;
  }
}

// Project helper: read a dictionary member's declared callback exception policy.
function getMapMemberExceptionBehavior(
  type: WebIDLType,
  name: PropertyKey,
  binding: RealmBinding,
): CallbackExceptionBehavior | undefined {
  const innerType = getUnannotatedType(type, binding.definitions);
  switch (innerType.kind) {
    case 'nullable':
      return getMapMemberExceptionBehavior(innerType.type, name, binding);
    case 'union':
      return innerType.types
        .map((memberType) => getMapMemberExceptionBehavior(
          memberType,
          name,
          binding,
        ))
        .find((behavior) => behavior !== undefined);
    case 'reference': {
      if (typeof name !== 'string') return undefined;
      const dictionary = binding.definitions.getDictionary(innerType.name);
      return dictionary?.members.find((member) => member.name === name)
        ?.callbackExceptionBehavior;
    }
    default:
      return undefined;
  }
}
