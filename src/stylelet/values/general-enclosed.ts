import {
  consumeFunctionBlock, consumeParensBlock, one, oneOf, withTrivia,
  parseAsComponentGrammar, serializeCssIdentifier, TokenKind,
  type TokenCursor, type TryConsumerResult, type FunctionBlock, type ParensBlock, type ParserInput,
} from '../syntax/index';
import type { ValueStage } from '../value-processing/index';

import type { Value } from './value';
import { AnyValue } from './any-value';

/** An opaque function or parentheses block reserved for an unknown condition grammar. */
// https://drafts.csswg.org/mediaqueries-4/#typedef-general-enclosed
export class GeneralEnclosedValue<Representation extends GeneralEnclosedBlock = GeneralEnclosedBlock> implements Value {
  /** The enclosing block and its optional opaque contents. */
  value: Representation;

  constructor(value: Representation) {
    this.value = value;
  }

  /** Parse a complete opaque condition block. */
  static parse(input: ParserInput, context: unknown): GeneralEnclosedValue | null {
    return parseAsComponentGrammar(input, generalEnclosedGrammar, context);
  }

  /** Consume one opaque condition block. */
  static consume(this: void, c: TokenCursor): TryConsumerResult<GeneralEnclosedValue> {
    return generalEnclosedConsumer(c);
  }

  /** Unknown grammar has no value resolution; its truth is decided by the enclosing condition. */
  resolve(_stage: ValueStage, _context: unknown): GeneralEnclosedValue<Representation> {
    return this;
  }

  /** Serialize the retained contents without interpreting their grammar. */
  // SPEC_GAP(media-general-enclosed-serialization): CSSOM has no serializer for
  // this newer production. Retain token-based formatting, as WebKit does;
  // Chromium/Firefox preserve exact source text. See cssom/ROADMAP.md.
  serialize(): string {
    const block = this.value;
    const contents = block.value === undefined ? '' : block.value.serialize();
    return block.type === TokenKind.FunctionBlock
      ? `${serializeCssIdentifier(block.name)}(${contents})`
      : `(${contents})`;
  }
}

type GeneralEnclosedBlock =
  | FunctionBlock<AnyValue | undefined>
  | ParensBlock<AnyValue | undefined>;

/*
 * <general-enclosed> =
 *   [ <function-token> <any-value>? ) ] |
 *   [ ( <any-value>? ) ]
 */

// CSS Syntax represents the alternatives as function and parentheses blocks.
const generalEnclosedConsumer = oneOf(
  [
    one(consumeFunctionBlock),
    one(consumeParensBlock),
  ],
  ([component], context): GeneralEnclosedValue | null => {
    const contents = component.value.tokens.length === 0
      ? undefined
      : AnyValue.parse(component.value, context);

    return contents === null
      ? null
      : new GeneralEnclosedValue({ ...component, value: contents });
  },
);

const generalEnclosedGrammar = withTrivia(generalEnclosedConsumer);
