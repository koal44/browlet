import type { DefinitionAssembly } from './adapter/assembly';
import { createAsyncSequenceValue } from './async-sequence';
import { getBufferTypeName } from './buffer-source';
import {
  convertToIDL, createFrozenArrayFromIterable, createSequenceFromIterable,
  getMethod, isPlatformObject, materializeDefaultValue,
  type ConversionContext, type JavaScriptMethod,
} from './conversion';
import type {
  ArgumentDefinition, BufferTypeName, SimpleTypeName, WebIDLType,
} from './adapter/definition';
import {
  getFlattenedMemberTypes, getTypeWithApplicableExtendedAttributes,
  getUnannotatedType, includesNullableType,
} from './types';

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
    : getDistinguishingArgumentIndex(candidates, context.definitions);
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

  let method: JavaScriptMethod | undefined;
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
    throw new Error('Overload set did not resolve to one callable');
  }
  const selected = candidates[0] as EffectiveOverloadSetItem<Callable>;

  if (i === distinguishingIndex && asyncSequenceMethod) {
    const type = selected.types[i];
    const asyncSequence = type && findContainedType(
      type,
      context.definitions,
      (candidate) => candidate.kind === 'async-sequence',
    );
    if (!asyncSequence || asyncSequence.kind !== 'async-sequence') {
      throw new Error('Iterator method selected a non-async-sequence overload');
    }
    values.push(createAsyncSequenceValue(
      argumentsList[i] as object,
      asyncSequence.type,
      asyncSequenceMethod.method,
      asyncSequenceMethod.type,
    ));
    i++;
  }

  if (i === distinguishingIndex && method) {
    const type = selected.types[i];
    const sequenceLike = type && findContainedType(
      type,
      context.definitions,
      (candidate) =>
        candidate.kind === 'sequence' || candidate.kind === 'frozen-array',
    );
    if (
      !sequenceLike ||
      (sequenceLike.kind !== 'sequence' &&
        sequenceLike.kind !== 'frozen-array')
    ) {
      throw new Error('Iterator method selected a non-sequence-like overload');
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

function getOptionality(argument: ArgumentDefinition): Optionality {
  if (argument.variadic) return 'variadic';
  if (argument.optional) return 'optional';
  return 'required';
}

function getArgumentType(argument: ArgumentDefinition): WebIDLType {
  return getTypeWithApplicableExtendedAttributes(
    argument.type,
    argument.extendedAttributes,
  );
}

function resolveDistinguishingArgument<Callable extends IDLCallable>(
  candidates: EffectiveOverloadSetItem<Callable>[],
  value: unknown,
  index: number,
  context: ConversionContext,
): DistinguishingResolution<Callable> {
  let matches: EffectiveOverloadSetItem<Callable>[] | undefined;

  if (value === undefined) {
    matches = retain(candidates, ({ optionality }) =>
      optionality[index] === 'optional');
    if (matches) return { candidates: matches };
  }

  if (value === null || value === undefined) {
    matches = retain(candidates, ({ types }) => {
      const type = types[index] as WebIDLType;
      return includesNullableType(type, context.definitions) ||
        containsDictionary(type, context.definitions);
    });
    if (matches) return { candidates: matches };
  }

  if (isPlatformObject(value, context)) {
    matches = retain(candidates, ({ types }) => {
      const type = types[index] as WebIDLType;
      return containsImplementedInterface(type, value, context) ||
        containsSimpleType(type, 'object', context.definitions);
    });
    if (matches) return { candidates: matches };
  }

  if (isObject(value)) {
    const bufferName = getBufferTypeName(value);
    if (bufferName === 'ArrayBuffer' || bufferName === 'SharedArrayBuffer') {
      matches = retain(candidates, ({ types }) => {
        const type = types[index] as WebIDLType;
        return containsAnyBufferType(type, context.definitions) ||
          containsSimpleType(type, 'object', context.definitions);
      });
      if (matches) return { candidates: matches };
    } else if (bufferName === 'DataView') {
      matches = retain(candidates, ({ types }) => {
        const type = types[index] as WebIDLType;
        return containsSimpleType(type, 'DataView', context.definitions) ||
          containsSimpleType(type, 'object', context.definitions);
      });
      if (matches) return { candidates: matches };
    } else if (bufferName) {
      matches = retain(candidates, ({ types }) => {
        const type = types[index] as WebIDLType;
        return containsSimpleType(type, bufferName, context.definitions) ||
          containsSimpleType(type, 'object', context.definitions);
      });
      if (matches) return { candidates: matches };
    }
  }

  if (typeof value === 'function') {
    matches = retain(candidates, ({ types }) => {
      const type = types[index] as WebIDLType;
      return containsDefinitionKind(
        type,
        'callback-function',
        context.definitions,
      ) || containsSimpleType(type, 'object', context.definitions);
    });
    if (matches) return { candidates: matches };
  }

  if (isObject(value)) {
    const hasAsyncSequence = candidates.some(({ types }) =>
      containsKind(
        types[index] as WebIDLType,
        'async-sequence',
        context.definitions,
      ));
    const hasString = candidates.some(({ types }) =>
      containsStringType(types[index] as WebIDLType, context.definitions));

    if (hasAsyncSequence && !(isStringObject(value) && hasString)) {
      const asyncMethod = getMethod(value, Symbol.asyncIterator, context);
      const syncMethod = asyncMethod
        ? undefined
        : getMethod(value, Symbol.iterator, context);
      const iteratorMethod = asyncMethod ?? syncMethod;
      if (iteratorMethod) {
        matches = retain(candidates, ({ types }) =>
          containsKind(
            types[index] as WebIDLType,
            'async-sequence',
            context.definitions,
          ));
        if (matches) {
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
      containsSequenceLikeType(
        types[index] as WebIDLType,
        context.definitions,
      ));
    if (hasSequenceLike) {
      const iteratorMethod = getMethod(value, Symbol.iterator, context);
      if (iteratorMethod) {
        matches = retain(candidates, ({ types }) =>
          containsSequenceLikeType(
            types[index] as WebIDLType,
            context.definitions,
          ));
        if (matches) {
          return { candidates: matches, method: iteratorMethod };
        }
      }
    }

    matches = retain(candidates, ({ types }) => {
      const type = types[index] as WebIDLType;
      return containsDefinitionKind(
        type,
        'callback-interface',
        context.definitions,
      ) || containsDictionary(type, context.definitions) ||
      containsKind(type, 'record', context.definitions) ||
      containsSimpleType(type, 'object', context.definitions);
    });
    if (matches) return { candidates: matches };
  }

  if (typeof value === 'boolean') {
    matches = retain(candidates, ({ types }) =>
      containsSimpleType(
        types[index] as WebIDLType,
        'boolean',
        context.definitions,
      ));
    if (matches) return { candidates: matches };
  }

  if (typeof value === 'number') {
    matches = retain(candidates, ({ types }) =>
      containsNumericType(
        types[index] as WebIDLType,
        context.definitions,
      ));
    if (matches) return { candidates: matches };
  }

  if (typeof value === 'bigint') {
    matches = retain(candidates, ({ types }) =>
      containsSimpleType(
        types[index] as WebIDLType,
        'bigint',
        context.definitions,
      ));
    if (matches) return { candidates: matches };
  }

  matches = retain(candidates, ({ types }) =>
    containsStringType(
      types[index] as WebIDLType,
      context.definitions,
    ));
  if (matches) return { candidates: matches };

  matches = retain(candidates, ({ types }) =>
    containsNumericType(
      types[index] as WebIDLType,
      context.definitions,
    ));
  if (matches) return { candidates: matches };

  matches = retain(candidates, ({ types }) =>
    containsSimpleType(
      types[index] as WebIDLType,
      'boolean',
      context.definitions,
    ));
  if (matches) return { candidates: matches };

  matches = retain(candidates, ({ types }) =>
    containsSimpleType(
      types[index] as WebIDLType,
      'bigint',
      context.definitions,
    ));
  if (matches) return { candidates: matches };

  matches = retain(candidates, ({ types }) =>
    containsSimpleType(
      types[index] as WebIDLType,
      'any',
      context.definitions,
    ));
  if (matches) return { candidates: matches };

  return throwTypeError(context, 'No overload matches the argument value');
}

function convertArgument<Callable extends IDLCallable>(
  value: unknown,
  item: EffectiveOverloadSetItem<Callable>,
  index: number,
  context: ConversionContext,
): unknown {
  const type = item.types[index] as WebIDLType;
  const optionality = item.optionality[index] as Optionality;
  const argument = getDeclaredArgument(item.callable, index);

  if (optionality === 'optional' && value === undefined) {
    return argument?.default === undefined
      ? missingArgument
      : materializeDefaultValue(argument.default, type, context);
  }
  return convertToIDL(value, type, context);
}

function getDeclaredArgument(
  callable: IDLCallable,
  index: number,
): ArgumentDefinition | undefined {
  const argument = callable.arguments[index];
  if (argument) return argument;
  const last = callable.arguments.at(-1);
  return last?.variadic ? last : undefined;
}

function getDistinguishingArgumentIndex<Callable extends IDLCallable>(
  candidates: EffectiveOverloadSetItem<Callable>[],
  definitions: DefinitionAssembly,
): number {
  const length = candidates[0]?.types.length ?? 0;
  for (let index = 0; index < length; index++) {
    const first = canonicalType(
      candidates[0]?.types[index] as WebIDLType,
      definitions,
    );
    if (candidates.some(({ types }) =>
      canonicalType(types[index] as WebIDLType, definitions) !== first)) {
      return index;
    }
  }
  throw new Error('Overloads have no distinguishing argument');
}

function canonicalType(
  type: WebIDLType,
  definitions: DefinitionAssembly,
): string {
  const inner = getUnannotatedType(type, definitions);
  switch (inner.kind) {
    case 'simple':
      return inner.name;
    case 'reference':
      return `reference:${inner.name}`;
    case 'nullable':
      return `${canonicalType(inner.type, definitions)}?`;
    case 'union':
      return `(${inner.types.map((member) =>
        canonicalType(member, definitions)).join(' or ')})`;
    case 'sequence':
    case 'async-sequence':
    case 'promise':
    case 'frozen-array':
    case 'observable-array':
      return `${inner.kind}<${canonicalType(inner.type, definitions)}>`;
    case 'record':
      return `record<${canonicalType(inner.key, definitions)}, ${
        canonicalType(inner.value, definitions)
      }>`;
    case 'annotated':
      throw new Error('Unannotated type unexpectedly retained annotations');
  }
}

function containsImplementedInterface(
  type: WebIDLType,
  value: unknown,
  context: ConversionContext,
): boolean {
  return getContainedTypes(type, context.definitions).some((candidate) => {
    if (candidate.kind !== 'reference') return false;
    const interface_ = context.definitions.getInterface(candidate.name);
    if (interface_) return context.platformObjects.implements(value, interface_);
    return context.hostDefinedInterfaces.get(candidate.name)?.is(value) ?? false;
  });
}

function containsDefinitionKind(
  type: WebIDLType,
  kind: 'callback-function' | 'callback-interface',
  definitions: DefinitionAssembly,
): boolean {
  return getContainedTypes(type, definitions).some((candidate) =>
    candidate.kind === 'reference' &&
    definitions.getDefinition(candidate.name)?.kind === kind);
}

function containsDictionary(
  type: WebIDLType,
  definitions: DefinitionAssembly,
): boolean {
  return getContainedTypes(type, definitions).some((candidate) =>
    candidate.kind === 'reference' &&
    definitions.getDefinition(candidate.name)?.kind === 'dictionary');
}

function containsStringType(
  type: WebIDLType,
  definitions: DefinitionAssembly,
): boolean {
  return getContainedTypes(type, definitions).some((candidate) =>
    candidate.kind === 'simple'
      ? stringTypeNames.has(candidate.name)
      : candidate.kind === 'reference' &&
        definitions.getDefinition(candidate.name)?.kind === 'enumeration');
}

function containsNumericType(
  type: WebIDLType,
  definitions: DefinitionAssembly,
): boolean {
  return getContainedTypes(type, definitions).some((candidate) =>
    candidate.kind === 'simple' && numericTypeNames.has(candidate.name));
}

function containsSimpleType(
  type: WebIDLType,
  name: SimpleTypeName,
  definitions: DefinitionAssembly,
): boolean {
  return getContainedTypes(type, definitions).some((candidate) =>
    candidate.kind === 'simple' && candidate.name === name);
}

function containsAnyBufferType(
  type: WebIDLType,
  definitions: DefinitionAssembly,
): boolean {
  return getContainedTypes(type, definitions).some((candidate) =>
    candidate.kind === 'simple' &&
    bufferTypeNames.has(candidate.name as BufferTypeName));
}

function containsKind(
  type: WebIDLType,
  kind: WebIDLType['kind'],
  definitions: DefinitionAssembly,
): boolean {
  return getContainedTypes(type, definitions).some((candidate) =>
    candidate.kind === kind);
}

function containsSequenceLikeType(
  type: WebIDLType,
  definitions: DefinitionAssembly,
): boolean {
  return getContainedTypes(type, definitions).some((candidate) =>
    candidate.kind === 'sequence' || candidate.kind === 'frozen-array');
}

function findContainedType(
  type: WebIDLType,
  definitions: DefinitionAssembly,
  predicate: (candidate: WebIDLType) => boolean,
): WebIDLType | undefined {
  return getContainedTypes(type, definitions).find(predicate);
}

function getContainedTypes(
  type: WebIDLType,
  definitions: DefinitionAssembly,
): WebIDLType[] {
  const inner = getUnannotatedType(type, definitions);
  if (inner.kind === 'nullable') {
    return getContainedTypes(inner.type, definitions);
  }
  if (inner.kind === 'union') {
    return getFlattenedMemberTypes(inner, definitions);
  }
  return [inner];
}

function retain<Value>(
  values: Value[],
  predicate: (value: Value) => boolean,
): Value[] | undefined {
  const matches = values.filter(predicate);
  return matches.length > 0 ? matches : undefined;
}

function isStringObject(value: object): boolean {
  try {
    Reflect.apply(
      Reflect.get(String.prototype, 'valueOf') as (...args: unknown[]) => unknown,
      value,
      [],
    );
    return true;
  } catch {
    return false;
  }
}

function throwTypeError(
  context: ConversionContext,
  message: string,
): never {
  throw new context.realm.intrinsics.typeError(message);
}

function isObject(value: unknown): value is object {
  return value !== null && (
    typeof value === 'object' || typeof value === 'function'
  );
}

type DistinguishingResolution<Callable extends IDLCallable> = {
  asyncSequenceMethod?: AsyncSequenceMethod;
  candidates: EffectiveOverloadSetItem<Callable>[];
  method?: JavaScriptMethod;
};

type AsyncSequenceMethod = {
  method: JavaScriptMethod;
  type: 'async' | 'sync';
};

const numericTypeNames = new Set<SimpleTypeName>([
  'byte', 'octet', 'short', 'unsigned short', 'long', 'unsigned long',
  'long long', 'unsigned long long', 'float', 'unrestricted float',
  'double', 'unrestricted double',
]);

const stringTypeNames = new Set<SimpleTypeName>([
  'DOMString', 'ByteString', 'USVString',
]);

const bufferTypeNames = new Set<BufferTypeName>([
  'ArrayBuffer', 'SharedArrayBuffer',
]);
