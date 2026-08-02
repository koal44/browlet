import { asciiLower } from '../../shared/css';
import { isAnyValue } from '../values/any-value';
import type { ComponentCursor } from './component-cursor';
import { withTrivia } from './component-grammar';
import type { TryComponentConsumer, TryComponentConsumerResult } from './component-try-consumer';
import { bad, ComponentConsumerBadReason, isBad, ok } from './component-try-consumer';
import {
  isDelimToken, isFunctionBlock, isIdentToken, isTokenKind, parseAsComponentGrammar,
  type FunctionBlock,
} from './syntax';
import type { HashToken, IdentToken, NumberToken, PercentageToken, StringToken } from './tokens';
import { HashTokenFlag, NumberTokenFlag, TokenKind } from './tokens';

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
      fn.value.value.length > 0 &&
      !isAnyValue(fn.value.value)
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
