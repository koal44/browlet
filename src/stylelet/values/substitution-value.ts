import { asciiLower } from '../../infra/ascii';
import { InternalError } from '../../infra/internal-error';

import {
  isComponentBlock, isFunctionBlock,
  type ComponentValue, type TokenList, type DeclarationValue, type OptionalDeclarationValue,
} from '../syntax/index';

import type { GuaranteedInvalidValue } from './whole-value';

export type SubstitutionValue = {
  type: 'substitution-value';
  declaration: DeclarationValue;
};

/** Replace arbitrary substitutions before the consuming property reparses their result. */
export function resolveSubstitutionFunction(
  _list: TokenList<ComponentValue>,
  _context: unknown,
): TokenList<ComponentValue> | GuaranteedInvalidValue {
  throw new InternalError('Arbitrary substitution is not implemented');
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
