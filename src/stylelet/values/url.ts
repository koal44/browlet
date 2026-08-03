import { type ComponentCursor, type TryComponentConsumer, type TryComponentConsumerResult } from '../parser/component-cursor';
import { createFunctionalNotationConsumer } from '../parser/component-consumers';
import { any, one, oneOf, sequenceOf, withTrivia } from '../parser/component-grammar';
import { isTokenKind, parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import { TokenKind } from '../parser/tokens';
import { serializeCssString, tryConsumeString } from './string';
import {
  isRequestUrlModifierValue, serializeRequestUrlModifiers,
  tryConsumeUrlModifier, type RequestUrlModifiers, type RequestUrlModifierValue,
  type UrlModifierValue,
} from './url-modifier';

/*
 * NOTE: src() provides an escape from url()'s legacy unquoted URL
 * tokenization. For example, url(var(--x)) becomes a bad-url token before
 * value parsing, while src(var(--x)) remains a function block that can support
 * later substitution. We retain src() even though the browser results recorded
 * by the "CSS.supports URL modifier oracle" and "CSSOM URL modifier oracle"
 * scenarios in test/stylelet/browser/oracle.test.ts show no current browser support for
 * it.
 */

/*
 * <url> = <url()> | <src()>
 * <url()> = url( <string> <url-modifier>* ) | <url-token>
 * <src()> = src( <string> <url-modifier>* )
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
    withTrivia(tryConsumeUrl),
    context,
  );

  return result;
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

// <url> = <url()> | <src()>
const consumeUrl: TryComponentConsumer<UrlValue> = oneOf(
  [
    one(tryConsumeUrlFn),
    one(tryConsumeSrcFn),
  ],
  ([value]) => value,
);

function tryConsumeUrlFn(
  c: ComponentCursor,
): TryComponentConsumerResult<UrlValue> {
  return consumeUrlFn(c);
}

// <url()> = url( <string> <url-modifier>* ) | <url-token>
const consumeUrlFn: TryComponentConsumer<UrlValue> = oneOf(
  [
    one(createFunctionalNotationConsumer(
      'url',
      sequenceOf(
        [
          one(tryConsumeString),
          any(withTrivia(tryConsumeUrlFunctionModifier), {
            contextAfter: contextAfterUrlFunctionModifier,
          }),
        ],
        ([[string], modifiers]) => ({
          value: string.value,
          modifiers: urlModifiersFromArray(modifiers),
        }),
      ),
      (value): UrlValue => ({
        type: 'url',
        notation: 'url',
        value: value.value,
        modifiers: value.modifiers,
      }),
      { contextForArguments: contextForUrlFunctionArguments },
    )),
    one(tryConsumeUrlToken),
  ],
  ([value]) => value,
);

function tryConsumeSrcFn(
  c: ComponentCursor,
): TryComponentConsumerResult<UrlValue> {
  return consumeSrcFn(c);
}

// <src()> = src( <string> <url-modifier>* )
const consumeSrcFn = createFunctionalNotationConsumer(
  'src',
  sequenceOf(
    [
      one(tryConsumeString),
      any(withTrivia(tryConsumeUrlFunctionModifier), {
        contextAfter: contextAfterUrlFunctionModifier,
      }),
    ],
    ([[string], modifiers]) => ({
      value: string.value,
      modifiers: urlModifiersFromArray(modifiers),
    }),
  ),
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
  return consumeUrlToken(c);
}

// <url-token>
const consumeUrlToken: TryComponentConsumer<UrlValue> = (c) => {
  const start = c.pos();
  const component = c.next();

  if (!isTokenKind(component, TokenKind.Url)) {
    c.restore(start);
    return null;
  }

  return {
    type: 'url',
    notation: 'url',
    value: component.value,
    modifiers: {},
  };
};

type UrlFunctionParserContext = {
  seenRequestModifiers?: ReadonlySet<RequestUrlModifierValue['type']>;
};

function contextForUrlFunctionArguments(): UrlFunctionParserContext {
  return {};
}

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

  if (result === null || !isRequestUrlModifierValue(result)) {
    return result;
  }

  const context = c.context as UrlFunctionParserContext;

  if (context.seenRequestModifiers?.has(result.type) === true) {
    return null;
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
