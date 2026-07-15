import type { ComponentCursor } from '../parser/component-cursor';
import { createFunctionalNotationConsumer } from '../parser/component-consumers';
import { any, one, oneOf, sequenceOf, withComponentTrivia } from '../parser/component-grammar';
import {
  bad, ComponentConsumerBadReason, isBad, ok,
  type TryComponentConsumer, type TryComponentConsumerResult,
} from '../parser/component-try-consumer';
import { isTokenKind, parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import { TokenKind } from '../parser/tokens';
import { serializeCssString, tryConsumeString } from './string';
import {
  isRequestUrlModifierValue, requestUrlModifierName,
  serializeRequestUrlModifiers, tryConsumeUrlModifier,
  type RequestUrlModifiers, type RequestUrlModifierValue, type UrlModifierValue,
} from './url-modifier';

/*
 * NOTE: src() provides an escape from url()'s legacy unquoted URL
 * tokenization. For example, url(var(--x)) becomes a bad-url token before
 * value parsing, while src(var(--x)) remains a function block that can support
 * later substitution. We retain src() even though the browser results recorded
 * by the "CSS.supports URL modifier oracle" and "CSSOM URL modifier oracle"
 * scenarios in test/stylelet/oracle.test.ts show no current browser support for
 * it.
 */

/*
 * <url> = <url()> | <src()>
 * <url()> = url( <string> <url-modifier>* ) | <url-token>
 * <src()> = src( <string> <url-modifier>* )
 *
 * Representing functional notation using component-value <function-block>s
 * gives the equivalent execution grammar:
 *
 * <url> = <url-notation> | <src-function>
 * <url-notation> = <url-function> | <url-token>
 */
export type UrlNotation = 'url' | 'src';

export type UrlValue = {
  type: 'url';
  notation: UrlNotation;
  value: string;
  modifiers: RequestUrlModifiers;
};

export function parseUrl(
  input: ParserInput,
  context: unknown = undefined,
): UrlValue | null {
  const result = parseAsComponentGrammar(
    input,
    withComponentTrivia(tryConsumeUrl),
    context,
  );

  return result === null || isBad(result) ? null : result.value;
}

export function tryConsumeUrl(
  c: ComponentCursor,
): TryComponentConsumerResult<UrlValue> {
  return consumeUrl(c);
}

export function serializeUrl(value: UrlValue): string {
  const args = [
    serializeCssString(value.value),
    ...serializeRequestUrlModifiers(value.modifiers),
  ];

  return `${value.notation}(${args.join(' ')})`;
}

const consumeUrl: TryComponentConsumer<UrlValue> = oneOf(
  [
    one(tryConsumeUrlNotation),
    one(tryConsumeSrcFunction),
  ],
  ([value]) => ok(value),
);

function tryConsumeUrlNotation(
  c: ComponentCursor,
): TryComponentConsumerResult<UrlValue> {
  return consumeUrlNotation(c);
}

const consumeUrlNotation: TryComponentConsumer<UrlValue> = oneOf(
  [
    one(tryConsumeUrlFunction),
    one(tryConsumeUrlToken),
  ],
  ([value]) => ok(value),
);

function tryConsumeUrlFunction(
  c: ComponentCursor,
): TryComponentConsumerResult<UrlValue> {
  return consumeUrlFunction(c);
}

const consumeUrlFunction = createFunctionalNotationConsumer(
  'url',
  tryConsumeUrlFunctionArguments,
  (value): UrlValue => ({
    type: 'url',
    notation: 'url',
    value: value.value,
    modifiers: value.modifiers,
  }),
  { contextForArguments: contextForUrlFunctionArguments },
);

function tryConsumeSrcFunction(
  c: ComponentCursor,
): TryComponentConsumerResult<UrlValue> {
  return consumeSrcFunction(c);
}

const consumeSrcFunction = createFunctionalNotationConsumer(
  'src',
  tryConsumeUrlFunctionArguments,
  (value): UrlValue => ({
    type: 'url',
    notation: 'src',
    value: value.value,
    modifiers: value.modifiers,
  }),
  { contextForArguments: contextForUrlFunctionArguments },
);

function tryConsumeUrlToken(
  c: ComponentCursor,
): TryComponentConsumerResult<UrlValue> {
  const start = c.pos();
  const component = c.next();

  if (!isTokenKind(component, TokenKind.Url)) {
    c.restore(start);
    return null;
  }

  return ok({
    type: 'url',
    notation: 'url',
    value: component.value,
    modifiers: {},
  });
}

/*
 * <url-function-arguments> = <string> <url-modifier>*
 */
type UrlFunctionArguments = {
  value: string;
  modifiers: RequestUrlModifiers;
};

type UrlFunctionParserContext = {
  seenRequestModifiers?: ReadonlySet<RequestUrlModifierValue['type']>;
};

function contextForUrlFunctionArguments(): UrlFunctionParserContext {
  return {};
}

function tryConsumeUrlFunctionArguments(
  c: ComponentCursor,
): TryComponentConsumerResult<UrlFunctionArguments> {
  return consumeUrlFunctionArguments(c);
}

const consumeUrlFunctionArguments: TryComponentConsumer<UrlFunctionArguments> =
  sequenceOf(
    [
      one(tryConsumeString),
      any(withComponentTrivia(tryConsumeUrlFunctionModifier), {
        contextAfter: contextAfterUrlFunctionModifier,
      }),
    ],
    ([[string], modifiers]) => ok({
      value: string.value,
      modifiers: urlModifiersFromArray(modifiers),
    }),
  );

function urlModifiersFromArray(
  values: readonly UrlModifierValue[],
): RequestUrlModifiers {
  const modifiers: RequestUrlModifiers = {};

  for (const value of values) {
    if (!isRequestUrlModifierValue(value)) {
      continue;
    }

    switch (value.type) {
      case 'cross-origin-modifier':
        modifiers.crossOrigin = value;
        break;
      case 'integrity-modifier':
        modifiers.integrity = value;
        break;
      case 'referrer-policy-modifier':
        modifiers.referrerPolicy = value;
        break;
    }
  }

  return modifiers;
}

function tryConsumeUrlFunctionModifier(
  c: ComponentCursor,
): TryComponentConsumerResult<UrlModifierValue> {
  const result = tryConsumeUrlModifier(c);

  if (result === null || isBad(result) || !isRequestUrlModifierValue(result.value)) {
    return result;
  }

  const context = c.context as UrlFunctionParserContext;

  if (context.seenRequestModifiers?.has(result.value.type) === true) {
    return bad(
      ComponentConsumerBadReason.Invalid,
      `Duplicate ${requestUrlModifierName(result.value)} URL modifier`,
    );
  }

  return result;
}

function contextAfterUrlFunctionModifier(
  value: UrlModifierValue,
  context: unknown,
): UrlFunctionParserContext {
  const urlContext = context as UrlFunctionParserContext;

  if (!isRequestUrlModifierValue(value)) {
    return urlContext;
  }

  return {
    ...urlContext,
    seenRequestModifiers: new Set([
      ...(urlContext.seenRequestModifiers ?? []),
      value.type,
    ]),
  };
}
