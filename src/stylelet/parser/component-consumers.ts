import { asciiLower } from '../../shared/css';
import { isAnyValueContents, tryConsumeAnyValue, type AnyValue } from '../values/any-value';
import { type ComponentCursor, type TryComponentConsumer, type TryComponentConsumerResult } from './component-cursor';
import { adaptConsumer, withTrivia } from './component-grammar';
import {
  isBraceBlock, isBracketBlock, isDelimToken, isFunctionBlock, isIdentToken, isParensBlock,
  isTokenKind, isWhitespaceToken, type BraceBlock, type BracketBlock, type ComponentValue,
  type FunctionBlock, type ParensBlock,
} from './component-value';
import { parseAsComponentGrammar } from './syntax';
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
  tryConsumeArgumentValue: TryComponentConsumer<ArgumentValue>,
  projectValue: (
    value: ArgumentValue,
    context: unknown,
  ) => TryComponentConsumerResult<Value>,
  options: FunctionalNotationConsumerOptions = {},
): TryComponentConsumer<Value> {
  const normalizedName = asciiLower(name);

  return adaptConsumer(tryConsumeFunctionBlock, (fn, context) => {
    if (asciiLower(fn.name) !== normalizedName) return null;
    if (!isAnyValueContents(fn.value)) return null;

    const argumentContext = options.contextForArguments === undefined
      ? context
      : options.contextForArguments(context);
    const argumentValue = parseAsComponentGrammar(
      fn.value,
      withTrivia(tryConsumeArgumentValue),
      argumentContext,
    );

    return argumentValue === null
      ? null
      : projectValue(argumentValue, context);
  });
}

export type FreeFormOptions = {
  strict?: boolean;
  stopBefore?: (component: ComponentValue) => boolean;
};

// <free-form[ <value> ]>
export function createFreeFormConsumer<Value>(
  tryConsumeValue: TryComponentConsumer<Value>,
  options: FreeFormOptions = {},
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
        withTrivia(tryConsumeValue),
        c.context,
      );

      if (result === null) {
        c.restore(start);
      }

      return result;
    }

    if (first === null) {
      c.restore(start);
      return null;
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
      tryConsumeValue,
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
export function tryConsumeColon(c: ComponentCursor): TryComponentConsumerResult<':'> {
  return c.match(TokenKind.Colon) ? ':' : null;
}

// <comma-token>
export function tryConsumeComma(c: ComponentCursor): TryComponentConsumerResult<','> {
  return c.match(TokenKind.Comma) ? ',' : null;
}

// <ident-token>
export function tryConsumeIdentToken(c: ComponentCursor): TryComponentConsumerResult<IdentToken> {
  const component = c.peek();

  if (!isIdentToken(component)) return null;

  c.next();
  return component;
}

// <string-token>
export function tryConsumeStringToken(c: ComponentCursor): TryComponentConsumerResult<StringToken> {
  const component = c.peek();

  if (!isTokenKind(component, TokenKind.String)) return null;

  c.next();
  return component;
}

// <hash-token>
export function tryConsumeHashToken(c: ComponentCursor): TryComponentConsumerResult<HashToken> {
  const component = c.peek();

  if (!isTokenKind(component, TokenKind.Hash)) return null;

  c.next();
  return component;
}

// <hash-token with the id flag>
export const tryConsumeIdHashToken: TryComponentConsumer<HashToken> = adaptConsumer(
  tryConsumeHashToken,
  (token) => token.flag === HashTokenFlag.Id ? token : null,
);

// <integer-token>
export function tryConsumeIntegerToken(c: ComponentCursor): TryComponentConsumerResult<NumberToken> {
  const component = c.peek();

  if (
    !isTokenKind(component, TokenKind.Number) ||
    component.flag !== NumberTokenFlag.Integer
  ) return null;

  c.next();
  return component;
}

// <number-token>
export function tryConsumeNumberToken(c: ComponentCursor): TryComponentConsumerResult<NumberToken> {
  const component = c.peek();

  if (!isTokenKind(component, TokenKind.Number)) return null;

  c.next();
  return component;
}

// <percentage-token>
export function tryConsumePercentageToken(
  c: ComponentCursor,
): TryComponentConsumerResult<PercentageToken> {
  const component = c.peek();

  if (!isTokenKind(component, TokenKind.Percentage)) return null;

  c.next();
  return component;
}

// <dimension-token>
export function tryConsumeDimensionToken(
  c: ComponentCursor,
): TryComponentConsumerResult<DimensionToken> {
  const component = c.peek();

  if (!isTokenKind(component, TokenKind.Dimension)) return null;

  c.next();
  return component;
}

// <url-token>
export function tryConsumeUrlToken(
  c: ComponentCursor,
): TryComponentConsumerResult<UrlToken> {
  const component = c.peek();

  if (!isTokenKind(component, TokenKind.Url)) return null;

  c.next();
  return component;
}

// <delim-token matching '*'>
export const tryConsumeAsteriskDelim = createDelimConsumer('*');

// <delim-token matching '^'>
export const tryConsumeCaretDelim = createDelimConsumer('^');

// <delim-token matching '$'>
export const tryConsumeDollarDelim = createDelimConsumer('$');

// <delim-token matching '.'>
export const tryConsumeDotDelim = createDelimConsumer('.');

// <delim-token matching '='>
export const tryConsumeEqualsDelim = createDelimConsumer('=');

// <delim-token matching '>'>
export const tryConsumeGreaterDelim = createDelimConsumer('>');

// <delim-token matching '#'>
export const tryConsumeHashDelim = createDelimConsumer('#');

// <delim-token matching '<'>
export const tryConsumeLessDelim = createDelimConsumer('<');

// <delim-token matching '-'>
export const tryConsumeMinusDelim = createDelimConsumer('-');

// <delim-token matching '|'>
export const tryConsumePipeDelim = createDelimConsumer('|');

// <delim-token matching '+'>
export const tryConsumePlusDelim = createDelimConsumer('+');

// <delim-token matching '/'>
export const tryConsumeSlashDelim = createDelimConsumer('/');

// <delim-token matching '~'>
export const tryConsumeTildeDelim = createDelimConsumer('~');

// =============================================================================
// Block consumers
// =============================================================================

/*
 * Token grammar: { <component-value>* }
 * Component-value form: a brace block containing <component-value>*.
 */
export function tryConsumeBraceBlock(c: ComponentCursor): TryComponentConsumerResult<BraceBlock> {
  const component = c.peek();

  if (!isBraceBlock(component)) return null;

  c.next();
  return component;
}

/*
 * Token grammar: [ <component-value>* ]
 * Component-value form: a bracket block containing <component-value>*.
 */
export function tryConsumeBracketBlock(c: ComponentCursor): TryComponentConsumerResult<BracketBlock> {
  const component = c.peek();

  if (!isBracketBlock(component)) return null;

  c.next();
  return component;
}

/*
 * Token grammar: ( <component-value>* )
 * Component-value form: a parentheses block containing <component-value>*.
 */
export function tryConsumeParensBlock(c: ComponentCursor): TryComponentConsumerResult<ParensBlock> {
  const component = c.peek();

  if (!isParensBlock(component)) return null;

  c.next();
  return component;
}

/*
 * Token grammar: <function-token> <component-value>* )
 * Component-value form: a function block containing <component-value>*.
 */
export function tryConsumeFunctionBlock(c: ComponentCursor): TryComponentConsumerResult<FunctionBlock> {
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

export function tryConsumeAnyValueFunctionBlock(
  c: ComponentCursor,
): TryComponentConsumerResult<AnyValueFunctionBlock> {
  return consumeAnyValueFunctionBlock(c);
}

const consumeAnyValueFunctionBlock = adaptConsumer(
  tryConsumeFunctionBlock,
  (fn) => {
    const value = parseAsComponentGrammar(fn.value, tryConsumeAnyValue);

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
