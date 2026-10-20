import {
  consumeNumberToken, adaptConsumer, withTrivia, createComponentParser,
  type TokenCursor, type TryConsumer, type TryConsumerResult, type ParserInput,
} from '../../syntax/index';

import type { NumberLiteral } from './number';

/*
 * <zero> = <number-token with a value of 0>
 */

export type ZeroValue = NumberLiteral & {
  value: 0;
};

export function parseZero(
  input: ParserInput,
  context: unknown,
): ZeroValue | null {
  return zeroParser(input, context);
}

export function consumeZero(
  c: TokenCursor,
): TryConsumerResult<ZeroValue> {
  return zeroConsumer(c);
}

// <zero> = <number-token with a value of 0>
const zeroConsumer: TryConsumer<ZeroValue> = adaptConsumer(
  consumeNumberToken,
  (token) => token.value === 0
    ? { type: 'number', value: 0 }
    : null,
);

const zeroParser = createComponentParser(withTrivia(zeroConsumer));
