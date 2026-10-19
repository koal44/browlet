import {
  consumeFunctionBlock, consumeParensBlock, one, oneOf, withTrivia, serializeComponentValues,
  createComponentParser, parseAnyValue,
  type TokenCursor, type TryConsumerResult, type FunctionBlock, type ParensBlock, type ParserInput,
  type AnyValue,
} from '../syntax/index';

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
  c: TokenCursor,
): TryConsumerResult<GeneralEnclosedValue> {
  return generalEnclosedConsumer(c);
}

export function resolveGeneralEnclosed(
  value: GeneralEnclosedValue,
): GeneralEnclosedValue {
  return value;
}

export function serializeGeneralEnclosed(value: GeneralEnclosedValue): string {
  const block = value.value;
  return serializeComponentValues([{
    ...block,
    value: block.value?.components ?? [],
  }]);
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
