import { asciiLower } from '../../infra/ascii';

import {
  consumeIdentToken, adaptConsumer, withTrivia, parseAsComponentGrammar, serializeCssIdentifier,
  type TokenCursor, type TryConsumer, type TryConsumerResult, type ParserInput,
} from '../syntax/index';
import type { ValueStage } from '../value-processing/index';

import type { Value } from './value';
import { CSS_WIDE_KEYWORDS } from './css-wide';

/** A case-sensitive identifier excluding CSS-wide and grammar-specific reserved words. */
// https://drafts.csswg.org/css-values-4/#custom-idents
export class CustomIdentValue implements Value {
  /** The decoded identifier with its original case. */
  value: string;

  constructor(value: string) {
    this.value = value;
  }

  /** Parse a complete identifier using the containing grammar's exclusions. */
  static parse(input: ParserInput, excluded: string[] = [], context: unknown): CustomIdentValue | null {
    const grammar = excluded.length === 0
      ? customIdentGrammar
      : withTrivia(CustomIdentValue.createConsumer(excluded));
    return parseAsComponentGrammar(input, grammar, context);
  }

  /** Consume a custom identifier with no additional grammar-specific exclusions. */
  static consume(this: void, c: TokenCursor): TryConsumerResult<CustomIdentValue> {
    return customIdentConsumer(c);
  }

  /** Prepare the containing grammar's case-insensitive excluded keywords once. */
  static createConsumer(excluded: string[] = []): TryConsumer<CustomIdentValue> {
    // <custom-ident> accepts identifiers except CSS-wide keywords, default,
    // and the containing grammar's exclusions, compared ASCII case-insensitively.
    const excludedKeywords = excluded.length === 0
      ? RESERVED_CUSTOM_IDENT_KEYWORDS : new Set(RESERVED_CUSTOM_IDENT_KEYWORDS);
    for (const keyword of excluded) excludedKeywords.add(asciiLower(keyword));

    return adaptConsumer(consumeIdentToken, ({ value: name }) =>
      excludedKeywords.has(asciiLower(name)) ? null : new CustomIdentValue(name));
  }

  /** Identifier text has no contextual resolution. */
  resolve(_stage: ValueStage, _context: unknown): CustomIdentValue {
    return this;
  }

  /** Escape the retained identifier without changing its case. */
  serialize(): string {
    return serializeCssIdentifier(this.value);
  }
}

const RESERVED_CUSTOM_IDENT_KEYWORDS = new Set<string>([...CSS_WIDE_KEYWORDS, 'default']);

const customIdentConsumer = CustomIdentValue.createConsumer();
const customIdentGrammar = withTrivia(customIdentConsumer);
