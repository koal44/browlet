import { tryConsumeIdentToken } from '../parser/component-consumers';
import { type ComponentCursor, type TryComponentConsumerResult } from '../parser/component-cursor';
import { withTrivia } from '../parser/component-grammar';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';

export type IdentValue = {
  type: 'ident';
  value: string;
};

export function parseIdent(
  input: ParserInput,
  context: unknown = undefined,
): IdentValue | null {
  return parseAsComponentGrammar(
    input,
    withTrivia(tryConsumeIdent),
    context,
  );
}

export function tryConsumeIdent(
  c: ComponentCursor,
): TryComponentConsumerResult<IdentValue> {
  const token = tryConsumeIdentToken(c);

  if (token === null) return null;

  return {
    type: 'ident',
    value: token.value,
  };
}

export function serializeIdent(value: IdentValue): string {
  return serializeIdentifier(value.value);
}

export function serializeIdentifier(value: string): string {
  const characters = [...value];
  let result = '';

  for (let index = 0; index < characters.length; index++) {
    const character = characters[index]!;
    const codePoint = character.codePointAt(0)!;

    if (codePoint === 0) {
      result += '\uFFFD';
      continue;
    }

    if (
      (codePoint >= 0x01 && codePoint <= 0x1f) ||
      codePoint === 0x7f ||
      (index === 0 && isAsciiDigit(codePoint)) ||
      (
        index === 1 &&
        isAsciiDigit(codePoint) &&
        characters[0] === '-'
      )
    ) {
      result += `\\${codePoint.toString(16)} `;
      continue;
    }

    if (index === 0 && character === '-' && characters.length === 1) {
      result += '\\-';
      continue;
    }

    if (
      codePoint >= 0x80 ||
      character === '-' ||
      character === '_' ||
      isAsciiDigit(codePoint) ||
      isAsciiLetter(codePoint)
    ) {
      result += character;
      continue;
    }

    result += `\\${character}`;
  }

  return result;
}

function isAsciiDigit(codePoint: number): boolean {
  return codePoint >= 0x30 && codePoint <= 0x39;
}

function isAsciiLetter(codePoint: number): boolean {
  return (
    (codePoint >= 0x41 && codePoint <= 0x5a) ||
    (codePoint >= 0x61 && codePoint <= 0x7a)
  );
}
