import { asciiLower } from '../../utils/css';
import type { ComponentCursor } from './component-cursor';
import type { TryComponentParser, TryComponentParserResult } from './component-try-parser';
import { ok } from './component-try-parser';
import type { FunctionBlock } from './syntax';
import { isDelimToken, isFunctionBlock, isIdentToken, isTokenKind } from './syntax';
import type { HashToken, IdentToken, NumberToken, StringToken } from './tokens';
import { HashTokenFlag, NumberTokenFlag, TokenKind } from './tokens';

export function tryConsumeColon(c: ComponentCursor): TryComponentParserResult<':'> {
  return c.match(TokenKind.Colon) ? ok(':') : null;
}

export function tryConsumeIdentToken(c: ComponentCursor): TryComponentParserResult<IdentToken> {
  const start = c.pos();
  const component = c.next();

  if (!isIdentToken(component)) {
    c.restore(start);
    return null;
  }

  return ok(component);
}

export function tryConsumeStringToken(c: ComponentCursor): TryComponentParserResult<StringToken> {
  const start = c.pos();
  const component = c.next();

  if (!isTokenKind(component, TokenKind.String)) {
    c.restore(start);
    return null;
  }

  return ok(component);
}

export function tryConsumeIdHashToken(c: ComponentCursor): TryComponentParserResult<HashToken> {
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

export function tryConsumeFunctionBlock(c: ComponentCursor): TryComponentParserResult<FunctionBlock> {
  const start = c.pos();
  const component = c.next();

  if (!isFunctionBlock(component)) {
    c.restore(start);
    return null;
  }

  return ok(component);
}

export function tryConsumeIntegerToken(c: ComponentCursor): TryComponentParserResult<NumberToken> {
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

export function createDelimConsumer<T extends string>(expected: T): TryComponentParser<T> {
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
): TryComponentParser<T> {
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
