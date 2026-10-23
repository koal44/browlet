import {
  isAnyValueComponent, isAnyValueContents, serializeComponentValues, parseListOfComponentValues,
  type TokenCursor, type TryConsumerResult, type ParserInput, type NonEmptyTokenList,
  type AnyValueComponent, type AnyValueContents,
} from '../syntax/index';
import type { ValueStage } from '../value-processing/index';

import type { Value } from './value';

/** A nonempty, opaque <any-value> sequence with its original component source spans. */
// https://drafts.csswg.org/css-syntax-3/#any-value
export class AnyValue implements Value {
  /** Validated components; an existing parsed list is retained without copying its arrays. */
  repr: NonEmptyTokenList<AnyValueComponent>;

  private constructor(value: NonEmptyTokenList<AnyValueComponent>) {
    this.repr = value;
  }

  /** Parse the entire input, retaining an existing component list when it matches. */
  static parse(input: ParserInput, context: unknown): AnyValue | null {
    const list = parseListOfComponentValues(input, context);
    return isAnyValueContents(list) && isNonEmpty(list) ? new AnyValue(list) : null;
  }

  /** Consume a nonempty run, leaving the first invalid component unread. */
  static consume(this: void, c: TokenCursor): TryConsumerResult<AnyValue> {
    if (!isAnyValueComponent(c.peek())) return null;

    // A complete validated input can be retained directly, just as in parse().
    if (c.pos() === 0 && isAnyValueContents(c.source) && isNonEmpty(c.source)) {
      c.consumeWhile(isAnyValueComponent);
      return new AnyValue(c.source);
    }

    const start = c.pos();
    c.consumeWhile(isAnyValueComponent);
    const list = c.source.slice(start, c.pos());
    return isAnyValueContents(list) && isNonEmpty(list) ? new AnyValue(list) : null;
  }

  /** Opaque components have no contextual interpretation to resolve. */
  resolve(_stage: ValueStage, _context: unknown): AnyValue {
    return this;
  }

  /** Serialize the retained components without interpreting their grammar. */
  serialize(): string {
    return serializeComponentValues(this.repr.tokens);
  }
}

function isNonEmpty(list: AnyValueContents): list is NonEmptyTokenList<AnyValueComponent> {
  return list.tokens.length > 0;
}
