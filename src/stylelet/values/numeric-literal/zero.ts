import { tryConsumeNumberToken } from '../../parser/component-consumers';
import { adaptConsumer, withTrivia } from '../../parser/component-grammar';
import { type TryComponentConsumer } from '../../parser/component-cursor';
import { parseAsComponentGrammar, type ParserInput } from '../../parser/syntax';
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
  return parseAsComponentGrammar(
    input,
    withTrivia(tryConsumeZero),
    context,
  );
}

export const tryConsumeZero: TryComponentConsumer<ZeroValue> = adaptConsumer(
  tryConsumeNumberToken,
  (token) => token.value === 0
    ? { type: 'number', value: 0 }
    : null,
);
