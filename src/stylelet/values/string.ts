import { consumeStringToken } from '../syntax/component-consumers';
import { serializeCssString } from '../syntax/component-value';
import {
  type TokenCursor, type TryConsumerResult,
} from '../syntax/token-cursor';
import { adaptConsumer, withTrivia } from '../syntax/component-grammar';
import { createComponentParser, type ParserInput } from '../syntax/parser';
import type { ValueDefinition } from '../value-processing/definition';

/*
 * <string> = <string-token>
 */

export type StringValue = {
  type: 'string';
  value: string;
};

export const stringDef: ValueDefinition<StringValue> = {
  consume: consumeString,
  resolve: (value) => value,
  serialize: serializeString,
};

export function parseString(
  input: ParserInput,
  context: unknown = undefined,
): StringValue | null {
  return stringParser(input, context);
}

export function consumeString(
  c: TokenCursor,
): TryConsumerResult<StringValue> {
  return stringConsumer(c);
}

export function serializeString(value: StringValue): string {
  return serializeCssString(value.value);
}

// <string> = <string-token>
const stringConsumer = adaptConsumer(
  consumeStringToken,
  (token): StringValue => ({ type: 'string', value: token.value }),
);

const stringParser = createComponentParser(withTrivia(stringConsumer));
