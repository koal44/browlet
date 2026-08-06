import { asciiLower } from '../../shared/css';
import { isAnyValueContents, consumeAnyValue, type AnyValue } from './any-value';
import { type ComponentCursor, type TryComponentConsumer, type TryComponentConsumerResult } from './component-cursor';
import { adaptConsumer, withTrivia } from './component-grammar';
import {
  isBraceBlock, isBracketBlock, isDelimToken, isFunctionBlock, isIdentToken, isParensBlock,
  isTokenKind, isWhitespaceToken, type BraceBlock, type BracketBlock, type ComponentValue,
  type FunctionBlock, type ParensBlock,
} from './component-value';
import { parseAsComponentGrammar } from './parser';
import type {
  DimensionToken, HashToken, IdentToken, NumberToken, PercentageToken,
  StringToken, UrlToken,
} from './tokens';
import { HashTokenFlag, NumberTokenFlag, TokenKind } from './tokens';

// =============================================================================
// Consumer creators
// =============================================================================

export type FunctionalNotationConsumerOptions = {
  contextForArguments?: (context: unknown) => unknown;
};

// TODO: Fold free-form production handling into functional-notation argument
// parsing, including its strictness and additional boundaries. This should be
// the sole public entry point for that machinery, without caller-applied wrappers.

// <function-token matching name> <argument-value> )
export function createFunctionalNotationConsumer<ArgumentValue, Value>(
  name: string,
  consumeArgumentValue: TryComponentConsumer<ArgumentValue>,
  projectValue: (
    value: ArgumentValue,
    context: unknown,
  ) => TryComponentConsumerResult<Value>,
  options: FunctionalNotationConsumerOptions = {},
): TryComponentConsumer<Value> {
  const normalizedName = asciiLower(name);

  return adaptConsumer(consumeFunctionBlock, (fn, context) => {
    if (asciiLower(fn.name) !== normalizedName) return null;
    if (!isAnyValueContents(fn.value)) return null;

    const argumentContext = options.contextForArguments === undefined
      ? context
      : options.contextForArguments(context);
    const argumentValue = parseAsComponentGrammar(
      fn.value,
      withTrivia(consumeArgumentValue),
      argumentContext,
    );

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
export function createFreeFormConsumer<Value>(
  consumeValue: TryComponentConsumer<Value>,
  options: FreeFormConsumerOptions = {},
): TryComponentConsumer<Value> {
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

    const components: ComponentValue[] = [];

    while (true) {
      const component = c.peek();

      if (component === null) break;
      if (strict && (
        isTokenKind(component, TokenKind.Comma) ||
        isBraceBlock(component) ||
        options.stopBefore?.(component) === true
      )) {
        break;
      }

      components.push(component);
      c.next();
    }

    const result = parseAsComponentGrammar(
      components,
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
export function consumeWhitespace(c: ComponentCursor): void {
  c.consumeWhile(isWhitespaceToken);
}

// =============================================================================
// Token consumers
// =============================================================================

// <colon-token>
export function consumeColon(c: ComponentCursor): TryComponentConsumerResult<':'> {
  return c.match(TokenKind.Colon) ? ':' : null;
}

// <comma-token>
export function consumeComma(c: ComponentCursor): TryComponentConsumerResult<','> {
  return c.match(TokenKind.Comma) ? ',' : null;
}

// <semicolon-token>
export function consumeSemicolon(c: ComponentCursor): TryComponentConsumerResult<';'> {
  return c.match(TokenKind.Semicolon) ? ';' : null;
}

// <ident-token>
export function consumeIdentToken(c: ComponentCursor): TryComponentConsumerResult<IdentToken> {
  const component = c.peek();

  if (!isIdentToken(component)) return null;

  c.next();
  return component;
}

// <string-token>
export function consumeStringToken(c: ComponentCursor): TryComponentConsumerResult<StringToken> {
  const component = c.peek();

  if (!isTokenKind(component, TokenKind.String)) return null;

  c.next();
  return component;
}

// <hash-token>
export function consumeHashToken(c: ComponentCursor): TryComponentConsumerResult<HashToken> {
  const component = c.peek();

  if (!isTokenKind(component, TokenKind.Hash)) return null;

  c.next();
  return component;
}

// <hash-token with the id flag>
export const consumeIdHashToken: TryComponentConsumer<HashToken> = adaptConsumer(
  consumeHashToken,
  (token) => token.flag === HashTokenFlag.Id ? token : null,
);

// <integer-token>
export function consumeIntegerToken(c: ComponentCursor): TryComponentConsumerResult<NumberToken> {
  const component = c.peek();

  if (
    !isTokenKind(component, TokenKind.Number) ||
    component.flag !== NumberTokenFlag.Integer
  ) return null;

  c.next();
  return component;
}

// <number-token>
export function consumeNumberToken(c: ComponentCursor): TryComponentConsumerResult<NumberToken> {
  const component = c.peek();

  if (!isTokenKind(component, TokenKind.Number)) return null;

  c.next();
  return component;
}

// <percentage-token>
export function consumePercentageToken(
  c: ComponentCursor,
): TryComponentConsumerResult<PercentageToken> {
  const component = c.peek();

  if (!isTokenKind(component, TokenKind.Percentage)) return null;

  c.next();
  return component;
}

// <dimension-token>
export function consumeDimensionToken(
  c: ComponentCursor,
): TryComponentConsumerResult<DimensionToken> {
  const component = c.peek();

  if (!isTokenKind(component, TokenKind.Dimension)) return null;

  c.next();
  return component;
}

// <url-token>
export function consumeUrlToken(
  c: ComponentCursor,
): TryComponentConsumerResult<UrlToken> {
  const component = c.peek();

  if (!isTokenKind(component, TokenKind.Url)) return null;

  c.next();
  return component;
}

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
export function consumeBraceBlock(c: ComponentCursor): TryComponentConsumerResult<BraceBlock> {
  const component = c.peek();

  if (!isBraceBlock(component)) return null;

  c.next();
  return component;
}

/*
 * Token grammar: [ <component-value>* ]
 * Component-value form: a bracket block containing <component-value>*.
 */
export function consumeBracketBlock(c: ComponentCursor): TryComponentConsumerResult<BracketBlock> {
  const component = c.peek();

  if (!isBracketBlock(component)) return null;

  c.next();
  return component;
}

/*
 * Token grammar: ( <component-value>* )
 * Component-value form: a parentheses block containing <component-value>*.
 */
export function consumeParensBlock(c: ComponentCursor): TryComponentConsumerResult<ParensBlock> {
  const component = c.peek();

  if (!isParensBlock(component)) return null;

  c.next();
  return component;
}

/*
 * Token grammar: <function-token> <component-value>* )
 * Component-value form: a function block containing <component-value>*.
 */
export function consumeFunctionBlock(c: ComponentCursor): TryComponentConsumerResult<FunctionBlock> {
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
export type AnyValueFunctionBlock = FunctionBlock<AnyValue>;

export function consumeAnyValueFunctionBlock(
  c: ComponentCursor,
): TryComponentConsumerResult<AnyValueFunctionBlock> {
  return anyValueFunctionBlockConsumer(c);
}

const anyValueFunctionBlockConsumer = adaptConsumer(
  consumeFunctionBlock,
  (fn) => {
    const value = parseAsComponentGrammar(fn.value, consumeAnyValue);

    return value === null
      ? null
      : { ...fn, value };
  },
);

// =============================================================================
// Helpers
// =============================================================================

function createDelimConsumer<T extends string>(expected: T): TryComponentConsumer<T> {
  return (c) => {
    const component = c.peek();

    if (!isDelimToken(component, expected)) return null;

    c.next();
    return expected;
  };
}
