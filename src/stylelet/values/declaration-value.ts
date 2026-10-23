import {
  isDelimToken, isTokenKind, isAnyValueContents, serializeComponentValues, parseListOfComponentValues, TokenKind,
  type TokenCursor, type TryConsumerResult, type ComponentValue, type ParserInput,
  type TokenList, type NonEmptyTokenList, type StaticToken, type AnyValueComponent,
} from '../syntax/index';
import type { ValueStage } from '../value-processing/index';

import type { Value } from './value';
import { AnyValue } from './any-value';

/** Opaque declaration components, with top-level semicolons and bangs excluded. */
// https://drafts.csswg.org/css-syntax-3/#any-value
export class DeclarationValue implements Value {
  /** Validated components and source spans, retained without copying an existing list. */
  repr: NonEmptyTokenList<DeclarationComponent>;

  private constructor(value: NonEmptyTokenList<DeclarationComponent>) {
    this.repr = value;
  }

  /** Parse a complete nonempty declaration, retaining an existing component list. */
  static parse(input: ParserInput, context: unknown): DeclarationValue | null {
    const list = parseListOfComponentValues(input, context);
    return isNonEmptyDeclarationValueContents(list) ? new DeclarationValue(list) : null;
  }

  /** Consume a nonempty declaration run, restoring the cursor if its restrictions fail. */
  static consume(this: void, c: TokenCursor): TryConsumerResult<DeclarationValue> {
    const list = consumeDeclarationValueContents(c);
    return list === null ? null : new DeclarationValue(list);
  }

  /** Opaque components have no contextual interpretation to resolve. */
  resolve(_stage: ValueStage, _context: unknown): DeclarationValue {
    return this;
  }

  /** Serialize the retained components without interpreting the property's grammar. */
  serialize(): string {
    return serializeComponentValues(this.repr.tokens);
  }
}

/** Opaque <declaration-value>? components, including a valid empty sequence. */
// https://drafts.csswg.org/css-syntax-3/#any-value
export class OptionalDeclarationValue implements Value {
  /** Validated components and source spans, retained without copying an existing list. */
  repr: TokenList<DeclarationComponent>;

  private constructor(value: TokenList<DeclarationComponent>) {
    this.repr = value;
  }

  /** Parse a complete declaration, also accepting an empty component list. */
  static parse(this: void, input: ParserInput, context: unknown): OptionalDeclarationValue | null {
    const list = parseListOfComponentValues(input, context);
    return isDeclarationValueContents(list) ? new OptionalDeclarationValue(list) : null;
  }

  /** Accept an omitted value at EOF; invalid components still fail without advancing. */
  static consume(this: void, c: TokenCursor): TryConsumerResult<OptionalDeclarationValue> {
    const list = c.eof()
      ? c.source.slice(c.pos()) as TokenList<DeclarationComponent>
      : consumeDeclarationValueContents(c);
    return list === null ? null : new OptionalDeclarationValue(list);
  }

  /** Opaque components have no contextual interpretation to resolve. */
  resolve(_stage: ValueStage, _context: unknown): OptionalDeclarationValue {
    return this;
  }

  /** Serialize the retained components without interpreting the property's grammar. */
  serialize(): string {
    return serializeComponentValues(this.repr.tokens);
  }
}

export type DeclarationComponent = Exclude<
  AnyValueComponent,
  StaticToken<TokenKind.Semicolon>
>;

/*
 * <declaration-value> matches any sequence of one or more tokens, excluding:
 *   <bad-string-token>, <bad-url-token>, unmatched closing tokens,
 *   and top-level <semicolon-token> or <delim-token> with value "!".
 * <any-value> has the same restrictions except for the top-level ';' and '!'.
 */

function consumeDeclarationValueContents(c: TokenCursor): NonEmptyTokenList<DeclarationComponent> | null {
  const start = c.pos();
  const result = AnyValue.consume(c);

  if (result === null) return null;
  if (!hasOnlyDeclarationComponents(result.repr)) {
    c.restore(start);
    return null;
  }

  return result.repr;
}

function isDeclarationValueContents(
  list: TokenList<ComponentValue>,
): list is TokenList<DeclarationComponent> {
  return isAnyValueContents(list) && hasOnlyDeclarationComponents(list);
}

/** Check the additional top-level restrictions on already validated <any-value> contents. */
function hasOnlyDeclarationComponents(list: NonEmptyTokenList<AnyValueComponent>): list is NonEmptyTokenList<DeclarationComponent>;
function hasOnlyDeclarationComponents(list: TokenList<AnyValueComponent>): list is TokenList<DeclarationComponent>;
function hasOnlyDeclarationComponents(
  list: TokenList<AnyValueComponent>,
): list is TokenList<DeclarationComponent> {
  for (const component of list.tokens) {
    if (
      isTokenKind(component, TokenKind.Semicolon) ||
      isDelimToken(component, '!')
    ) {
      return false;
    }
  }

  return true;
}

function isNonEmptyDeclarationValueContents(
  list: TokenList<ComponentValue>,
): list is NonEmptyTokenList<DeclarationComponent> {
  return list.tokens.length > 0 && isDeclarationValueContents(list);
}
