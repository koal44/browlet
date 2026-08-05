import { consumeFunctionBlock, consumeParensBlock } from '../syntax/component-consumers';
import { one, oneOf, withTrivia } from '../syntax/component-grammar';
import { type ComponentCursor, type TryComponentConsumerResult } from '../syntax/component-cursor';
import { type FunctionBlock, type ParensBlock } from '../syntax/component-value';
import { createComponentParser, type ParserInput } from '../syntax/parser';
import { parseAnyValue, type AnyValue } from '../syntax/any-value';

/*
 * <general-enclosed> =
 *   [ <function-token> <any-value>? ) ] |
 *   [ ( <any-value>? ) ]
 */

export type GeneralEnclosedValue = {
  type: 'general-enclosed';
  value: GeneralEnclosedBlock;
};

export type GeneralEnclosedBlock =
  | FunctionBlock<AnyValue | undefined>
  | ParensBlock<AnyValue | undefined>;

export function parseGeneralEnclosed(input: ParserInput): GeneralEnclosedValue | null {
  return generalEnclosedParser(input);
}

export function consumeGeneralEnclosed(
  c: ComponentCursor,
): TryComponentConsumerResult<GeneralEnclosedValue> {
  return generalEnclosedConsumer(c);
}

// =============================================================================
// Syntax
// =============================================================================

// CSS Syntax represents the alternatives as function and parentheses blocks.
const generalEnclosedConsumer = oneOf(
  [
    one(consumeFunctionBlock),
    one(consumeParensBlock),
  ],
  ([component]): GeneralEnclosedValue | null => {
    const value = component.value.length === 0
      ? undefined
      : parseAnyValue(component.value);

    return value === null
      ? null
      : {
        type: 'general-enclosed',
        value: { ...component, value },
      };
  },
);

const generalEnclosedParser = createComponentParser(withTrivia(generalEnclosedConsumer));
