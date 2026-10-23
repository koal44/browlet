import {
  createKeywordConsumer, adaptConsumer, withTrivia, parseAsComponentGrammar,
  type TokenCursor, type TryConsumerResult, type ParserInput,
} from '../syntax/index';
import type { ValueStage } from '../value-processing/index';

import type { Value } from './value';

/** The auto keyword; its meaning is determined by the property that uses it. */
export class AutoValue implements Value {
  /** The retained keyword. */
  repr = 'auto' as const;

  /** Parse a complete auto keyword. */
  static parse(input: ParserInput, context: unknown): AutoValue | null {
    return parseAsComponentGrammar(input, autoGrammar, context);
  }

  /** Consume one auto keyword. */
  static consume(this: void, c: TokenCursor): TryConsumerResult<AutoValue> {
    return autoConsumer(c);
  }

  /** Property-specific auto handling remains with the containing value or property. */
  resolve(_stage: ValueStage, _context: unknown): AutoValue {
    return this;
  }

  /** Serialize the retained keyword. */
  serialize(): string {
    return this.repr;
  }

  /** The auto keyword combines discretely unless its property specifies another rule. */
  interpolate(): null {
    return null;
  }

  /** Addition also selects a value discretely. */
  add(): null {
    return null;
  }

  /** Accumulation follows addition. */
  accumulate(): null {
    return null;
  }
}

// auto
const autoConsumer = adaptConsumer(
  createKeywordConsumer('auto'),
  () => new AutoValue(),
);

const autoGrammar = withTrivia(autoConsumer);
