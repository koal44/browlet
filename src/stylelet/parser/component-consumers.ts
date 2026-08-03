import { asciiLower } from '../../shared/css';
import {
  isAnyValueContents, tryConsumeAnyValue,
  type AnyValue,
} from '../values/any-value';
import { type ComponentCursor, type TryComponentConsumer, type TryComponentConsumerResult } from './component-cursor';
import { withTrivia } from './component-grammar';

import {
  isBraceBlock, isDelimToken, isFunctionBlock, isIdentToken, isTokenKind,
  consumeComponentTrivia, parseAsComponentGrammar,
  type ComponentValue, type FunctionBlock,
} from './syntax';
import type { HashToken, IdentToken, NumberToken, PercentageToken, StringToken } from './tokens';
import { HashTokenFlag, NumberTokenFlag, TokenKind } from './tokens';

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
  project: (value: ArgumentValue) => Value,
  options: FunctionalNotationConsumerOptions = {},
): TryComponentConsumer<Value> {
  const normalizedName = asciiLower(name);

  return (c): TryComponentConsumerResult<Value> => {
    const start = c.pos();
    const fn = tryConsumeFunctionBlock(c);

    if (fn === null) return null;

    if (asciiLower(fn.name) !== normalizedName) {
      c.restore(start);
      return null;
    }

    if (!isAnyValueContents(fn.value)) {
      c.restore(start);
      return null;
    }

    const argumentContext = options.contextForArguments === undefined
      ? c.context
      : options.contextForArguments(c.context);
    const argumentValue = parseAsComponentGrammar(
      fn.value,
      withTrivia(tryConsumeArgumentValue),
      argumentContext,
    );

    if (argumentValue === null) {
      c.restore(start);
      return null;
    }

    return project(argumentValue);
  };
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
    consumeComponentTrivia(c);

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

// :
export function tryConsumeColon(c: ComponentCursor): TryComponentConsumerResult<':'> {
  return c.match(TokenKind.Colon) ? ':' : null;
}

// <ident-token>
export function tryConsumeIdentToken(c: ComponentCursor): TryComponentConsumerResult<IdentToken> {
  const start = c.pos();
  const component = c.next();

  if (!isIdentToken(component)) {
    c.restore(start);
    return null;
  }

  return component;
}

// <string-token>
export function tryConsumeStringToken(c: ComponentCursor): TryComponentConsumerResult<StringToken> {
  const start = c.pos();
  const component = c.next();

  if (!isTokenKind(component, TokenKind.String)) {
    c.restore(start);
    return null;
  }

  return component;
}

// <hash-token>
export function tryConsumeHashToken(c: ComponentCursor): TryComponentConsumerResult<HashToken> {
  const start = c.pos();
  const component = c.next();

  if (!isTokenKind(component, TokenKind.Hash)) {
    c.restore(start);
    return null;
  }

  return component;
}

// <hash-token with the id flag>
export function tryConsumeIdHashToken(c: ComponentCursor): TryComponentConsumerResult<HashToken> {
  const start = c.pos();
  const result = tryConsumeHashToken(c);

  if (result === null) return null;

  if (result.flag !== HashTokenFlag.Id) {
    c.restore(start);
    return null;
  }

  return result;
}

// <function-token> <component-value>* )
export function tryConsumeFunctionBlock(c: ComponentCursor): TryComponentConsumerResult<FunctionBlock> {
  const start = c.pos();
  const component = c.next();

  if (!isFunctionBlock(component)) {
    c.restore(start);
    return null;
  }

  return component;
}

/*
 * <function-token> <any-value> )
 *
 * CSS Syntax represents the complete functional notation as a function block,
 * whether it ended with an explicit closing parenthesis or at EOF.
 */
export type AnyValueFunctionBlock = FunctionBlock<AnyValue>;

// <function-token> <any-value> )
export function tryConsumeAnyValueFunctionBlock(
  c: ComponentCursor,
): TryComponentConsumerResult<AnyValueFunctionBlock> {
  const start = c.pos();
  const fn = tryConsumeFunctionBlock(c);

  if (fn === null) return null;

  const value = parseAsComponentGrammar(fn.value, tryConsumeAnyValue);

  if (value === null) {
    c.restore(start);
    return null;
  }

  return {
    ...fn,
    value,
  };
}

// <number-token with the integer flag>
export function tryConsumeIntegerToken(c: ComponentCursor): TryComponentConsumerResult<NumberToken> {
  const start = c.pos();
  const component = c.next();

  if (
    !isTokenKind(component, TokenKind.Number) ||
    component.flag !== NumberTokenFlag.Integer
  ) {
    c.restore(start);
    return null;
  }

  return component;
}

// <number-token>
export function tryConsumeNumberToken(c: ComponentCursor): TryComponentConsumerResult<NumberToken> {
  const start = c.pos();
  const component = c.next();

  if (!isTokenKind(component, TokenKind.Number)) {
    c.restore(start);
    return null;
  }

  return component;
}

// <percentage-token>
export function tryConsumePercentageToken(
  c: ComponentCursor,
): TryComponentConsumerResult<PercentageToken> {
  const start = c.pos();
  const component = c.next();

  if (!isTokenKind(component, TokenKind.Percentage)) {
    c.restore(start);
    return null;
  }

  return component;
}

// <delim-token matching expected>
export function createDelimConsumer<T extends string>(expected: T): TryComponentConsumer<T> {
  return (c) => {
    const start = c.pos();
    const component = c.next();

    if (!isDelimToken(component, expected)) {
      c.restore(start);
      return null;
    }

    return expected;
  };
}
