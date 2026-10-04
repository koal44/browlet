import { InternalError } from '../../../infra/index';
import { getBufferTypeName, getMethod, hasStringData, isObject, type JSMethod } from '../../../js-engine/index';

import type { IDLType, AssembledArgument, AssembledCallable, AssembledOverloads } from '../../assembly/index';
import { IDLAsyncSequence } from '../../values/index';
import { getPlatformRecord } from '../platform';
import type { RealmBinding } from '../realm';

/** Prepare invocation conversion once when installing a callable group in a realm. */
export function createOverloadResolver<Callable extends AssembledCallable>(
  overloads: AssembledOverloads<Callable>,
  binding: RealmBinding,
): (argumentsList: unknown[]) => ResolvedOverload<Callable> {
  if (overloads.callables.length !== 1) {
    return (argumentsList) => resolveOverload(overloads, argumentsList, binding);
  }
  const callable = overloads.callables[0]!;
  const converters = callable.arguments.map((argument) => {
    const converter = binding.getConverter(argument.type);
    const convert = converter.getJSToIDLSteps();
    const getDefault = argument.default === undefined
      ? undefined
      : converter.createDefaultSteps(argument.default);
    return (value: unknown) => argument.optionality === 'optional' && value === undefined
      ? getDefault?.()
      : convert(value);
  });
  const variadic = callable.variadicArgument && converters.at(-1);
  // A single callable needs the argument-count check and conversions, but no
  // candidate search or distinguishing-argument processing.
  // https://webidl.spec.whatwg.org/#dfn-overload-resolution-algorithm
  return (argumentsList) => {
    if (argumentsList.length < callable.minimumArgumentCount) {
      return throwTypeError(binding, 'No overload accepts this argument count');
    }
    const count = variadic
      ? Math.max(converters.length - 1, argumentsList.length)
      : converters.length;
    const values: unknown[] = [];
    for (let index = 0; index < count; index++) {
      values.push((converters[index] ?? variadic!)(argumentsList[index]));
    }
    return { callable, values };
  };
}

// https://webidl.spec.whatwg.org/#dfn-overload-resolution-algorithm
// Prepared argument-count groups replace the spec's expanded type and optionality lists.
// SPEC_MISMATCH: (effective overload set, arguments) -> (callable, IDL values)
export function resolveOverload<Callable extends AssembledCallable>(
  overloads: AssembledOverloads<Callable>,
  argumentsList: unknown[],
  binding: RealmBinding,
): ResolvedOverload<Callable> {
  const argcount = Math.min(overloads.maximumArgumentCount, argumentsList.length);
  const group = overloads.getCandidates(argcount);
  const distinguishingIndex = group.distinguishingIndex;
  let candidates = group.callables;
  if (candidates.length === 0) {
    return throwTypeError(binding, 'No overload accepts this argument count');
  }

  if (candidates.length > 1 && distinguishingIndex === -1) {
    throw new InternalError('Overloads have no distinguishing argument');
  }
  const values: unknown[] = [];
  let i = 0;

  while (i < distinguishingIndex) {
    values.push(convertArgument(
      argumentsList[i],
      candidates[0]!.getArgument(i)!,
      binding,
    ));
    i++;
  }

  let method: JSMethod | undefined;
  let asyncSequenceMethod: AsyncSequenceMethod | undefined;
  if (i === distinguishingIndex) {
    const resolution = resolveDistinguishingArgument(
      candidates,
      argumentsList[i],
      i,
      binding,
    );
    candidates = resolution.candidates;
    method = resolution.method;
    asyncSequenceMethod = resolution.asyncSequenceMethod;
  }

  if (candidates.length !== 1) {
    throw new InternalError('Overload set did not resolve to one callable');
  }
  const selected = candidates[0]!;

  if (i === distinguishingIndex && asyncSequenceMethod) {
    const type = selected.getArgument(i)!.type;
    const asyncSequence = type.candidates.asyncSequence;
    if (!asyncSequence) {
      throw new InternalError('Iterator method selected a non-async-sequence overload');
    }
    values.push(new IDLAsyncSequence(
      argumentsList[i] as object, asyncSequence.elementType, asyncSequenceMethod.method, asyncSequenceMethod.type,
    ));
    i++;
  }

  if (i === distinguishingIndex && method) {
    const type = selected.getArgument(i)!.type;
    const candidate = type.candidates.array;
    if (!candidate) {
      throw new InternalError('Iterator method selected a non-sequence-like overload');
    }
    const converter = binding.getConverter(candidate);
    values.push(converter.jsToIDLIterable(argumentsList[i] as object, method));
    i++;
  }

  while (i < argcount) {
    values.push(convertArgument(
      argumentsList[i],
      selected.getArgument(i)!,
      binding,
    ));
    i++;
  }

  while (i < selected.arguments.length) {
    const argument = selected.arguments[i]!;
    if (argument.default !== undefined) {
      values.push(binding.getConverter(argument.type).createDefault(argument.default));
    } else if (argument.optionality !== 'variadic') {
      values.push(undefined);
    }
    i++;
  }

  return { callable: selected, values };
}

export type ResolvedOverload<Callable extends AssembledCallable> = {
  callable: Callable;
  values: unknown[];
};

// Extracted from Web IDL §3.6 Overload resolution algorithm — select by the distinguishing argument.
function resolveDistinguishingArgument<Callable extends AssembledCallable>(
  candidates: Callable[],
  value: unknown,
  index: number,
  binding: RealmBinding,
): DistinguishingResolution<Callable> {
  let matches: Callable[];

  if (value === undefined) {
    matches = candidates.filter((callable) =>
      callable.getArgument(index)!.optionality === 'optional');
    if (matches.length > 0) return { candidates: matches };
  }

  if (value === null || value === undefined) {
    matches = candidates.filter((callable) => {
      const branches = callable.getArgument(index)!.type.candidates;
      return branches.includesNullable || branches.dictionary;
    });
    if (matches.length > 0) return { candidates: matches };
  }

  if (binding.isPlatformObject(value)) {
    matches = candidates.filter((callable) => {
      const type = callable.getArgument(index)!.type;
      return containsImplementedInterface(type, value, binding) ||
        type.candidates.hasObject;
    });
    if (matches.length > 0) return { candidates: matches };
  }

  if (isObject(value)) {
    const bufferName = getBufferTypeName(value);
    if (bufferName === 'ArrayBuffer' || bufferName === 'SharedArrayBuffer') {
      matches = candidates.filter((callable) => {
        const type = callable.getArgument(index)!.type;
        return type.candidates.hasArrayBuffer ||
          type.candidates.hasObject;
      });
      if (matches.length > 0) return { candidates: matches };
    } else if (bufferName === 'DataView') {
      matches = candidates.filter((callable) => {
        const type = callable.getArgument(index)!.type;
        return type.candidates.buffers.has('DataView') ||
          type.candidates.hasObject;
      });
      if (matches.length > 0) return { candidates: matches };
    } else if (bufferName) {
      matches = candidates.filter((callable) => {
        const type = callable.getArgument(index)!.type;
        return type.candidates.buffers.has(bufferName) ||
          type.candidates.hasObject;
      });
      if (matches.length > 0) return { candidates: matches };
    }
  }

  if (typeof value === 'function') {
    matches = candidates.filter((callable) => {
      const branches = callable.getArgument(index)!.type.candidates;
      return branches.callbackFunction || branches.hasObject;
    });
    if (matches.length > 0) return { candidates: matches };
  }

  if (isObject(value)) {
    const hasAsyncSequence = candidates.some((callable) =>
      !!callable.getArgument(index)!.type.candidates.asyncSequence);
    const hasString = candidates.some((callable) =>
      !!callable.getArgument(index)!.type.candidates.string);

    if (hasAsyncSequence && !(hasStringData(value) && hasString)) {
      const asyncMethod = getMethod(
        value,
        Symbol.asyncIterator,
        binding.realm,
      );
      const syncMethod = asyncMethod
        ? undefined
        : getMethod(value, Symbol.iterator, binding.realm);
      const iteratorMethod = asyncMethod ?? syncMethod;
      if (iteratorMethod) {
        matches = candidates.filter((callable) =>
          !!callable.getArgument(index)!.type.candidates.asyncSequence);
        if (matches.length > 0) {
          return {
            asyncSequenceMethod: {
              method: iteratorMethod,
              type: asyncMethod ? 'async' : 'sync',
            },
            candidates: matches,
          };
        }
      }
    }

    const hasSequenceLike = candidates.some((callable) =>
      !!callable.getArgument(index)!.type.candidates.array);
    if (hasSequenceLike) {
      const iteratorMethod = getMethod(
        value,
        Symbol.iterator,
        binding.realm,
      );
      if (iteratorMethod) {
        matches = candidates.filter((callable) =>
          !!callable.getArgument(index)!.type.candidates.array);
        if (matches.length > 0) {
          return { candidates: matches, method: iteratorMethod };
        }
      }
    }

    matches = candidates.filter((callable) => {
      const branches = callable.getArgument(index)!.type.candidates;
      return branches.callbackInterface || branches.dictionary || branches.record || branches.hasObject;
    });
    if (matches.length > 0) return { candidates: matches };
  }

  if (typeof value === 'boolean') {
    matches = candidates.filter((callable) =>
      callable.getArgument(index)!.type.candidates.hasBoolean);
    if (matches.length > 0) return { candidates: matches };
  }

  if (typeof value === 'number') {
    matches = candidates.filter((callable) =>
      !!callable.getArgument(index)!.type.candidates.numeric);
    if (matches.length > 0) return { candidates: matches };
  }

  if (typeof value === 'bigint') {
    matches = candidates.filter((callable) =>
      callable.getArgument(index)!.type.candidates.hasBigInt);
    if (matches.length > 0) return { candidates: matches };
  }

  matches = candidates.filter((callable) =>
    !!callable.getArgument(index)!.type.candidates.string);
  if (matches.length > 0) return { candidates: matches };

  matches = candidates.filter((callable) =>
    !!callable.getArgument(index)!.type.candidates.numeric);
  if (matches.length > 0) return { candidates: matches };

  matches = candidates.filter((callable) =>
    callable.getArgument(index)!.type.candidates.hasBoolean);
  if (matches.length > 0) return { candidates: matches };

  matches = candidates.filter((callable) =>
    callable.getArgument(index)!.type.candidates.hasBigInt);
  if (matches.length > 0) return { candidates: matches };

  matches = candidates.filter((callable) =>
    callable.getArgument(index)!.type.candidates.hasAny);
  if (matches.length > 0) return { candidates: matches };

  return throwTypeError(binding, 'No overload matches the argument value');
}

// Extracted from Web IDL §3.6 Overload resolution algorithm — convert an argument or use its default.
function convertArgument(
  value: unknown,
  argument: AssembledArgument,
  binding: RealmBinding,
): unknown {
  if (argument.optionality === 'optional' && value === undefined) {
    return argument.default === undefined
      ? undefined
      : binding.getConverter(argument.type).createDefault(argument.default);
  }
  return binding.getConverter(argument.type).jsToIDL(value);
}

// Project helper: test candidate types against a platform object's implemented interfaces.
function containsImplementedInterface(
  type: IDLType,
  value: unknown,
  binding: RealmBinding,
): boolean {
  return type.candidates.interfaces.some((candidate) => {
    if (candidate.kind === 'interface') {
      const record = getPlatformRecord(value);
      return record?.binding.world === binding.world &&
        record.implements(candidate.assembled);
    }
    return candidate.assembled.is(value);
  });
}

// Project helper: create an overload-resolution failure in the selected realm.
function throwTypeError(
  binding: RealmBinding,
  message: string,
): never {
  throw new binding.realm.intrinsics.typeError(message);
}

type DistinguishingResolution<Callable extends AssembledCallable> = {
  asyncSequenceMethod?: AsyncSequenceMethod;
  candidates: Callable[];
  method?: JSMethod;
};

type AsyncSequenceMethod = {
  method: JSMethod;
  type: 'async' | 'sync';
};
