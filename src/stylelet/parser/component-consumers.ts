import { asciiLower } from '../../utils/css';
import type { ComponentCursor } from './component-cursor';
import type { TryComponentConsumer, TryComponentConsumerResult } from './component-try-consumer';
import { ok } from './component-try-consumer';
import type { FunctionBlock } from './syntax';
import { isDelimToken, isFunctionBlock, isIdentToken, isTokenKind } from './syntax';
import type { HashToken, IdentToken, NumberToken, StringToken } from './tokens';
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

export function tryConsumeIdHashToken(c: ComponentCursor): TryComponentConsumerResult<HashToken> {
  const start = c.pos();
  const component = c.next();

  if (
    !isTokenKind(component, TokenKind.Hash) ||
    component.flag !== HashTokenFlag.Id
  ) {
    c.restore(start);
    return null;
  }

  return ok(component);
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

export function createIdentValueConsumer<T extends string>(
  expected: T,
): TryComponentConsumer<T> {
  return (c) => {
    const start = c.pos();
    const component = c.next();

    if (
      !isIdentToken(component) ||
      asciiLower(component.value) !== expected
    ) {
      c.restore(start);
      return null;
    }

    return ok(expected);
  };
}
