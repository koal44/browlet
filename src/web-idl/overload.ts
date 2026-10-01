import { getPlatformRecord } from './platform-object';
import {
  getBufferTypeName, getMethod, hasStringData, isObject, type JSMethod,
} from '../js-engine/index';
import type { DefinitionAssembly } from './assembly';
import { createIDLAsyncSequence } from './async-sequence';
import {
  convertToIDL, createFrozenArrayFromIterable, createSequenceFromIterable,
  isPlatformObject, materializeDefaultValue, type ConversionContext,
} from './conversion';
import type { ArgumentDefinition, WebIDLType } from './core/index';
import { getTypeWithApplicableExtendedAttributes } from './types';
import { InternalError } from '../infra/internal-error';

// Web IDL §2.5.8 Overloading — compute the effective overload set, from selected callables.
export function computeEffectiveOverloadSet<Callable extends IDLCallable>(
  callables: Callable[],
  argumentCount: number,
): EffectiveOverloadSetItem<Callable>[] {
  let maxarg = 0;
  for (const callable of callables) {
    maxarg = Math.max(maxarg, callable.arguments.length);
  }

  const max = Math.max(maxarg, argumentCount);
  const effectiveOverloadSet: EffectiveOverloadSetItem<Callable>[] = [];

  for (const callable of callables) {
    const argumentsList = callable.arguments;
    const n = argumentsList.length;
    const types = argumentsList.map(getArgumentType);
    const optionalityValues = argumentsList.map(getOptionality);

    effectiveOverloadSet.push({
      callable,
      optionality: optionalityValues,
      types,
    });

    const variadicType = types.at(-1);
    if (
      optionalityValues.at(-1) === 'variadic' &&
      variadicType !== undefined
    ) {
      for (let i = n; i <= max - 1; i++) {
        const t = types.slice();
        const o = optionalityValues.slice();

        for (let j = n; j <= i; j++) {
          t.push(variadicType);
          o.push('variadic');
        }
        effectiveOverloadSet.push({
          callable,
          optionality: o,
          types: t,
        });
      }
    }

    let i = n - 1;
    while (i >= 0) {
      if (optionalityValues[i] === 'required') break;
      effectiveOverloadSet.push({
        callable,
        optionality: optionalityValues.slice(0, i),
        types: types.slice(0, i),
      });
      i--;
    }
  }

  return effectiveOverloadSet;
}

// Web IDL §3.6 Overload resolution algorithm.
export function resolveOverload<Callable extends IDLCallable>(
  effectiveOverloadSet: EffectiveOverloadSetItem<Callable>[],
  argumentsList: unknown[],
  context: ConversionContext,
): ResolvedOverload<Callable> {
  const maxarg = effectiveOverloadSet.reduce(
    (maximum, item) => Math.max(maximum, item.types.length),
    0,
  );
  const argcount = Math.min(maxarg, argumentsList.length);
  let candidates = effectiveOverloadSet.filter(
    ({ types }) => types.length === argcount,
  );
  if (candidates.length === 0) {
    return throwTypeError(context, 'No overload accepts this argument count');
  }

  const distinguishingIndex = candidates.length === 1
    ? -1
    : getDistinguishingArgumentIndex(candidates, context.binding.assembly);
  const values: unknown[] = [];
  let i = 0;

  while (i < distinguishingIndex) {
    values.push(convertArgument(
      argumentsList[i],
      candidates[0] as EffectiveOverloadSetItem<Callable>,
      i,
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
  const selected = candidates[0] as EffectiveOverloadSetItem<Callable>;

  if (i === distinguishingIndex && asyncSequenceMethod) {
    const type = selected.types[i];
    const asyncSequence = type && context.binding.assembly.findCandidateType(
      type,
      (candidate) => candidate.kind === 'async-sequence',
    );
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
    const type = selected.types[i];
    const sequenceLike = type && context.binding.assembly.findCandidateType(
      type,
      (candidate) =>
        candidate.kind === 'sequence' || candidate.kind === 'frozen-array',
    );
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
      selected,
      i,
      context,
    ));
    i++;
  }

  while (i < selected.callable.arguments.length) {
    const argument = selected.callable.arguments[i] as ArgumentDefinition;
    if (argument.default !== undefined) {
      values.push(materializeDefaultValue(
        argument.default,
        getArgumentType(argument),
        context,
      ));
    } else if (!argument.variadic) {
      values.push(missingArgument);
    }
    i++;
  }

  return { callable: selected.callable, values };
}

export type IDLCallable = {
  arguments: ArgumentDefinition[];
};

export type EffectiveOverloadSetItem<Callable extends IDLCallable> = {
  callable: Callable;
  types: WebIDLType[];
  optionality: Optionality[];
};

export type Optionality = 'required' | 'optional' | 'variadic';

export type ResolvedOverload<Callable extends IDLCallable> = {
  callable: Callable;
  values: unknown[];
};

export const missingArgument: unique symbol = Symbol('Web IDL missing argument');
export type MissingArgument = typeof missingArgument;

// Extracted from Web IDL §2.5.8 Overloading — compute the effective overload set's optionality values.
function getOptionality(argument: ArgumentDefinition): Optionality {
  if (argument.variadic) return 'variadic';
  if (argument.optional) return 'optional';
  return 'required';
}

// Project helper: include applicable argument attributes in the type used for conversion.
function getArgumentType(argument: ArgumentDefinition): WebIDLType {
  return getTypeWithApplicableExtendedAttributes(
    argument.type,
    argument.extendedAttributes,
  );
}

// Extracted from Web IDL §3.6 Overload resolution algorithm — select by the distinguishing argument.
function resolveDistinguishingArgument<Callable extends IDLCallable>(
  candidates: EffectiveOverloadSetItem<Callable>[],
  value: unknown,
  index: number,
  context: ConversionContext,
): DistinguishingResolution<Callable> {
  const assembly = context.binding.assembly;
  let matches: EffectiveOverloadSetItem<Callable>[];

  if (value === undefined) {
    matches = candidates.filter(({ optionality }) =>
      optionality[index] === 'optional');
    if (matches.length > 0) return { candidates: matches };
  }

  if (value === null || value === undefined) {
    matches = candidates.filter(({ types }) => {
      const type = types[index] as WebIDLType;
      return assembly.includesNullableType(type) ||
        assembly.getCandidateTypes(type).some((candidate) =>
          candidate.kind === 'reference' &&
          assembly.dictionaries.has(candidate.name));
    });
    if (matches.length > 0) return { candidates: matches };
  }

  if (isPlatformObject(value, context)) {
    matches = candidates.filter(({ types }) => {
      const type = types[index] as WebIDLType;
      return containsImplementedInterface(type, value, context) ||
        assembly.hasSimpleCandidate(type, 'object');
    });
    if (matches.length > 0) return { candidates: matches };
  }

  if (isObject(value)) {
    const bufferName = getBufferTypeName(value);
    if (bufferName === 'ArrayBuffer' || bufferName === 'SharedArrayBuffer') {
      matches = candidates.filter(({ types }) => {
        const type = types[index] as WebIDLType;
        return assembly.hasArrayBufferCandidate(type) ||
          assembly.hasSimpleCandidate(type, 'object');
      });
      if (matches.length > 0) return { candidates: matches };
    } else if (bufferName === 'DataView') {
      matches = candidates.filter(({ types }) => {
        const type = types[index] as WebIDLType;
        return assembly.hasSimpleCandidate(type, 'DataView') ||
          assembly.hasSimpleCandidate(type, 'object');
      });
      if (matches.length > 0) return { candidates: matches };
    } else if (bufferName) {
      matches = candidates.filter(({ types }) => {
        const type = types[index] as WebIDLType;
        return assembly.hasSimpleCandidate(type, bufferName) ||
          assembly.hasSimpleCandidate(type, 'object');
      });
      if (matches.length > 0) return { candidates: matches };
    }
  }

  if (typeof value === 'function') {
    matches = candidates.filter(({ types }) => {
      const type = types[index] as WebIDLType;
      return assembly.getCandidateTypes(type).some((candidate) =>
        candidate.kind === 'reference'
          ? assembly.callbackFunctions.has(candidate.name)
          : candidate.kind === 'simple' && candidate.name === 'object');
    });
    if (matches.length > 0) return { candidates: matches };
  }

  if (isObject(value)) {
    const hasAsyncSequence = candidates.some(({ types }) =>
      assembly.hasCandidateKind(types[index] as WebIDLType, 'async-sequence'));
    const hasString = candidates.some(({ types }) =>
      assembly.hasStringCandidate(types[index] as WebIDLType));

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
        matches = candidates.filter(({ types }) =>
          assembly.hasCandidateKind(types[index] as WebIDLType, 'async-sequence'));
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

    const hasSequenceLike = candidates.some(({ types }) =>
      assembly.hasSequenceCandidate(types[index] as WebIDLType));
    if (hasSequenceLike) {
      const iteratorMethod = getMethod(
        value,
        Symbol.iterator,
        context.realm,
      );
      if (iteratorMethod) {
        matches = candidates.filter(({ types }) =>
          assembly.hasSequenceCandidate(types[index] as WebIDLType));
        if (matches.length > 0) {
          return { candidates: matches, method: iteratorMethod };
        }
      }
    }

    matches = candidates.filter(({ types }) => {
      const type = types[index] as WebIDLType;
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
    matches = candidates.filter(({ types }) =>
      assembly.hasSimpleCandidate(types[index] as WebIDLType, 'boolean'));
    if (matches.length > 0) return { candidates: matches };
  }

  if (typeof value === 'number') {
    matches = candidates.filter(({ types }) =>
      assembly.hasNumericCandidate(types[index] as WebIDLType));
    if (matches.length > 0) return { candidates: matches };
  }

  if (typeof value === 'bigint') {
    matches = candidates.filter(({ types }) =>
      assembly.hasSimpleCandidate(types[index] as WebIDLType, 'bigint'));
    if (matches.length > 0) return { candidates: matches };
  }

  matches = candidates.filter(({ types }) =>
    assembly.hasStringCandidate(types[index] as WebIDLType));
  if (matches.length > 0) return { candidates: matches };

  matches = candidates.filter(({ types }) =>
    assembly.hasNumericCandidate(types[index] as WebIDLType));
  if (matches.length > 0) return { candidates: matches };

  matches = candidates.filter(({ types }) =>
    assembly.hasSimpleCandidate(types[index] as WebIDLType, 'boolean'));
  if (matches.length > 0) return { candidates: matches };

  matches = candidates.filter(({ types }) =>
    assembly.hasSimpleCandidate(types[index] as WebIDLType, 'bigint'));
  if (matches.length > 0) return { candidates: matches };

  matches = candidates.filter(({ types }) =>
    assembly.hasSimpleCandidate(types[index] as WebIDLType, 'any'));
  if (matches.length > 0) return { candidates: matches };

  return throwTypeError(context, 'No overload matches the argument value');
}

// Extracted from Web IDL §3.6 Overload resolution algorithm — convert an argument or use its default.
function convertArgument<Callable extends IDLCallable>(
  value: unknown,
  item: EffectiveOverloadSetItem<Callable>,
  index: number,
  context: ConversionContext,
): unknown {
  const type = item.types[index] as WebIDLType;
  const optionality = item.optionality[index] as Optionality;
  const argument = getArgumentDefinition(item.callable.arguments, index);

  if (optionality === 'optional' && value === undefined) {
    return argument?.default === undefined
      ? missingArgument
      : materializeDefaultValue(argument.default, type, context);
  }
  return convertToIDL(value, type, context);
}

// Project helper: find the declaration for a fixed or expanded variadic argument.
export function getArgumentDefinition(
  definitions: ArgumentDefinition[],
  index: number,
): ArgumentDefinition | undefined {
  const argument = definitions[index];
  if (argument) return argument;
  const last = definitions.at(-1);
  return last?.variadic ? last : undefined;
}

// Locate the distinguishing position by comparing overload type keys.
// Web IDL §2.5.8 Overloading — distinguishing argument index.
function getDistinguishingArgumentIndex<Callable extends IDLCallable>(
  candidates: EffectiveOverloadSetItem<Callable>[],
  assembly: DefinitionAssembly,
): number {
  const length = candidates[0]?.types.length ?? 0;
  for (let index = 0; index < length; index++) {
    const first = assembly.getOverloadTypeKey(candidates[0]?.types[index] as WebIDLType);
    if (candidates.some(({ types }) =>
      assembly.getOverloadTypeKey(types[index] as WebIDLType) !== first)) {
      return index;
    }
  }
  throw new InternalError('Overloads have no distinguishing argument');
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

type DistinguishingResolution<Callable extends IDLCallable> = {
  asyncSequenceMethod?: AsyncSequenceMethod;
  candidates: EffectiveOverloadSetItem<Callable>[];
  method?: JSMethod;
};

type AsyncSequenceMethod = {
  method: JSMethod;
  type: 'async' | 'sync';
};
