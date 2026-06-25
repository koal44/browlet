import type { ComponentCursor } from '../parser/component-cursor';
import { consumeComponentTrivia, isTokenKind } from '../parser/syntax';
import { TokenKind } from '../parser/tokens';

export type StringValue = {
  type: 'string';
  value: string;
};

export function tryParseString(c: ComponentCursor): StringValue | null {
  const start = c.pos();

  consumeComponentTrivia(c);

  const comp = c.next();

  if (!isTokenKind(comp, TokenKind.String)) {
    c.restore(start);
    return null;
  }

  return {
    type: 'string',
    value: comp.value,
  };
}

export function serializeString(value: StringValue): string {
  return serializeCssString(value.value);
}

function serializeCssString(value: string): string {
  let out = '"';

  for (let i = 0; i < value.length; i++) {
    const ch = value[i];

    switch (ch) {
      case '"':
      case '\\':
        out += `\\${ch}`;
        break;

      case '\n':
        out += '\\a ';
        break;

      case '\r':
        out += '\\d ';
        break;

      case '\f':
        out += '\\c ';
        break;

      case '\0':
        out += '\uFFFD';
        break;

      default:
        out += ch;
        break;
    }
  }

  return `${out}"`;
}
