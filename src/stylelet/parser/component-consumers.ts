import { asciiLower } from '../../shared/css';
import {
  isAnyValueContents, tryConsumeAnyValue,
  type AnyValue,
} from '../values/any-value';
import type { ComponentCursor } from './component-cursor';
import { withTrivia } from './component-grammar';
import type { TryComponentConsumer, TryComponentConsumerResult } from './component-try-consumer';
import { bad, ComponentConsumerBadReason, isBad, ok } from './component-try-consumer';
import {
  isBraceBlock, isDelimToken, isFunctionBlock, isIdentToken, isTokenKind,
  consumeComponentTrivia, parseAsComponentGrammar,
  type ComponentValue, type FunctionBlock,
} from './syntax';
import type { HashToken, IdentToken, NumberToken, PercentageToken, StringToken } from './tokens';
import { HashTokenFlag, NumberTokenFlag, TokenKind } from './tokens';

export type FunctionalNotationConsumerOptions = {
  contextForArguments?: (context: unknown) => unknown;

  /**
   * The default, `bad`, rejects invalid component values before applying the
   * argument grammar. `delegate` leaves their handling to that consumer.
   */
  invalidArgumentComponents?: 'bad' | 'delegate';

  /**
   * The default, `bad`, commits once the function name matches but its
   * arguments do not. `delegate` restores the outer cursor and reports no
   * match to the caller.
   */
  argumentGrammarMismatch?: 'bad' | 'delegate';
};

// TODO: Fold free-form production handling into functional-notation argument
// parsing, including its strictness and additional boundaries. This should be
// the sole public entry point for that machinery, without caller-applied wrappers.
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

    if (fn === null || isBad(fn)) {
      return fn;
    }

    if (asciiLower(fn.value.name) !== normalizedName) {
      c.restore(start);
      return null;
    }

    if (
      options.invalidArgumentComponents !== 'delegate' &&
      !isAnyValueContents(fn.value.value)
    ) {
      return bad(
        ComponentConsumerBadReason.Invalid,
        `Invalid component value in ${name}() arguments`,
      );
    }

    const argumentContext = options.contextForArguments === undefined
      ? c.context
      : options.contextForArguments(c.context);
    const argumentValue = parseAsComponentGrammar(
      fn.value.value,
      withTrivia(tryConsumeArgumentValue),
      argumentContext,
    );

    if (argumentValue === null) {
      if (options.argumentGrammarMismatch === 'delegate') {
        c.restore(start);
        return null;
      }

      return bad(
        ComponentConsumerBadReason.Invalid,
        `Invalid ${name}() arguments`,
      );
    }

    if (isBad(argumentValue)) {
      return argumentValue;
    }

    return ok(project(argumentValue.value));
  };
}

export type FreeFormOptions = {
  strict?: boolean;
  stopBefore?: (component: ComponentValue) => boolean;
};

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

export function tryConsumeColon(c: ComponentCursor): TryComponentConsumerResult<':'> {
  return c.match(TokenKind.Colon) ? ok(':') : null;
}

export function tryConsumeIdentToken(c: ComponentCursor): TryComponentConsumerResult<IdentToken> {
  const start = c.pos();
  const component = c.next();

  if (!isIdentToken(component)) {
    c.restore(start);
    return null;
  }

  return ok(component);
}

export function tryConsumeStringToken(c: ComponentCursor): TryComponentConsumerResult<StringToken> {
  const start = c.pos();
  const component = c.next();

  if (!isTokenKind(component, TokenKind.String)) {
    c.restore(start);
    return null;
  }

  return ok(component);
}

export function tryConsumeHashToken(c: ComponentCursor): TryComponentConsumerResult<HashToken> {
  const start = c.pos();
  const component = c.next();

  if (!isTokenKind(component, TokenKind.Hash)) {
    c.restore(start);
    return null;
  }

  return ok(component);
}

export function tryConsumeIdHashToken(c: ComponentCursor): TryComponentConsumerResult<HashToken> {
  const start = c.pos();
  const result = tryConsumeHashToken(c);

  if (result === null || isBad(result)) {
    return result;
  }

  if (result.value.flag !== HashTokenFlag.Id) {
    c.restore(start);
    return null;
  }

  return result;
}

export function tryConsumeFunctionBlock(c: ComponentCursor): TryComponentConsumerResult<FunctionBlock> {
  const start = c.pos();
  const component = c.next();

  if (!isFunctionBlock(component)) {
    c.restore(start);
    return null;
  }

  return ok(component);
}

/*
 * <function-token> <any-value> )
 *
 * CSS Syntax represents the complete functional notation as a function block,
 * whether it ended with an explicit closing parenthesis or at EOF.
 */
export type AnyValueFunctionBlock = Omit<FunctionBlock, 'value'> & {
  value: AnyValue;
};

export function tryConsumeAnyValueFunctionBlock(
  c: ComponentCursor,
): TryComponentConsumerResult<AnyValueFunctionBlock> {
  const start = c.pos();
  const fn = tryConsumeFunctionBlock(c);

  if (fn === null || isBad(fn)) {
    return fn;
  }

  const value = parseAsComponentGrammar(fn.value.value, tryConsumeAnyValue);

  if (value === null) {
    c.restore(start);
    return null;
  }

  if (isBad(value)) {
    return value;
  }

  return ok({
    ...fn.value,
    value: value.value,
  });
}

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

  return ok(component);
}

export function tryConsumeNumberToken(c: ComponentCursor): TryComponentConsumerResult<NumberToken> {
  const start = c.pos();
  const component = c.next();

  if (!isTokenKind(component, TokenKind.Number)) {
    c.restore(start);
    return null;
  }

  return ok(component);
}

export function tryConsumePercentageToken(
  c: ComponentCursor,
): TryComponentConsumerResult<PercentageToken> {
  const start = c.pos();
  const component = c.next();

  if (!isTokenKind(component, TokenKind.Percentage)) {
    c.restore(start);
    return null;
  }

  return ok(component);
}

export function createDelimConsumer<T extends string>(expected: T): TryComponentConsumer<T> {
  return (c) => {
    const start = c.pos();
    const component = c.next();

    if (!isDelimToken(component, expected)) {
      c.restore(start);
      return null;
    }

    return ok(expected);
  };
}
