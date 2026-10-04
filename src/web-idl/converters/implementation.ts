import {
  endOfIteration, type AsyncIterator, type InternalPromise, type PromiseResultType,
} from '../../infra/index';
import type { CallbackExceptionBehavior, ImplementationClass } from '../core/index';

import type {
  IDLType, IDLNullableType, IDLUnionType, IDLSequenceType, IDLRecordType, IDLDictionaryType,
  IDLPromiseType, IDLAsyncSequenceType, AssembledCallable, AssembledDictionary,
} from '../assembly/index';
import {
  IDLAsyncSequence, IDLCallbackFunction, IDLCallbackInterface, IDLDictionary, IDLPromise,
  type IDLSequence, type IDLRecord, type IDLValue,
} from '../values/index';
import type { BindingContext } from '../binding/world';
import type { RealmBinding } from '../binding/realm';
import {
  CallbackFunctionStamper, type StampedCallbackFunction, type CallbackInvoker,
} from '../binding/realm/callback';
import { compileSteps } from '../compiler';

/** Prepare and perform IDL-to-implementation conversion using one realm's binding machinery. */
export class ImplementationConverter {
  /** Binding whose assembly and invocation facilities serve these converters. */
  #binding: RealmBinding;
  /** Dictionary member conversion shared by declaration and fallback callback exception policy. */
  #dictionaryConverters = new Map<AssembledDictionary,
    Map<CallbackExceptionBehavior | undefined, ImplConverter<IDLDictionary, IDLDictionary['record']>>>();

  constructor(binding: RealmBinding) {
    this.#binding = binding;
  }

  /** Prepare argument conversions, or return undefined when the IDL list can pass through unchanged. */
  createArgumentConverter(
    assembled: AssembledCallable,
  ): ((values: unknown[], context: BindingContext) => unknown[]) | undefined {
    const dependencies: Record<string, unknown> = {};
    const statements: string[] = [];
    for (const [index, argument] of assembled.arguments.entries()) {
      if (argument.type.canPassToImpl && !argument.callbackDictionary && !argument.implClasses?.length) continue;
      dependencies[`convert${index}`] = this.createConverter(argument.type, argument);
      const position = argument.optionality === 'variadic' ? 'index' : `${index}`;
      // Callback dictionaries also convert an omitted input into an empty dictionary.
      const statement = `
        ${argument.callbackDictionary ? '' : `if (values[${position}] !== undefined)`}
        values[${position}] = convert${index}(values[${position}], context);
      `;
      statements.push(argument.optionality === 'variadic'
        ? `for (let index = ${index}; index < values.length; index++) { ${statement} }`
        : `if (values.length > ${index}) { ${statement} }`);
    }
    if (!statements.length) return;
    const label = assembled.arguments.map((argument) => argument.type.conversionKey).join(',');
    // Consume the invocation's fresh list; the intermediate IDL values are no longer needed.
    return compileSteps(`implementation-arguments:${label}`, dependencies, `function convertArguments(values, context) {
      ${statements.join('\n')}
      return values;
    }`);
  }

  /** Prepare conversion from a declared IDL value to the representation its implementation consumes. */
  createConverter<Type extends IDLType, Options extends ImplConversionOptions>(
    type: Type, options: Options,
  ): ImplConverter<ImplInput<Type, Options>, ImplResult<Type, Options>>;
  createConverter(type: IDLType, options: ImplConversionOptions): ImplConverter {
    const convert = this.#createConverter(type, options);
    const classes = options.implClasses;
    if (!classes?.length || options.callbackDictionary) return convert;
    return (value, context, callbackThis) => {
      if (value !== null && (typeof value === 'object' || typeof value === 'function') &&
        !(value instanceof IDLDictionary) && !IDLAsyncSequence.is(value) && !IDLPromise.is(value)) {
        for (const implClass of classes) {
          const impl = context.unwrap(value, implClass);
          if (impl) return impl;
        }
      }
      return convert(value, context, callbackThis);
    };
  }

  /** Convert through the same prepared rules used by installed bindings. */
  idlToImpl<Type extends IDLType, Options extends ImplConversionOptions>(
    value: ImplInput<Type, Options>, type: Type, options: Options, context: BindingContext,
  ): ImplResult<Type, Options> {
    return this.createConverter(type, options)(value, context);
  }

  #createConverter(type: IDLType, options: ImplConversionOptions): ImplConverter {
    const realmBinding = this.#binding;
    if (options.callbackDictionary) {
      const type = options.callbackDictionary;
      const convertInput = realmBinding.getConverter(type).getJSToIDLSteps();
      const convert = this.#getDictionaryConverter(type.assembled, options.callbackExceptionBehavior);
      return (value, context) => convert(convertInput(value), context, value);
    }
    if (type.canPassToImpl) return (value) => value;
    if (type.kind === 'nullable') {
      const convert = this.#createConverter(type.innerType, options);
      return (value, context, callbackThis) => value === null ? null : convert(value, context, callbackThis);
    }
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
    if (type.kind === 'record') {
      const convertMember = this.createConverter(type.valueType, {
        callbackExceptionBehavior: options.callbackExceptionBehavior,
      });
      const convert: ImplConverter<IDLRecord, Record<string, unknown>> = (entries, context, callbackThis) => {
        // Define arbitrary keys, including __proto__, as own data properties.
        const record = Object.fromEntries(entries);
        if (!type.valueType.canPassToImpl) {
          for (const [name, value] of entries) {
            record[name] = convertMember(value, context, IDLCallbackFunction.is(value) ? callbackThis : undefined);
          }
        }
        return record;
      };
      return convert as ImplConverter;
    }
    if (type.kind === 'async-sequence') {
      const convert: ImplConverter<IDLAsyncSequence, AsyncIterator<unknown>> = (value, context) =>
        this.#openAsyncSequence(value, options.callbackExceptionBehavior, context);
      return convert as ImplConverter;
    }
    if (type.kind === 'promise') {
      const convertResult = this.#createResultConverter(type.resultType, options);
      const convert: ImplConverter<IDLPromise, InternalPromise<unknown>> = (value, context) =>
        this.#promiseToImpl(value, (result) => convertResult(result, context), context.Promise);
      return convert as ImplConverter;
    }
    if (type.kind === 'callback-function') {
      const callbackAssembled = type.assembled;
      const convertResult = this.#createResultConverter(callbackAssembled.returns, {});
      const convert: ImplConverter<IDLCallbackFunction, StampedCallbackFunction> = (value, context, callbackThis) =>
        this.#bindCallbackFunction(
          value, options.callbackExceptionBehavior, context, callbackThis,
          realmBinding.callbacks.getInvoker(callbackAssembled, value.realm), convertResult,
        );
      // The declared callback converter is the sole producer at this boundary.
      return convert as ImplConverter;
    }
    if (type.kind === 'dictionary') {
      return this.#getDictionaryConverter(type.assembled, options.callbackExceptionBehavior) as ImplConverter;
    }
    if (type.kind === 'callback-interface') {
      const toImpl = type.assembled.primary.toImpl;
      const convert: ImplConverter<IDLCallbackInterface> = toImpl
        ? (value, context) => realmBinding.callImplementation(toImpl, undefined, [context, value])
        : (value) => value;
      return convert as ImplConverter;
    }
    if (type.kind === 'union') {
      const candidates = type.candidates;
      const dictionary = candidates.dictionary && this.#createConverter(candidates.dictionary, options);
      const callbackFunction = candidates.callbackFunction && this.#createConverter(candidates.callbackFunction, options);
      const callbackInterface = candidates.callbackInterface && this.#createConverter(candidates.callbackInterface, options);
      const asyncSequence = candidates.asyncSequence && this.#createConverter(candidates.asyncSequence, options);
      const sequence = candidates.sequence && this.#createConverter(candidates.sequence, options);
      const record = candidates.record && this.#createConverter(candidates.record, options);
      // JS-to-IDL already selected the branch. Only representations needing
      // implementation conversion need identification here; the rest pass through.
      return (value, context, callbackThis) => {
        if (dictionary && value instanceof IDLDictionary) return dictionary(value, context, callbackThis);
        if (callbackFunction && IDLCallbackFunction.is(value)) return callbackFunction(value, context, callbackThis);
        if (callbackInterface && IDLCallbackInterface.is(value)) return callbackInterface(value, context);
        if (asyncSequence && IDLAsyncSequence.is(value)) return asyncSequence(value, context);
        if (sequence && Array.isArray(value)) return sequence(value, context);
        if (record && value instanceof Map) return record(value, context, callbackThis);
        return value;
      };
    }
    return (value) => value;
  }

  /** Reuse member conversion without retaining an input dictionary or its callback receiver. */
  #getDictionaryConverter(
    assembled: AssembledDictionary, exceptionBehavior: CallbackExceptionBehavior | undefined,
  ): ImplConverter<IDLDictionary, IDLDictionary['record']> {
    let converters = this.#dictionaryConverters.get(assembled);
    if (!converters) {
      converters = new Map<CallbackExceptionBehavior | undefined, ImplConverter<IDLDictionary, IDLDictionary['record']>>();
      this.#dictionaryConverters.set(assembled, converters);
    }
    let convert = converters.get(exceptionBehavior);
    if (convert) return convert;
    // Recursive dictionaries acquire their member plan only when a value reaches them.
    let members: { name: string; convert: ImplConverter; }[] | undefined;
    convert = (value, context, callbackThis) => {
      members ??= assembled.getMembersToConvert().map((member) => ({
        name: member.name,
        convert: this.createConverter(member.type, {
          callbackExceptionBehavior: member.callbackExceptionBehavior ?? exceptionBehavior,
        }),
      }));
      const { record } = value;
      for (const member of members) {
        if (!Object.hasOwn(record, member.name)) continue;
        const memberValue = record[member.name];
        // cbDict fixes only the dictionary's direct callback members to its original input.
        const receiver = callbackThis !== undefined && IDLCallbackFunction.is(memberValue) ? callbackThis : undefined;
        record[member.name] = member.convert(memberValue, context, receiver);
      }
      return record;
    };
    converters.set(exceptionBehavior, convert);
    return convert;
  }

  /** Callback and Promise results can be recursive; prepare their implementation steps on first use. */
  #createResultConverter(type: IDLType, options: ImplConversionOptions): ImplConverter {
    if (!options.implClasses?.length && type.canPassToImpl) return (value) => value;
    let convert: ImplConverter | undefined;
    return (value, context) => (convert ??= this.createConverter(type, options))(value, context);
  }

  /** Open an iterator whose repeated advances share element conversion and callback policy. */
  #openAsyncSequence(
    value: IDLAsyncSequence, exceptionBehavior: CallbackExceptionBehavior | undefined, context: BindingContext,
  ): AsyncIterator<unknown> {
    const binding = this.#binding;
    const { realm } = binding;
    const iterator = value.open(realm);
    const toIDL = binding.getConverter(value.elementType).getJSToIDLSteps();
    const toImpl = this.createConverter(value.elementType, { callbackExceptionBehavior: exceptionBehavior });
    const read = (item: unknown) => item === endOfIteration ? item : toImpl(item, context);
    return {
      next: () => {
        const result = iterator.nextValue(realm, toIDL);
        // nextValue already converts the yielded JS value in its reaction. Only
        // unpack that IDL result here; the end marker bypasses element conversion.
        // Containers are consumed in place, so each step retains its first conversion.
        let status: 'pending' | 'fulfilled' | 'rejected' = 'pending';
        let outcome: unknown;
        return context.Promise.fromNative(result.promise, (item) => {
          if (status === 'pending') {
            try {
              outcome = read(item);
              status = 'fulfilled';
            } catch (error) {
              outcome = error;
              status = 'rejected';
            }
          }
          if (status === 'rejected') throw outcome;
          return outcome;
        }, result.type as IDLType & PromiseResultType<unknown>);
      },
      return: (reason) => {
        const result = iterator.close(reason, realm);
        return context.Promise.fromNative(result.promise, () => undefined, result.type as IDLType & PromiseResultType<unknown>);
      },
    };
  }

  /** Convert fulfillment values inside an implementation promise's native reaction. */
  #promiseToImpl<Result>(value: IDLPromise, convertValue: (value: unknown) => Result, P: typeof InternalPromise): InternalPromise<Result> {
    const toIDL = this.#binding.getConverter(value.type, value.realm).getJSToIDLSteps();
    return P.fromNative(value.promise, (value) =>
      convertValue(toIDL(value)), value.type as IDLType & PromiseResultType<Result>);
  }

  /** Retain an implementation callable with the IDL callback's realm and invocation policy. */
  #bindCallbackFunction(
    cbValue: IDLCallbackFunction,
    exceptionBehavior: CallbackExceptionBehavior | undefined,
    context: BindingContext,
    callbackThis: unknown,
    invoker: CallbackInvoker,
    convert: ImplConverter,
  ): StampedCallbackFunction {
    const existing = cbValue.boundCallback;
    if (existing) return existing;

    // The IDL callback retains its construction entry; this callable only binds invocation.
    const boundCallback = CallbackFunctionStamper.stamp(function callback(this: unknown, ...argumentsList: unknown[]) {
      const result = invoker.invoke(cbValue, argumentsList, exceptionBehavior, callbackThis ?? this);
      return convert(result, context);
    }, cbValue);
    cbValue.boundCallback = boundCallback;
    return boundCallback;
  }
}

/** Implementation representation after unpacking IDL containers and binding callbacks. */
type ImplValue<Type extends IDLType> =
  IDLType extends Type ? unknown
    : Type extends IDLNullableType<infer Inner> ? ImplValue<Inner> | null
      : Type extends IDLUnionType<infer Member> ? ImplValue<Member>
        : Type extends IDLSequenceType<infer Element> ? ImplValue<Element>[]
          : Type extends IDLRecordType<infer Value> ? Record<string, ImplValue<Value>>
            : Type extends IDLDictionaryType ? IDLDictionary['record']
              : Type extends { kind: 'callback-function'; } ? StampedCallbackFunction
                : Type extends { kind: 'callback-interface'; } ? unknown
                  : Type extends IDLPromiseType<infer Result> ? InternalPromise<ImplValue<Result>>
                    : Type extends IDLAsyncSequenceType<infer Element> ? AsyncIterator<ImplValue<Element>>
                      : IDLValue<Type>;

// cbDict deliberately starts from the original author object instead of an IDL dictionary.
type ImplInput<Type extends IDLType, Options extends ImplConversionOptions> =
  'callbackDictionary' extends keyof Options ? unknown : IDLValue<Type>;

// Custom unwrapping and callback-interface hooks can replace the ordinary representation.
type ImplResult<Type extends IDLType, Options extends ImplConversionOptions> =
  Options extends { callbackDictionary: IDLDictionaryType; } ? IDLDictionary['record']
    : Extract<keyof Options, 'callbackDictionary' | 'implClasses'> extends never ? ImplValue<Type> : unknown;

/** Turn a converted IDL value into its implementation representation; this does not validate author input. */
type ImplConverter<Value = unknown, Result = unknown> = (
  value: Value, context: BindingContext, callbackThis?: unknown,
) => Result;

type ImplConversionOptions = {
  callbackDictionary?: IDLDictionaryType;
  callbackExceptionBehavior?: CallbackExceptionBehavior;
  implClasses?: ImplementationClass[];
};
