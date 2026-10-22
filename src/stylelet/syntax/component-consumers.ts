import { asciiLower } from '../../infra/ascii';

import { type TokenCursor, type TryConsumer, type TryConsumerResult } from './token-cursor';
import { adaptConsumer, withTrivia } from './component-grammar';
import {
  isBraceBlock, isBracketBlock, isDelimToken, isFunctionBlock, isIdentToken, isParensBlock,
  isTokenKind, isWhitespaceToken, isAnyValueContents, isAnyValueFunctionBlock,
  type BraceBlock, type BracketBlock, type ComponentValue,
  type FunctionBlock, type ParensBlock, type AnyValueFunctionBlock,
} from './component-value';
import { parseAsComponentGrammar } from './parser';
import type {
  DimensionToken, HashToken, IdentToken, NumberToken, PercentageToken,
  StringToken, UrlToken,
} from './tokens';
import { HashTokenFlag, NumberTokenFlag, TokenKind } from './tokens';
import { TokenList } from './token-list';

// =============================================================================
// Consumer creators
// =============================================================================

/** Match an identifier case-insensitively and return the supplied keyword spelling. */
export function createKeywordConsumer<const Keywords extends [string, ...string[]]>(
  ...keywords: Keywords
): TryConsumer<Keywords[number]> {
  const normalized = keywords.map(
    (keyword) => [asciiLower(keyword), keyword] as const,
  );

  return adaptConsumer(consumeIdentToken, (ident) => {
    const value = asciiLower(ident.value);

    for (const [text, keyword] of normalized) {
      if (value === text) return keyword;
    }

    return null;
  });
}

export type FunctionalNotationConsumerOptions<Context, ArgumentContext> = {
  contextForArguments: (context: Context) => ArgumentContext;
};

// TODO: Fold free-form production handling into functional-notation argument
// parsing, including its strictness and additional boundaries. This should be
// the sole public entry point for that machinery, without caller-applied wrappers.

// <function-token matching name> <argument-value> )
export function createFunctionalNotationConsumer<ArgumentValue, Value, Context = unknown>(name: string, consumeArgumentValue: TryConsumer<ArgumentValue, Context>, projectValue: (value: ArgumentValue, context: Context) => TryConsumerResult<Value>): TryConsumer<Value, Context>;
export function createFunctionalNotationConsumer<ArgumentValue, Value, Context, ArgumentContext>(name: string, consumeArgumentValue: TryConsumer<ArgumentValue, ArgumentContext>, projectValue: (value: ArgumentValue, context: Context) => TryConsumerResult<Value>, options: FunctionalNotationConsumerOptions<Context, ArgumentContext>): TryConsumer<Value, Context>;
export function createFunctionalNotationConsumer<ArgumentValue, Value, Context, ArgumentContext = Context>(
  name: string,
  consumeArgumentValue: TryConsumer<ArgumentValue, Context> | TryConsumer<ArgumentValue, ArgumentContext>,
  projectValue: (
    value: ArgumentValue,
    context: Context,
  ) => TryConsumerResult<Value>,
  options?: FunctionalNotationConsumerOptions<Context, ArgumentContext>,
): TryConsumer<Value, Context> {
  const normalizedName = asciiLower(name);

  return adaptConsumer(consumeFunctionBlock, (fn, context: Context) => {
    if (asciiLower(fn.name) !== normalizedName) return null;
    if (!isAnyValueContents(fn.value)) return null;

    // The overloads pair each consumer with either the original or selected context.
    const argumentValue = options === undefined
      ? parseAsComponentGrammar(fn.value, withTrivia(consumeArgumentValue as TryConsumer<ArgumentValue, Context>), context)
      : parseAsComponentGrammar(fn.value, withTrivia(consumeArgumentValue as TryConsumer<ArgumentValue, ArgumentContext>), options.contextForArguments(context));

    return argumentValue === null
      ? null
      : projectValue(argumentValue, context);
  });
}

export type FreeFormConsumerOptions = {
  strict?: boolean;
  stopBefore?: (component: ComponentValue) => boolean;
};

// <free-form[ <value> ]>
export function createFreeFormConsumer<Value, Context = unknown>(
  consumeValue: TryConsumer<Value, Context>,
  options: FreeFormConsumerOptions = {},
): TryConsumer<Value, Context> {
  const strict = options.strict ?? true;

  return (c) => {
    const start = c.pos();
    consumeWhitespace(c);

    const first = c.peek();

    if (isBraceBlock(first)) {
      c.next();

      const result = parseAsComponentGrammar(
        first.value,
        withTrivia(consumeValue),
        c.context,
      );

      if (result === null) {
        c.restore(start);
      }

      return result;
    }

    const list = new TokenList<ComponentValue>(c.source.text);

    while (true) {
      const component = c.peek();

      if (component.type === TokenKind.EOF) break;
      if (strict && (
        isTokenKind(component, TokenKind.Comma) ||
        isBraceBlock(component) ||
        options.stopBefore?.(component) === true
      )) {
        break;
      }

      const start = c.pos();
      c.next();
      list.append(component, c.source, start, c.pos());
    }

    const result = parseAsComponentGrammar(
      list,
      consumeValue,
      c.context,
    );

    if (result === null) {
      c.restore(start);
    }

    return result;
  };
}

// =============================================================================
// Component consumers
// =============================================================================

// <whitespace-token>*
export function consumeWhitespace(c: TokenCursor): void {
  c.consumeWhile(isWhitespaceToken);
}

// =============================================================================
// Token consumers
// =============================================================================

// <colon-token>
export function consumeColon(c: TokenCursor): TryConsumerResult<':'> {
  return c.match(TokenKind.Colon) ? ':' : null;
}

// <comma-token>
export function consumeComma(c: TokenCursor): TryConsumerResult<','> {
  return c.match(TokenKind.Comma) ? ',' : null;
}

// <semicolon-token>
export function consumeSemicolon(c: TokenCursor): TryConsumerResult<';'> {
  return c.match(TokenKind.Semicolon) ? ';' : null;
}

// <ident-token>
export function consumeIdentToken(c: TokenCursor): TryConsumerResult<IdentToken> {
  const component = c.peek();

  if (!isIdentToken(component)) return null;

  c.next();
  return component;
}

// <string-token>
export function consumeStringToken(c: TokenCursor): TryConsumerResult<StringToken> {
  const component = c.peek();

  if (!isTokenKind(component, TokenKind.String)) return null;

  c.next();
  return component;
}

// <hash-token>
export function consumeHashToken(c: TokenCursor): TryConsumerResult<HashToken> {
  const component = c.peek();

  if (!isTokenKind(component, TokenKind.Hash)) return null;

  c.next();
  return component;
}

// <hash-token with the id flag>
export const consumeIdHashToken: TryConsumer<HashToken> = adaptConsumer(
  consumeHashToken,
  (token) => token.flag === HashTokenFlag.Id ? token : null,
);

// <integer-token>
export function consumeIntegerToken(c: TokenCursor): TryConsumerResult<NumberToken> {
  const component = c.peek();

  if (
    !isTokenKind(component, TokenKind.Number) ||
    component.flag !== NumberTokenFlag.Integer
  ) return null;

  c.next();
  return component;
}

// <number-token>
export function consumeNumberToken(c: TokenCursor): TryConsumerResult<NumberToken> {
  const component = c.peek();

  if (!isTokenKind(component, TokenKind.Number)) return null;

  c.next();
  return component;
}

// <percentage-token>
export function consumePercentageToken(
  c: TokenCursor,
): TryConsumerResult<PercentageToken> {
  const component = c.peek();

  if (!isTokenKind(component, TokenKind.Percentage)) return null;

  c.next();
  return component;
}

// <dimension-token>
export function consumeDimensionToken(
  c: TokenCursor,
): TryConsumerResult<DimensionToken> {
  const component = c.peek();

  if (!isTokenKind(component, TokenKind.Dimension)) return null;

  c.next();
  return component;
}

// <url-token>
export function consumeUrlToken(
  c: TokenCursor,
): TryConsumerResult<UrlToken> {
  const component = c.peek();

  if (!isTokenKind(component, TokenKind.Url)) return null;

  c.next();
  return component;
}

// <delim-token matching '&'>
export const consumeAmpersandDelim = createDelimConsumer('&');

// <delim-token matching '*'>
export const consumeAsteriskDelim = createDelimConsumer('*');

// <delim-token matching '^'>
export const consumeCaretDelim = createDelimConsumer('^');

// <delim-token matching '$'>
export const consumeDollarDelim = createDelimConsumer('$');

// <delim-token matching '.'>
export const consumeDotDelim = createDelimConsumer('.');

// <delim-token matching '='>
export const consumeEqualsDelim = createDelimConsumer('=');

// <delim-token matching '>'>
export const consumeGreaterDelim = createDelimConsumer('>');

// <delim-token matching '#'>
export const consumeHashDelim = createDelimConsumer('#');

// <delim-token matching '<'>
export const consumeLessDelim = createDelimConsumer('<');

// <delim-token matching '-'>
export const consumeMinusDelim = createDelimConsumer('-');

// <delim-token matching '|'>
export const consumePipeDelim = createDelimConsumer('|');

// <delim-token matching '+'>
export const consumePlusDelim = createDelimConsumer('+');

// <delim-token matching '/'>
export const consumeSlashDelim = createDelimConsumer('/');

// <delim-token matching '~'>
export const consumeTildeDelim = createDelimConsumer('~');

// =============================================================================
// Block consumers
// =============================================================================

/*
 * Token grammar: { <component-value>* }
 * Component-value form: a brace block containing <component-value>*.
 */
export function consumeBraceBlock(c: TokenCursor): TryConsumerResult<BraceBlock> {
  const component = c.peek();

  if (!isBraceBlock(component)) return null;

  c.next();
  return component;
}

/*
 * Token grammar: [ <component-value>* ]
 * Component-value form: a bracket block containing <component-value>*.
 */
export function consumeBracketBlock(c: TokenCursor): TryConsumerResult<BracketBlock> {
  const component = c.peek();

  if (!isBracketBlock(component)) return null;

  c.next();
  return component;
}

/*
 * Token grammar: ( <component-value>* )
 * Component-value form: a parentheses block containing <component-value>*.
 */
export function consumeParensBlock(c: TokenCursor): TryConsumerResult<ParensBlock> {
  const component = c.peek();

  if (!isParensBlock(component)) return null;

  c.next();
  return component;
}

/*
 * Token grammar: <function-token> <component-value>* )
 * Component-value form: a function block containing <component-value>*.
 */
export function consumeFunctionBlock(c: TokenCursor): TryConsumerResult<FunctionBlock> {
  const component = c.peek();

  if (!isFunctionBlock(component)) return null;

  c.next();
  return component;
}

/*
 * Token grammar: <function-token> <any-value> )
 * Component-value form: a function block containing <any-value>.
 *
 * CSS Syntax represents the complete functional notation as a function block,
 * whether it ended with an explicit closing parenthesis or at EOF.
 */
export function consumeAnyValueFunctionBlock(
  c: TokenCursor,
): TryConsumerResult<AnyValueFunctionBlock> {
  const component = c.peek();

  if (!isAnyValueFunctionBlock(component)) return null;

  c.next();
  return component;
}

// =============================================================================
// Helpers
// =============================================================================

function createDelimConsumer<T extends string>(expected: T): TryConsumer<T> {
  return (c) => {
    const component = c.peek();

    if (!isDelimToken(component, expected)) return null;

    c.next();
    return expected;
  };
}
