import { tryConsumeNumberToken } from '../parser/component-consumers';
import { withComponentTrivia } from '../parser/component-grammar';
import {
  isBad, ok, unwrapConsumeResultOrThrow,
  type TryComponentConsumer,
} from '../parser/component-try-consumer';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import type { NumberValue } from './number';

/*
 * <zero> = <number-token with a value of 0>
 */

export type ZeroValue = NumberValue & {
  value: 0;
};

export function parseZero(
  input: ParserInput,
  context: unknown = undefined,
): ZeroValue | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withComponentTrivia(tryConsumeZero),
      context,
    ),
    'zero',
  );
}

export const tryConsumeZero: TryComponentConsumer<ZeroValue> = (c) => {
  const start = c.pos();
  const token = tryConsumeNumberToken(c);

  if (token === null || isBad(token)) {
    return token;
  }

  if (token.value.value !== 0) {
    c.restore(start);
    return null;
  }

  return ok({
    type: 'number',
    value: 0,
  });
};
