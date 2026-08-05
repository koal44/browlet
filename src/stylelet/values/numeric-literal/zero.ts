import { consumeNumberToken } from '../../syntax/component-consumers';
import { adaptConsumer, withTrivia } from '../../syntax/component-grammar';
import {
  type ComponentCursor, type TryComponentConsumer, type TryComponentConsumerResult,
} from '../../syntax/component-cursor';
import { createComponentParser, type ParserInput } from '../../syntax/parser';
import type { NumberLiteral } from './number';

/*
 * <zero> = <number-token with a value of 0>
 */

export type ZeroValue = NumberLiteral & {
  value: 0;
};

export function parseZero(
  input: ParserInput,
  context: unknown = undefined,
): ZeroValue | null {
  return zeroParser(input, context);
}

export function consumeZero(
  c: ComponentCursor,
): TryComponentConsumerResult<ZeroValue> {
  return zeroConsumer(c);
}

// <zero> = <number-token with a value of 0>
const zeroConsumer: TryComponentConsumer<ZeroValue> = adaptConsumer(
  consumeNumberToken,
  (token) => token.value === 0
    ? { type: 'number', value: 0 }
    : null,
);

const zeroParser = createComponentParser(withTrivia(zeroConsumer));
