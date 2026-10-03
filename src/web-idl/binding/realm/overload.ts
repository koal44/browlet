import { InternalError } from '../../../infra/index';

import { getBufferTypeName, getMethod, hasStringData, isObject, type JSMethod } from '../../../js-engine/index';

import type { WebIDLType } from '../../core/index';

import type { AssembledArgument, AssembledCallable, AssembledOverloads } from '../../assembled';

import { getPlatformRecord, isPlatformObject } from '../platform';
import type { RealmBinding } from '../realm';

import { IDLAsyncSequence } from '../../values/index';

import type { SequenceConverter } from '../../converters/index';

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
    const getDefault = argument.primary.default === undefined
      ? undefined
      : converter.createDefaultSteps(argument.primary.default);
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
    const asyncSequence = binding.assembly.getUnionCandidates(type).typesByKind.get('async-sequence')?.resolvedType;
    if (!asyncSequence || asyncSequence.kind !== 'async-sequence') {
      throw new InternalError('Iterator method selected a non-async-sequence overload');
    }
    values.push(new IDLAsyncSequence(
      argumentsList[i] as object, asyncSequence.type, asyncSequenceMethod.method, asyncSequenceMethod.type,
    ));
    i++;
  }

  if (i === distinguishingIndex && method) {
    const type = selected.getArgument(i)!.type;
    const candidate = binding.assembly.getUnionCandidates(type).array;
    const sequenceLike = candidate?.resolvedType;
    if (
      !sequenceLike ||
      (sequenceLike.kind !== 'sequence' &&
        sequenceLike.kind !== 'frozen-array')
    ) {
      throw new InternalError('Iterator method selected a non-sequence-like overload');
    }
    const converter = binding.getConverter(candidate.declaredType) as SequenceConverter;
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
    if (argument.primary.default !== undefined) {
      values.push(binding.getConverter(argument.type).createDefault(argument.primary.default));
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
  const assembly = binding.assembly;
  let matches: Callable[];

  if (value === undefined) {
    matches = candidates.filter((callable) =>
      callable.getArgument(index)!.optionality === 'optional');
    if (matches.length > 0) return { candidates: matches };
  }

  if (value === null || value === undefined) {
    matches = candidates.filter((callable) => {
      const type = callable.getArgument(index)!.type;
      return assembly.includesNullableType(type) ||
        assembly.getCandidateTypes(type).some((candidate) =>
          candidate.kind === 'reference' &&
          assembly.dictionaries.has(candidate.name));
    });
    if (matches.length > 0) return { candidates: matches };
  }

  if (isPlatformObject(value, binding)) {
    matches = candidates.filter((callable) => {
      const type = callable.getArgument(index)!.type;
      return containsImplementedInterface(type, value, binding) ||
        assembly.hasSimpleCandidate(type, 'object');
    });
    if (matches.length > 0) return { candidates: matches };
  }

  if (isObject(value)) {
    const bufferName = getBufferTypeName(value);
    if (bufferName === 'ArrayBuffer' || bufferName === 'SharedArrayBuffer') {
      matches = candidates.filter((callable) => {
        const type = callable.getArgument(index)!.type;
        return assembly.hasArrayBufferCandidate(type) ||
          assembly.hasSimpleCandidate(type, 'object');
      });
      if (matches.length > 0) return { candidates: matches };
    } else if (bufferName === 'DataView') {
      matches = candidates.filter((callable) => {
        const type = callable.getArgument(index)!.type;
        return assembly.hasSimpleCandidate(type, 'DataView') ||
          assembly.hasSimpleCandidate(type, 'object');
      });
      if (matches.length > 0) return { candidates: matches };
    } else if (bufferName) {
      matches = candidates.filter((callable) => {
        const type = callable.getArgument(index)!.type;
        return assembly.hasSimpleCandidate(type, bufferName) ||
          assembly.hasSimpleCandidate(type, 'object');
      });
      if (matches.length > 0) return { candidates: matches };
    }
  }

  if (typeof value === 'function') {
    matches = candidates.filter((callable) => {
      const type = callable.getArgument(index)!.type;
      return assembly.getCandidateTypes(type).some((candidate) =>
        candidate.kind === 'reference'
          ? assembly.callbackFunctions.has(candidate.name)
          : candidate.kind === 'simple' && candidate.name === 'object');
    });
    if (matches.length > 0) return { candidates: matches };
  }

  if (isObject(value)) {
    const hasAsyncSequence = candidates.some((callable) =>
      assembly.hasCandidateKind(callable.getArgument(index)!.type, 'async-sequence'));
    const hasString = candidates.some((callable) =>
      assembly.hasStringCandidate(callable.getArgument(index)!.type));

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
          assembly.hasCandidateKind(callable.getArgument(index)!.type, 'async-sequence'));
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
      assembly.hasSequenceCandidate(callable.getArgument(index)!.type));
    if (hasSequenceLike) {
      const iteratorMethod = getMethod(
        value,
        Symbol.iterator,
        binding.realm,
      );
      if (iteratorMethod) {
        matches = candidates.filter((callable) =>
          assembly.hasSequenceCandidate(callable.getArgument(index)!.type));
        if (matches.length > 0) {
          return { candidates: matches, method: iteratorMethod };
        }
      }
    }

    matches = candidates.filter((callable) => {
      const type = callable.getArgument(index)!.type;
      return assembly.getCandidateTypes(type).some((candidate) => {
        if (candidate.kind === 'reference') {
          return assembly.callbackInterfaces.has(candidate.name) ||
            assembly.dictionaries.has(candidate.name);
        }
        return candidate.kind === 'record' ||
          candidate.kind === 'simple' && candidate.name === 'object';
      });
    });
    if (matches.length > 0) return { candidates: matches };
  }

  if (typeof value === 'boolean') {
    matches = candidates.filter((callable) =>
      assembly.hasSimpleCandidate(callable.getArgument(index)!.type, 'boolean'));
    if (matches.length > 0) return { candidates: matches };
  }

  if (typeof value === 'number') {
    matches = candidates.filter((callable) =>
      assembly.hasNumericCandidate(callable.getArgument(index)!.type));
    if (matches.length > 0) return { candidates: matches };
  }

  if (typeof value === 'bigint') {
    matches = candidates.filter((callable) =>
      assembly.hasSimpleCandidate(callable.getArgument(index)!.type, 'bigint'));
    if (matches.length > 0) return { candidates: matches };
  }

  matches = candidates.filter((callable) =>
    assembly.hasStringCandidate(callable.getArgument(index)!.type));
  if (matches.length > 0) return { candidates: matches };

  matches = candidates.filter((callable) =>
    assembly.hasNumericCandidate(callable.getArgument(index)!.type));
  if (matches.length > 0) return { candidates: matches };

  matches = candidates.filter((callable) =>
    assembly.hasSimpleCandidate(callable.getArgument(index)!.type, 'boolean'));
  if (matches.length > 0) return { candidates: matches };

  matches = candidates.filter((callable) =>
    assembly.hasSimpleCandidate(callable.getArgument(index)!.type, 'bigint'));
  if (matches.length > 0) return { candidates: matches };

  matches = candidates.filter((callable) =>
    assembly.hasSimpleCandidate(callable.getArgument(index)!.type, 'any'));
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
    return argument.primary.default === undefined
      ? undefined
      : binding.getConverter(argument.type).createDefault(argument.primary.default);
  }
  return binding.getConverter(argument.type).jsToIDL(value);
}

// Project helper: test candidate types against a platform object's implemented interfaces.
function containsImplementedInterface(
  type: WebIDLType,
  value: unknown,
  binding: RealmBinding,
): boolean {
  return binding.assembly.getCandidateTypes(type).some((candidate) => {
    if (candidate.kind !== 'reference') return false;
    const assembled = binding.assembly.interfaces.get(candidate.name);
    if (assembled) {
      const record = getPlatformRecord(value);
      return record?.binding.world === binding.world &&
        record.implements(assembled);
    }
    return binding.assembly.proxyObjects.get(candidate.name)?.is(value) ?? false;
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
