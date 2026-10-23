import {
  consumeIdentToken, adaptConsumer, withTrivia, parseAsComponentGrammar, serializeCssIdentifier,
  type TokenCursor, type TryConsumerResult, type ParserInput,
} from '../syntax/index';
import type { ValueStage } from '../value-processing/index';

import type { Value } from './value';

/** An author-defined identifier in the reserved double-dash namespace. */
// https://drafts.csswg.org/css-values-4/#dashed-idents
export class DashedIdentValue implements Value {
  /** The decoded identifier, including its leading dashes. */
  repr: `--${string}`;

  constructor(value: `--${string}`) {
    this.repr = value;
  }

  /** Parse a complete dashed identifier. */
  static parse(input: ParserInput, context: unknown): DashedIdentValue | null {
    return parseAsComponentGrammar(input, dashedIdentGrammar, context);
  }

  /** Consume one dashed identifier. */
  static consume(this: void, c: TokenCursor): TryConsumerResult<DashedIdentValue> {
    return dashedIdentConsumer(c);
  }

  /** Identifier text has no contextual resolution. */
  resolve(_stage: ValueStage, _context: unknown): DashedIdentValue {
    return this;
  }

  /** Escape the retained identifier without changing its case. */
  serialize(): string {
    return serializeCssIdentifier(this.repr);
  }
}

/*
 * <dashed-ident> is a <custom-ident> that starts with two dashes.
 */
const dashedIdentConsumer = adaptConsumer(
  consumeIdentToken,
  ({ value: name }) => isDashedIdentifier(name)
    ? new DashedIdentValue(name)
    : null,
);

const dashedIdentGrammar = withTrivia(dashedIdentConsumer);

function isDashedIdentifier(value: string): value is `--${string}` {
  return value.startsWith('--');
}
