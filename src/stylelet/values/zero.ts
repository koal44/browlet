import { tryConsumeNumberToken } from '../parser/component-consumers';
import { withTrivia } from '../parser/component-grammar';
import { type TryComponentConsumer } from '../parser/component-cursor';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import type { NumberLiteral } from './numeric-literal/number';

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

export const tryConsumeZero: TryComponentConsumer<ZeroValue> = (c) => {
  const start = c.pos();
  const token = tryConsumeNumberToken(c);

  if (token === null) return null;

  if (token.value !== 0) {
    c.restore(start);
    return null;
  }

  return {
    type: 'number',
    value: 0,
  };
};
