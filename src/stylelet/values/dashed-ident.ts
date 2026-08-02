import type { ComponentCursor } from '../parser/component-cursor';
import { withTrivia } from '../parser/component-grammar';
import {
  isBad, ok, unwrapConsumeResultOrThrow,
  type TryComponentConsumerResult,
} from '../parser/component-try-consumer';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import { tryConsumeCustomIdent } from './custom-ident';
import { serializeIdentifier } from './ident';

export type DashedIdentValue = {
  type: 'dashed-ident';
  value: `--${string}`;
};

export function parseDashedIdent(
  input: ParserInput,
  context: unknown = undefined,
): DashedIdentValue | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withTrivia(tryConsumeDashedIdent),
      context,
    ),
    'dashed ident',
  );
}

export function tryConsumeDashedIdent(
  c: ComponentCursor,
): TryComponentConsumerResult<DashedIdentValue> {
  const start = c.pos();
  const customIdent = tryConsumeCustomIdent(c);

  if (customIdent === null || isBad(customIdent)) {
    return customIdent;
  }

  const value = customIdent.value.value;

  if (!isDashedIdentifier(value)) {
    c.restore(start);
    return null;
  }

  return ok({
    type: 'dashed-ident',
    value,
  });
}

export function serializeDashedIdent(value: DashedIdentValue): string {
  return serializeIdentifier(value.value);
}

function isDashedIdentifier(value: string): value is `--${string}` {
  return value.startsWith('--');
}
