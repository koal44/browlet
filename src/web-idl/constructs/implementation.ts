import type { AssembledCallable } from '../assembled';
import type { RealmBinding } from '../binding/realm';
import type { BindingContext } from '../binding/context';
import type {
  WebIDLType, CallbackExceptionBehavior, ImplementationClass, InjectedArgument, ReferenceType,
} from '../core/types';
import {
  CallbackFunctionCarrier, CallbackInterfaceCarrier, CallbackFunctionStamper,
  type StampedCallbackFunction, type CallbackInvoker,
} from './callback';
import { DictionaryCarrier } from './dictionary';
import type { IDLSequence } from './sequence';
import { PromiseCarrier } from './promise';
import { AsyncSequenceCarrier } from './async-sequence';
import { missingArgument } from '../binding/overload';
import { jsToIDL } from '../conversion';
import { InternalError } from '../../infra/internal-error';
import { endOfIteration, type AsyncIterator } from '../../infra/iteration';

/** Prepare and perform IDL-to-implementation conversion using one realm's binding machinery. */
export class ImplementationConverter {
  /** Binding whose assembly and invocation facilities serve these converters. */
  #binding: RealmBinding;

  constructor(binding: RealmBinding) {
    this.#binding = binding;
  }

  /** Prepare a callable's argument conversions, including its variadic tail. */
  createArgumentConverter(assembled: AssembledCallable): (values: unknown[], context: BindingContext) => unknown[] {
    const converters = assembled.arguments.map((argument) => {
      const convert = this.createConverter(argument.type, argument.primary);
      // Callback dictionaries also convert an omitted input into an empty dictionary.
      return argument.primary.callbackDictionary ? convert : (value: unknown, context: BindingContext) =>
        value === missingArgument ? undefined : convert(value, context);
    });
    const variadic = assembled.variadicArgument && converters.at(-1);
    return (values, context) => {
      // Consume the invocation's fresh list; the intermediate IDL values are no longer needed.
      for (let index = 0; index < values.length; index++) {
        values[index] = (converters[index] ?? variadic!)(values[index], context);
      }
      return values;
    };
  }

  /** Prepare conversion from a declared IDL value to the representation its implementation consumes. */
  createConverter(type: WebIDLType, options: ImplConversionOptions): ImplConverter {
    const realmBinding = this.#binding;
    const assembly = realmBinding.assembly;
    if (options.callbackDictionary || options.implClasses?.length) {
      return (value, context) => this.idlToImpl(value, type, options, context);
    }
    const resolved = assembly.getConversionRules(type).resolvedType;
    if (resolved.kind === 'nullable') {
      const convert = this.createConverter(resolved.type, options);
      return (value, context, callbackThis) => value === null ? null : convert(value, context, callbackThis);
    }
    if (!assembly.mayContainCarrier(type)) return (value) => value;
    if (resolved.kind === 'sequence') {
      const convertElement = this.createConverter(resolved.type, {
        callbackExceptionBehavior: options.callbackExceptionBehavior,
      });
      const convert: ImplConverter<IDLSequence, IDLSequence> = (values, context) => {
        // JS-to-IDL conversion already created this list; consume its carriers in place.
        for (let index = 0; index < values.length; index++) {
          values[index] = convertElement(values[index], context);
        }
        return values;
      };
      return convert as ImplConverter;
    }
    if (resolved.kind === 'reference') {
      const callbackAssembled = assembly.callbackFunctions.get(resolved.name);
      if (callbackAssembled) {
        let resultConverter: ImplConverter | undefined;
        // A callback can return its own type; prepare that converter only if invoked.
        const convertResult: ImplConverter = assembly.mayContainCarrier(callbackAssembled.primary.returns)
          ? (value, context) => (resultConverter ??= this.createConverter(
            callbackAssembled.primary.returns, {},
          ))(value, context)
          : (value) => value;
        const convert: ImplConverter<CallbackFunctionCarrier, StampedCallbackFunction> = (value, context, callbackThis) =>
          this.#bindCallbackFunction(
            value, options.callbackExceptionBehavior, context, callbackThis,
            realmBinding.getCallbackInvoker(callbackAssembled, value.realm), convertResult,
          );
        // The declared callback converter is the sole producer at this boundary.
        return convert as ImplConverter;
      }
      const assembled = assembly.dictionaries.get(resolved.name);
      if (assembled) {
        // Recursive dictionary declarations need the plan only when a value reaches this type.
        let members: { name: string; convert: ImplConverter; }[] | undefined;
        const convert: ImplConverter<DictionaryCarrier, Record<string, unknown>> = (value, context, callbackThis) => {
          members ??= assembled.getCarriedMembers(assembly).map((member) => ({
            name: member.name,
            convert: this.createConverter(member.type, {
              callbackExceptionBehavior: member.primary.callbackExceptionBehavior ?? options.callbackExceptionBehavior,
            }),
          }));
          const { record } = value;
          for (const member of members) {
            if (!Object.hasOwn(record, member.name)) continue;
            record[member.name] = member.convert(record[member.name], context, callbackThis);
          }
          return record;
        };
        return convert as ImplConverter;
      }
    }
    return (value, context, callbackThis) => this.idlToImpl(value, type,
      callbackThis === undefined ? options : { ...options, callbackThis: CallbackFunctionCarrier.is(value) ? callbackThis : undefined },
      context);
  }

  /** Consume conversion carriers; author coercion and validation have already happened. */
  idlToImpl(value: unknown, type: WebIDLType | undefined, options: ImplConversionOptions, context: BindingContext): unknown {
    const realmBinding = this.#binding;
    if (options.callbackDictionary !== undefined) {
      const input = value === missingArgument ? undefined : value;
      const dictionaryType = options.callbackDictionary;
      return this.idlToImpl(
        jsToIDL(input, realmBinding.getConversionContext(dictionaryType)), dictionaryType,
        { callbackThis: input }, context,
      );
    }
    if (value === missingArgument) return undefined;
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
    if (value instanceof DictionaryCarrier) {
      const { assembled, record } = value;
      // Conversion owns this record and has already created its data properties.
      // Convert in place without copying or touching inherited properties.
      for (const member of assembled.getCarriedMembers(realmBinding.assembly)) {
        if (!Object.hasOwn(record, member.name)) continue;
        const memberValue = record[member.name];
        if (memberValue === null || (typeof memberValue !== 'object' && typeof memberValue !== 'function')) continue;
        record[member.name] = this.idlToImpl(
          memberValue, member.type,
          {
            callbackExceptionBehavior: member.primary.callbackExceptionBehavior ?? options.callbackExceptionBehavior,
            callbackThis: CallbackFunctionCarrier.is(memberValue) ? options.callbackThis : undefined,
          },
          context,
        );
      }
      return record;
    }
    if (AsyncSequenceCarrier.is(value)) {
      // Delegates Web IDL §3.2.22.1 Iterating async sequences to async-sequence.ts.
      const iterator = value.open(realmBinding.realm);
      return {
        next: () => {
          const result = iterator.nextValue(realmBinding.realm,
            (item, itemType) => jsToIDL(item, realmBinding.getConversionContext(itemType)));
          return result.toImpl(realmBinding,
            (item) => item === endOfIteration ? item :
              this.idlToImpl(item, value.elementType, {}, context),
            context.Promise);
        },
        return: (reason: unknown) => {
          const result = iterator.close(reason, realmBinding.realm);
          return result.toImpl(realmBinding, (value) => value, context.Promise);
        },
      } satisfies AsyncIterator<unknown>;
    }
    if (PromiseCarrier.is(value)) {
      return value.toImpl(realmBinding, (result) =>
        this.idlToImpl(
          result, value.type, options, context,
        ), context.Promise);
    }
    for (const implClass of options.implClasses ?? []) {
      const resolved = context.unwrap(value, implClass);
      if (resolved) return resolved;
    }
    if (CallbackFunctionCarrier.is(value)) {
      return this.#bindCallbackFunction(
        value,
        options.callbackExceptionBehavior,
        context,
        options.callbackThis,
      );
    }
    if (CallbackInterfaceCarrier.is(value)) {
      const convert = value.assembled.primary.toImpl;
      if (!convert) return value;

      return callImplementation(convert, undefined, [context, value], realmBinding);
    }
    if (Array.isArray(value)) {
      const elementType = type && realmBinding.assembly.findSequenceElementType(type);
      if (!elementType || !realmBinding.assembly.mayContainCarrier(elementType)) return value;
      return value.map((item) =>
        this.idlToImpl(
          item,
          elementType,
          { callbackExceptionBehavior: options.callbackExceptionBehavior },
          context,
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
      object[name] = this.idlToImpl(
        memberValue,
        recordValueType,
        {
          callbackExceptionBehavior: options.callbackExceptionBehavior,
          callbackThis: CallbackFunctionCarrier.is(memberValue) ? options.callbackThis : undefined,
        },
        context,
      );
    }
    return object;
  }

  /** Retain an implementation callable with the carrier's realm and callback invocation policy. */
  #bindCallbackFunction(
    cbCarrier: CallbackFunctionCarrier,
    exceptionBehavior: CallbackExceptionBehavior | undefined,
    context: BindingContext,
    callbackThis?: unknown,
    invoker: CallbackInvoker = this.#binding.getCallbackInvoker(cbCarrier.assembled, cbCarrier.realm),
    convertResult?: ImplConverter,
  ): StampedCallbackFunction {
    const existing = cbCarrier.boundCallback;
    if (existing) return existing;

    // Construction belongs to the carrier; this callable only binds invocation.
    const convert = convertResult ?? ((result: unknown, context: BindingContext) =>
      this.idlToImpl(result, cbCarrier.assembled.primary.returns, {}, context));
    const boundCallback = CallbackFunctionStamper.stamp(function callback(this: unknown, ...argumentsList: unknown[]) {
      const result = invoker.invoke(cbCarrier, argumentsList, exceptionBehavior, callbackThis ?? this);
      return convert(result, context);
    }, cbCarrier);
    cbCarrier.boundCallback = boundCallback;
    return boundCallback;
  }
}

/** Turn a converted IDL value into its implementation representation; this does not validate author input. */
type ImplConverter<Value = unknown, Result = unknown> = (
  value: Value, context: BindingContext, callbackThis?: unknown,
) => Result;

type ImplConversionOptions = {
  callbackDictionary?: ReferenceType;
  callbackExceptionBehavior?: CallbackExceptionBehavior;
  callbackThis?: unknown;
  implClasses?: ImplementationClass[];
};

/** Construct an implementation using its already-converted arguments and injected dependencies. */
export function constructImplementationObject<T extends object>(
  implClass: ImplementationClass<T>,
  argumentsList: unknown[],
): T {
  return Reflect.construct(
    implClass as new (...argumentsList: unknown[]) => T,
    argumentsList,
  );
}

/** Merge converted arguments with dependencies resolved against receiver and method contexts. */
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

/** Invoke implementation code and realize private exception requests as they cross into Binding. */
export function callImplementation<This, Values extends unknown[], Result>(
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
