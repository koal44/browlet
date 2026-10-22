import {
  consumeNumberToken, adaptConsumer, withTrivia, createComponentParser,
  type TokenCursor, type TryConsumerResult, type ParserInput,
} from '../../syntax/index';

import { NumberLiteral } from './number';

/** A number literal accepted by the <zero> grammar. Arithmetic can produce ordinary numbers. */
// https://drafts.csswg.org/css-values-4/#zero-value
export class ZeroLiteral extends NumberLiteral {
  declare value: 0;

  constructor() {
    super(0);
  }

  /** Parse a complete zero literal, including decimal and exponent spellings. */
  static override parse(input: ParserInput, context: unknown): ZeroLiteral | null {
    return zeroParser(input, context);
  }

  /** Consume a number token whose magnitude is zero. */
  static override consume(this: void, c: TokenCursor): TryConsumerResult<ZeroLiteral> {
    return zeroConsumer(c);
  }
}

const zeroConsumer = adaptConsumer(consumeNumberToken, (token) => token.value === 0 ? new ZeroLiteral() : null);
const zeroParser = createComponentParser(withTrivia(zeroConsumer));
