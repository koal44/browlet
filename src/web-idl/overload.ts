import { getPlatformRecord } from './platform-object';
import {
  getBufferTypeName, getMethod, hasStringData, isObject, type JSMethod,
} from '../js-engine/index';
import type { AssembledArgument, AssembledCallable, AssembledOverloads } from './assembled';
import { createIDLAsyncSequence } from './async-sequence';
import {
  convertToIDL, createDefaultValueFactory, createIDLConverter, createFrozenArrayFromIterable, createSequenceFromIterable,
  isPlatformObject, materializeDefaultValue, type ConversionContext,
} from './conversion';
import type { WebIDLType } from './core/index';
import { InternalError } from '../infra/internal-error';

/** Prepare invocation conversion once when installing a callable group in a realm. */
export function createOverloadResolver<Callable extends AssembledCallable>(
  overloads: AssembledOverloads<Callable>,
  context: ConversionContext,
): (argumentsList: unknown[]) => ResolvedOverload<Callable> {
  if (overloads.callables.length !== 1) {
    return (argumentsList) => resolveOverload(overloads, argumentsList, context);
  }
  const callable = overloads.callables[0]!;
  const converters = callable.arguments.map((argument) => {
    const convert = createIDLConverter(argument.type, context);
    const getDefault = argument.primary.default === undefined
      ? undefined
      : createDefaultValueFactory(argument.primary.default, argument.type);
    return (value: unknown) => argument.optionality === 'optional' && value === undefined
      ? getDefault ? getDefault(context) : missingArgument
      : convert(value);
  });
  const variadic = callable.variadicArgument && converters.at(-1);
  // A single callable needs the argument-count check and conversions, but no
  // candidate search or distinguishing-argument processing.
  // https://webidl.spec.whatwg.org/#dfn-overload-resolution-algorithm
  return (argumentsList) => {
    if (argumentsList.length < callable.minimumArgumentCount) {
      return throwTypeError(context, 'No overload accepts this argument count');
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
  context: ConversionContext,
): ResolvedOverload<Callable> {
  const argcount = Math.min(overloads.maximumArgumentCount, argumentsList.length);
  const group = overloads.getCandidates(argcount);
  const distinguishingIndex = group.distinguishingIndex;
  let candidates = group.callables;
  if (candidates.length === 0) {
    return throwTypeError(context, 'No overload accepts this argument count');
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
      context,
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
      context,
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
    const asyncSequence = context.binding.assembly.getUnionCandidates(type).typesByKind.get('async-sequence')?.type;
    if (!asyncSequence || asyncSequence.kind !== 'async-sequence') {
      throw new InternalError('Iterator method selected a non-async-sequence overload');
    }
    values.push(createIDLAsyncSequence(
      argumentsList[i] as object,
      asyncSequence.type,
      asyncSequenceMethod.method,
      asyncSequenceMethod.type,
    ));
    i++;
  }

  if (i === distinguishingIndex && method) {
    const type = selected.getArgument(i)!.type;
    const sequenceLike = context.binding.assembly.getUnionCandidates(type).array?.type;
    if (
      !sequenceLike ||
      (sequenceLike.kind !== 'sequence' &&
        sequenceLike.kind !== 'frozen-array')
    ) {
      throw new InternalError('Iterator method selected a non-sequence-like overload');
    }
    values.push(sequenceLike.kind === 'sequence'
      ? createSequenceFromIterable(
        argumentsList[i] as object,
        sequenceLike.type,
        method,
        context,
      )
      : createFrozenArrayFromIterable(
        argumentsList[i] as object,
        sequenceLike.type,
        method,
        context,
      ));
    i++;
  }

  while (i < argcount) {
    values.push(convertArgument(
      argumentsList[i],
      selected.getArgument(i)!,
      context,
    ));
    i++;
  }

  while (i < selected.arguments.length) {
    const argument = selected.arguments[i]!;
    if (argument.primary.default !== undefined) {
      values.push(materializeDefaultValue(
        argument.primary.default,
        argument.type,
        context,
      ));
    } else if (argument.optionality !== 'variadic') {
      values.push(missingArgument);
    }
    i++;
  }

  return { callable: selected, values };
}

export type ResolvedOverload<Callable extends AssembledCallable> = {
  callable: Callable;
  values: unknown[];
};

export const missingArgument: unique symbol = Symbol('Web IDL missing argument');
export type MissingArgument = typeof missingArgument;

// Extracted from Web IDL §3.6 Overload resolution algorithm — select by the distinguishing argument.
function resolveDistinguishingArgument<Callable extends AssembledCallable>(
  candidates: Callable[],
  value: unknown,
  index: number,
  context: ConversionContext,
): DistinguishingResolution<Callable> {
  const assembly = context.binding.assembly;
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

  if (isPlatformObject(value, context)) {
    matches = candidates.filter((callable) => {
      const type = callable.getArgument(index)!.type;
      return containsImplementedInterface(type, value, context) ||
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
        context.realm,
      );
      const syncMethod = asyncMethod
        ? undefined
        : getMethod(value, Symbol.iterator, context.realm);
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
        context.realm,
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

  return throwTypeError(context, 'No overload matches the argument value');
}

// Extracted from Web IDL §3.6 Overload resolution algorithm — convert an argument or use its default.
function convertArgument(
  value: unknown,
  argument: AssembledArgument,
  context: ConversionContext,
): unknown {
  if (argument.optionality === 'optional' && value === undefined) {
    return argument.primary.default === undefined
      ? missingArgument
      : materializeDefaultValue(argument.primary.default, argument.type, context);
  }
  return convertToIDL(value, argument.type, context);
}

// Project helper: test candidate types against a platform object's implemented interfaces.
function containsImplementedInterface(
  type: WebIDLType,
  value: unknown,
  context: ConversionContext,
): boolean {
  return context.binding.assembly.getCandidateTypes(type).some((candidate) => {
    if (candidate.kind !== 'reference') return false;
    const assembled = context.binding.assembly.interfaces.get(candidate.name);
    if (assembled) {
      const record = getPlatformRecord(value);
      return record?.binding.world === context.binding.world &&
        record.implements(assembled);
    }
    return context.binding.assembly.proxyObjects.get(candidate.name)?.is(value) ?? false;
  });
}

// Project helper: create an overload-resolution failure in the selected realm.
function throwTypeError(
  context: ConversionContext,
  message: string,
): never {
  throw new context.realm.intrinsics.typeError(message);
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
