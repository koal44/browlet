import {
  endOfIteration, type AsyncIterator, type InternalPromise, type PromiseResultType,
} from '../../infra/index';
import type { CallbackExceptionBehavior, ImplementationClass } from '../core/index';

import type { IDLType, AssembledCallable } from '../assembly/index';
import {
  IDLAsyncSequence, IDLCallbackFunction, IDLCallbackInterface, IDLDictionary, IDLPromise, type IDLSequence,
} from '../values/index';
import type { BindingContext } from '../binding/context';
import type { RealmBinding } from '../binding/realm';
import {
  CallbackFunctionStamper, type StampedCallbackFunction, type CallbackInvoker,
} from '../binding/realm/callback';

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
        value === undefined ? undefined : convert(value, context);
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
  createConverter(type: IDLType, options: ImplConversionOptions): ImplConverter {
    const realmBinding = this.#binding;
    const assembly = realmBinding.assembly;
    if (options.callbackDictionary || options.implClasses?.length) {
      return (value, context) => this.idlToImpl(value, type, options, context);
    }
    if (type.kind === 'nullable') {
      const convert = this.createConverter(type.innerType, options);
      return (value, context, callbackThis) => value === null ? null : convert(value, context, callbackThis);
    }
    if (assembly.canPassToImpl(type)) return (value) => value;
    if (type.kind === 'sequence') {
      const convertElement = this.createConverter(type.elementType, {
        callbackExceptionBehavior: options.callbackExceptionBehavior,
      });
      const convert: ImplConverter<IDLSequence, IDLSequence> = (values, context) => {
        // JS-to-IDL conversion already created this list; convert its entries in place.
        for (let index = 0; index < values.length; index++) {
          values[index] = convertElement(values[index], context);
        }
        return values;
      };
      return convert as ImplConverter;
    }
    if (type.kind === 'callback-function') {
      const callbackAssembled = type.assembled;
      let resultConverter: ImplConverter | undefined;
      // A callback can return its own type; prepare that converter only if invoked.
      const convertResult: ImplConverter = !assembly.canPassToImpl(callbackAssembled.returns)
          ? (value, context) => (resultConverter ??= this.createConverter(
            callbackAssembled.returns, {},
          ))(value, context)
          : (value) => value;
      const convert: ImplConverter<IDLCallbackFunction, StampedCallbackFunction> = (value, context, callbackThis) =>
        this.#bindCallbackFunction(
          value, options.callbackExceptionBehavior, context, callbackThis,
          realmBinding.callbacks.getInvoker(callbackAssembled, value.realm), convertResult,
        );
        // The declared callback converter is the sole producer at this boundary.
      return convert as ImplConverter;
    }
    if (type.kind === 'dictionary') {
      const assembled = type.assembled;
      // Recursive dictionary declarations need the plan only when a value reaches this type.
      let members: { name: string; convert: ImplConverter; }[] | undefined;
      const convert: ImplConverter<IDLDictionary, Record<string, unknown>> = (value, context, callbackThis) => {
        members ??= assembled.getMembersToConvert(assembly).map((member) => ({
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
    return (value, context, callbackThis) => this.idlToImpl(value, type,
      callbackThis === undefined ? options : { ...options, callbackThis: IDLCallbackFunction.is(value) ? callbackThis : undefined },
      context);
  }

  /** Convert IDL values for implementation use; author coercion and validation have already happened. */
  idlToImpl(value: unknown, type: IDLType | undefined, options: ImplConversionOptions, context: BindingContext): unknown {
    const realmBinding = this.#binding;
    if (options.callbackDictionary !== undefined) {
      const dictionaryType = options.callbackDictionary;
      return this.idlToImpl(
        realmBinding.getConverter(dictionaryType).jsToIDL(value), dictionaryType,
        { callbackThis: value }, context,
      );
    }
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
    if (value instanceof IDLDictionary) {
      const { assembled, record } = value;
      // Conversion owns this record and has already created its data properties.
      // Convert in place without copying or touching inherited properties.
      for (const member of assembled.getMembersToConvert(realmBinding.assembly)) {
        if (!Object.hasOwn(record, member.name)) continue;
        const memberValue = record[member.name];
        if (memberValue === null || (typeof memberValue !== 'object' && typeof memberValue !== 'function')) continue;
        record[member.name] = this.idlToImpl(
          memberValue, member.type,
          {
            callbackExceptionBehavior: member.primary.callbackExceptionBehavior ?? options.callbackExceptionBehavior,
            callbackThis: IDLCallbackFunction.is(memberValue) ? options.callbackThis : undefined,
          },
          context,
        );
      }
      return record;
    }
    if (IDLAsyncSequence.is(value)) {
      // Delegates Web IDL §3.2.22.1 Iterating async sequences to async-sequence.ts.
      const iterator = value.open(realmBinding.realm);
      return {
        next: () => {
          const result = iterator.nextValue(realmBinding.realm,
            (item, itemType) => realmBinding.getConverter(itemType).jsToIDL(item));
          return this.#promiseToImpl(result,
            (item) => item === endOfIteration ? item :
              this.idlToImpl(item, value.elementType, {}, context),
            context.Promise);
        },
        return: (reason: unknown) => {
          const result = iterator.close(reason, realmBinding.realm);
          return this.#promiseToImpl(result, (value) => value, context.Promise);
        },
      } satisfies AsyncIterator<unknown>;
    }
    if (IDLPromise.is(value)) {
      return this.#promiseToImpl(value, (result) =>
        this.idlToImpl(
          result, value.type, options, context,
        ), context.Promise);
    }
    for (const implClass of options.implClasses ?? []) {
      const resolved = context.unwrap(value, implClass);
      if (resolved) return resolved;
    }
    if (IDLCallbackFunction.is(value)) {
      return this.#bindCallbackFunction(
        value,
        options.callbackExceptionBehavior,
        context,
        options.callbackThis,
      );
    }
    if (IDLCallbackInterface.is(value)) {
      const convert = value.assembled.primary.toImpl;
      if (!convert) return value;

      return realmBinding.callImplementation(convert, undefined, [context, value]);
    }
    if (Array.isArray(value)) {
      const elementType = type && realmBinding.assembly.findSequenceElementType(type);
      if (!elementType || realmBinding.assembly.canPassToImpl(elementType)) return value;
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
          callbackThis: IDLCallbackFunction.is(memberValue) ? options.callbackThis : undefined,
        },
        context,
      );
    }
    return object;
  }

  /** Convert fulfillment values inside an implementation promise's native reaction. */
  #promiseToImpl<Result>(value: IDLPromise, convertValue: (value: unknown) => Result, P: typeof InternalPromise): InternalPromise<Result> {
    const converter = this.#binding.getConverter(value.type, value.realm);
    return P.fromNative(value.promise, (value) =>
      convertValue(converter.jsToIDL(value)), value.type as IDLType & PromiseResultType<Result>);
  }

  /** Retain an implementation callable with the IDL callback's realm and invocation policy. */
  #bindCallbackFunction(
    cbValue: IDLCallbackFunction,
    exceptionBehavior: CallbackExceptionBehavior | undefined,
    context: BindingContext,
    callbackThis?: unknown,
    invoker: CallbackInvoker = this.#binding.callbacks.getInvoker(cbValue.assembled, cbValue.realm),
    convertResult?: ImplConverter,
  ): StampedCallbackFunction {
    const existing = cbValue.boundCallback;
    if (existing) return existing;

    // The IDL callback retains its construction entry; this callable only binds invocation.
    const convert = convertResult ?? ((result: unknown, context: BindingContext) =>
      this.idlToImpl(result, cbValue.assembled.returns, {}, context));
    const boundCallback = CallbackFunctionStamper.stamp(function callback(this: unknown, ...argumentsList: unknown[]) {
      const result = invoker.invoke(cbValue, argumentsList, exceptionBehavior, callbackThis ?? this);
      return convert(result, context);
    }, cbValue);
    cbValue.boundCallback = boundCallback;
    return boundCallback;
  }
}

/** Turn a converted IDL value into its implementation representation; this does not validate author input. */
type ImplConverter<Value = unknown, Result = unknown> = (
  value: Value, context: BindingContext, callbackThis?: unknown,
) => Result;

type ImplConversionOptions = {
  callbackDictionary?: IDLType;
  callbackExceptionBehavior?: CallbackExceptionBehavior;
  callbackThis?: unknown;
  implClasses?: ImplementationClass[];
};
