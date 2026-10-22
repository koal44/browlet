import {
  consumeIdentToken, serializeCssIdentifier, adaptConsumer, withTrivia, parseAsComponentGrammar,
  type TokenCursor, type TryConsumerResult, type ParserInput,
} from '../syntax/index';
import type { ValueStage } from '../value-processing/index';

import type { Value } from './value';

/** A parsed CSS <ident>. */
// https://drafts.csswg.org/css-values-4/#typedef-ident
export class IdentValue implements Value {
  /** The decoded identifier, retaining its case. */
  value: string;

  constructor(value: string) {
    this.value = value;
  }

  /** Parse a complete <ident>. */
  static parse(input: ParserInput, context: unknown): IdentValue | null {
    return parseAsComponentGrammar(input, identGrammar, context);
  }

  /** Consume one <ident>. */
  static consume(this: void, c: TokenCursor): TryConsumerResult<IdentValue> {
    return identConsumer(c);
  }

  /** This grammar has no contextual resolution. */
  resolve(_stage: ValueStage, _context: unknown): IdentValue {
    return this;
  }

  /** Escape the retained text using CSS identifier syntax. */
  serialize(): string {
    return serializeCssIdentifier(this.value);
  }
}

const identConsumer = adaptConsumer(consumeIdentToken, (token) => new IdentValue(token.value));

const identGrammar = withTrivia(identConsumer);
