import { tryConsumeStringToken } from '../parser/component-consumers';
import { serializeCssString } from '../parser/component-value';
import { type ComponentCursor, type TryComponentConsumerResult } from '../parser/component-cursor';
import { adaptConsumer, withTrivia } from '../parser/component-grammar';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';

export type StringValue = {
  type: 'string';
  value: string;
};

export function parseString(
  input: ParserInput,
  context: unknown = undefined,
): StringValue | null {
  return parseAsComponentGrammar(input, withTrivia(tryConsumeString), context);
}

export function tryConsumeString(c: ComponentCursor): TryComponentConsumerResult<StringValue> {
  return consumeString(c);
}

const consumeString = adaptConsumer(
  tryConsumeStringToken,
  (token): StringValue => ({ type: 'string', value: token.value }),
);

export function serializeString(value: StringValue): string {
  return serializeCssString(value.value);
}
