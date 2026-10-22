import {
  createKeywordConsumer, adaptConsumer, withTrivia, parseAsComponentGrammar,
  type TokenCursor, type TryConsumerResult, type ParserInput,
} from '../syntax/index';
import type { ValueStage } from '../value-processing/index';

import type { Value } from './value';

/** A CSS-wide keyword awaiting property defaulting and inheritance. */
export class CssWideValue implements Value {
  /** The canonical keyword; its property-specific meaning is not resolved here. */
  value: CssWideKeyword;

  constructor(value: CssWideKeyword) {
    this.value = value;
  }

  static parse(input: ParserInput, context: unknown): CssWideValue | null {
    return parseAsComponentGrammar(input, cssWideGrammar, context);
  }

  static consume(this: void, c: TokenCursor): TryConsumerResult<CssWideValue> {
    return cssWideConsumer(c);
  }

  resolve(_stage: ValueStage, _context: unknown): CssWideValue {
    // TODO: The engine must apply property defaulting and inheritance.
    return this;
  }

  serialize(): string {
    return this.value;
  }
}

export type CssWideKeyword = (typeof CSS_WIDE_KEYWORDS)[number];

/*
 * CSS-wide keywords:
 * inherit | initial | unset | revert | revert-layer
 */

export const CSS_WIDE_KEYWORDS = [
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
] as const;

const cssWideConsumer = adaptConsumer(createKeywordConsumer(...CSS_WIDE_KEYWORDS), (keyword) => new CssWideValue(keyword));
const cssWideGrammar = withTrivia(cssWideConsumer);
