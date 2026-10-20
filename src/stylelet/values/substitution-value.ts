import { asciiLower } from '../../infra/ascii';
import { InternalError } from '../../infra/internal-error';

import {
  isComponentBlock, isFunctionBlock, serializeComponentValues,
  type ComponentValue, type TokenList, type ParserInput, type DeclarationValue, type OptionalDeclarationValue,
} from '../syntax/index';
import { ValueStage } from '../value-processing/index';

import type { GuaranteedInvalidValue, RawWholeValue, WholeValue } from './whole-value';

export type SubstitutionValue<Value, Context = unknown> = {
  type: 'substitution-value';
  declaration: DeclarationValue;
  resolve: (stage: ValueStage, context: Context) => WholeValue<Value, Context>;
  serialize: () => string;
};

export function createSubstitutionValue<Value, Context = unknown>(
  declaration: DeclarationValue,
  parseInput: (
    input: ParserInput,
  ) => RawWholeValue<Value, Context> | null,
): SubstitutionValue<Value, Context> {
  const value: SubstitutionValue<Value, Context> = {
    type: 'substitution-value',
    declaration,
    resolve: (stage, context) => resolveSubstitutionValue(
      value,
      parseInput,
      stage,
      context,
    ),
    serialize: () => serializeComponentValues(declaration.components.tokens),
  };

  return value;
}

export function containsSubstitutionFunction(
  list: TokenList<ComponentValue>,
): boolean {
  for (const component of list.tokens) {
    if (!isComponentBlock(component)) continue;

    if (isFunctionBlock(component)) {
      const name = asciiLower(component.name);

      if (
        name.startsWith('--') ||
        ARBITRARY_SUBSTITUTION_FUNCTION_NAMES.has(name)
      ) {
        return true;
      }
    }

    if (containsSubstitutionFunction(component.value)) {
      return true;
    }
  }

  return false;
}

export function isSubstitutionDeclaration(
  declaration: OptionalDeclarationValue | DeclarationValue,
): declaration is DeclarationValue {
  return containsSubstitutionFunction(declaration.components);
}

const ARBITRARY_SUBSTITUTION_FUNCTION_NAMES = new Set([
  'var',
  'attr',
  'env',
  'if',
  'inherit',
  'random-item',
]);

function resolveSubstitutionValue<Value, Context>(
  value: SubstitutionValue<Value, Context>,
  parseInput: (
    input: ParserInput,
  ) => RawWholeValue<Value, Context> | null,
  stage: ValueStage,
  context: Context,
): WholeValue<Value, Context> {
  if (stage < ValueStage.Computed) return value;

  const substituted = resolveSubstitutionFunction(
    value.declaration.components,
    context,
  );

  if ('type' in substituted) return substituted;

  const parsedResult = parseInput(substituted)?.resolve(stage, context) ?? null;

  if (parsedResult === null) {
    throw new InternalError('Handling substituted parse failure is not implemented');
  }

  return parsedResult;
}

function resolveSubstitutionFunction(
  _list: TokenList<ComponentValue>,
  _context: unknown,
): TokenList<ComponentValue> | GuaranteedInvalidValue {
  throw new InternalError('Arbitrary substitution is not implemented');
}
