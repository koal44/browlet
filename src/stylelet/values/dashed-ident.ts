import {
  type TokenCursor, type TryConsumerResult,
} from '../syntax/token-cursor';
import { adaptConsumer, withTrivia } from '../syntax/component-grammar';
import { createComponentParser, type ParserInput } from '../syntax/parser';
import { consumeCustomIdent } from './custom-ident';
import { serializeCssIdentifier } from '../syntax/component-value';

/*
 * <dashed-ident> = a <custom-ident> that starts with two dashes
 */

export type DashedIdentValue = {
  type: 'dashed-ident';
  value: `--${string}`;
};

export function parseDashedIdent(
  input: ParserInput,
  context: unknown = undefined,
): DashedIdentValue | null {
  return dashedIdentParser(input, context);
}

export function consumeDashedIdent(
  c: TokenCursor,
): TryConsumerResult<DashedIdentValue> {
  return dashedIdentConsumer(c);
}

export function serializeDashedIdent(value: DashedIdentValue): string {
  return serializeCssIdentifier(value.value);
}

function isDashedIdentifier(value: string): value is `--${string}` {
  return value.startsWith('--');
}

// <dashed-ident> = a <custom-ident> that starts with two dashes
const dashedIdentConsumer = adaptConsumer(
  consumeCustomIdent,
  ({ value }) => isDashedIdentifier(value)
    ? { type: 'dashed-ident' as const, value }
    : null,
);

const dashedIdentParser = createComponentParser(withTrivia(dashedIdentConsumer));
