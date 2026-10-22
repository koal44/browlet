import { asciiLower } from '../../infra/ascii';
import { InternalError } from '../../infra/internal-error';

import {
  isComponentBlock, isFunctionBlock,
  type ComponentValue, type TokenList,
} from '../syntax/index';

import type { GuaranteedInvalidValue } from './guaranteed-invalid';
import type { OptionalDeclarationValue } from './declaration-value';

/** Replace arbitrary substitutions before the consuming property reparses their result. */
export class SubstitutionValue {
  /** Unsubstituted declaration components, including their source spans. */
  value: OptionalDeclarationValue;

  constructor(value: OptionalDeclarationValue) {
    this.value = value;
  }

  /** Whether a component list contains an arbitrary substitution, including inside blocks. */
  static containsFunction(list: TokenList<ComponentValue>): boolean {
    for (const component of list.tokens) {
      if (!isComponentBlock(component)) continue;

      if (isFunctionBlock(component)) {
        const name = asciiLower(component.name);
        if (name.startsWith('--') || ARBITRARY_SUBSTITUTION_FUNCTION_NAMES.has(name)) return true;
      }

      if (SubstitutionValue.containsFunction(component.value)) return true;
    }

    return false;
  }

  /** Substitute before the containing whole value reparses with its own grammar. */
  substitute(_context: unknown): TokenList<ComponentValue> | GuaranteedInvalidValue {
    throw new InternalError('Arbitrary substitution is not implemented');
  }

  /** Serialize the retained declaration without performing substitutions. */
  serialize(): string {
    return this.value.serialize();
  }
}

const ARBITRARY_SUBSTITUTION_FUNCTION_NAMES = new Set([
  'var',
  'attr',
  'env',
  'if',
  'inherit',
  'random-item',
]);
