import { type ComponentCursor, type TryComponentConsumerResult } from '../parser/component-cursor';
import { adaptConsumer, withTrivia } from '../parser/component-grammar';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import { tryConsumeCustomIdent } from './custom-ident';
import { serializeCssIdentifier } from '../parser/component-value';

export type DashedIdentValue = {
  type: 'dashed-ident';
  value: `--${string}`;
};

export function parseDashedIdent(
  input: ParserInput,
  context: unknown = undefined,
): DashedIdentValue | null {
  return parseAsComponentGrammar(
    input,
    withTrivia(tryConsumeDashedIdent),
    context,
  );
}

export function tryConsumeDashedIdent(
  c: ComponentCursor,
): TryComponentConsumerResult<DashedIdentValue> {
  return consumeDashedIdent(c);
}

const consumeDashedIdent = adaptConsumer(tryConsumeCustomIdent, ({ value }) =>
  isDashedIdentifier(value)
    ? { type: 'dashed-ident' as const, value }
    : null,
);

export function serializeDashedIdent(value: DashedIdentValue): string {
  return serializeCssIdentifier(value.value);
}

function isDashedIdentifier(value: string): value is `--${string}` {
  return value.startsWith('--');
}
