import { tryConsumeFunctionBlock, tryConsumeParensBlock } from '../parser/component-consumers';
import { type ComponentCursor, type TryComponentConsumerResult } from '../parser/component-cursor';
import { one, oneOf, withTrivia } from '../parser/component-grammar';
import { type FunctionBlock, type ParensBlock } from '../parser/component-value';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import { parseAnyValue, type AnyValue } from './any-value';

export type GeneralEnclosedValue = {
  type: 'general-enclosed';
  value: GeneralEnclosedBlock;
};

export type GeneralEnclosedBlock =
  | FunctionBlock<AnyValue | undefined>
  | ParensBlock<AnyValue | undefined>;

export function parseGeneralEnclosed(input: ParserInput): GeneralEnclosedValue | null {
  return parseAsComponentGrammar(input, withTrivia(tryConsumeGeneralEnclosed));
}

/*
 * <general-enclosed> =
 *   [ <function-token> <any-value>? ) ] |
 *   [ ( <any-value>? ) ]
 *
 * CSS Syntax represents these alternatives as function and parentheses blocks.
 */
export function tryConsumeGeneralEnclosed(
  c: ComponentCursor,
): TryComponentConsumerResult<GeneralEnclosedValue> {
  return consumeGeneralEnclosed(c);
}

const consumeGeneralEnclosed = oneOf(
  [
    one(tryConsumeFunctionBlock),
    one(tryConsumeParensBlock),
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
