import { tryConsumeStringToken } from '../parser/component-consumers';
import { type ComponentCursor, type TryComponentConsumerResult } from '../parser/component-cursor';
import { adaptConsumer, withTrivia } from '../parser/component-grammar';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';

export type StringValue = {
  type: 'string';
  value: string;
};

export function parseString(
  input: ParserInput,
  context: unknown = undefined,
): StringValue | null {
  return parseAsComponentGrammar(input, withTrivia(tryConsumeString), context);
}

export function tryConsumeString(c: ComponentCursor): TryComponentConsumerResult<StringValue> {
  return consumeString(c);
}

const consumeString = adaptConsumer(
  tryConsumeStringToken,
  (token): StringValue => ({ type: 'string', value: token.value }),
);

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
