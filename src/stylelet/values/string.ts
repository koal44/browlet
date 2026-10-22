import {
  consumeStringToken, serializeCssString, adaptConsumer, withTrivia, parseAsComponentGrammar,
  type TokenCursor, type TryConsumerResult, type ParserInput,
} from '../syntax/index';
import type { ValueStage } from '../value-processing/index';

import type { Value } from './value';

/** A parsed CSS <string>. */
// https://drafts.csswg.org/css-values-4/#strings
export class StringValue implements Value {
  /** The decoded string, retaining its case. */
  value: string;

  constructor(value: string) {
    this.value = value;
  }

  /** Parse a complete <string>. */
  static parse(input: ParserInput, context: unknown): StringValue | null {
    return parseAsComponentGrammar(input, stringGrammar, context);
  }

  /** Consume one <string>. */
  static consume(this: void, c: TokenCursor): TryConsumerResult<StringValue> {
    return stringConsumer(c);
  }

  /** This grammar has no contextual resolution. */
  resolve(_stage: ValueStage, _context: unknown): StringValue {
    return this;
  }

  /** Escape the retained text using CSS string syntax. */
  serialize(): string {
    return serializeCssString(this.value);
  }
}

const stringConsumer = adaptConsumer(consumeStringToken, (token) => new StringValue(token.value));
const stringGrammar = withTrivia(stringConsumer);
