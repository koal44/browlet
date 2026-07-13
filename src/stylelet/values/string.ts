import type { ComponentCursor } from '../parser/component-cursor';
import {
  consumeComponentTrivia, isTokenKind, parseAsComponentGrammar,
  type ParserInput,
} from '../parser/syntax';
import { TokenKind } from '../parser/tokens';
import {
  ok, unwrapConsumeResultOrThrow,
  type TryComponentConsumerResult,
} from '../parser/component-try-consumer';

export type StringValue = {
  type: 'string';
  value: string;
};

export function parseString(
  input: ParserInput,
  context: unknown = undefined,
): StringValue | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(input, tryConsumeString, context),
    'string',
  );
}

export function tryConsumeString(c: ComponentCursor): TryComponentConsumerResult<StringValue> {
  const start = c.pos();

  consumeComponentTrivia(c);

  const comp = c.next();

  if (!isTokenKind(comp, TokenKind.String)) {
    c.restore(start);
    return null;
  }

  return ok({
    type: 'string',
    value: comp.value,
  });
}

export function serializeString(value: StringValue): string {
  return serializeCssString(value.value);
}

export function serializeCssString(value: string): string {
  let out = '"';

  for (const character of value) {
    const codePoint = character.codePointAt(0)!;

    if (codePoint === 0) {
      out += '\uFFFD';
    } else if (
      (codePoint >= 0x01 && codePoint <= 0x1f) ||
      codePoint === 0x7f
    ) {
      out += `\\${codePoint.toString(16)} `;
    } else if (character === '"' || character === '\\') {
      out += `\\${character}`;
    } else {
      out += character;
    }
  }

  return `${out}"`;
}
