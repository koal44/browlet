import {
  type TokenCursor, type TryConsumer, type TryConsumerResult,
} from '../syntax/token-cursor';
import { createFunctionalNotationConsumer, consumeUrlToken } from '../syntax/component-consumers';
import { any, one, oneOf, adaptConsumer, sequenceOf, withTrivia } from '../syntax/component-grammar';
import { createComponentParser, type ParserInput } from '../syntax/parser';
import { serializeCssString } from '../syntax/component-value';
import { consumeString } from './string';
import {
  isRequestUrlModifierValue, serializeRequestUrlModifiers,
  consumeUrlModifier, type RequestUrlModifiers, type RequestUrlModifierValue,
  type UrlModifierValue,
} from './url-modifier';
import type { ValueDefinition } from '../value-processing/definition';

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

export type UrlValue = {
  type: 'url';
  notation: UrlNotation;
  value: string;
  modifiers: RequestUrlModifiers;
};

export type UrlNotation = 'url' | 'src';

export const urlDef: ValueDefinition<UrlValue> = {
  consume: consumeUrl,
  resolve: (value) => value,
  serialize: serializeUrl,
};

export function parseUrl(
  input: ParserInput,
  context: unknown = undefined,
): UrlValue | null {
  return urlParser(input, context);
}

export function consumeUrl(
  c: TokenCursor,
): TryConsumerResult<UrlValue> {
  return urlConsumer(c);
}

export function serializeUrl(value: UrlValue): string {
  const args = [
    serializeCssString(value.value),
    ...serializeRequestUrlModifiers(value.modifiers),
  ];

  return `${value.notation}(${args.join(' ')})`;
}

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

// =============================================================================
// Syntax
// =============================================================================

// Implementation adapter rejecting duplicate recognized request modifiers.
const urlFunctionModifierConsumer = adaptConsumer(
  consumeUrlModifier,
  (value, context) => (
    isRequestUrlModifierValue(value) &&
    (context as UrlFunctionParserContext).seenRequestModifiers?.has(value.type) === true
  )
    ? null
    : value,
);

// <url-token>
const urlTokenValueConsumer: TryConsumer<UrlValue> = adaptConsumer(
  consumeUrlToken,
  (component): UrlValue => ({
    type: 'url',
    notation: 'url',
    value: component.value,
    modifiers: {},
  }),
);

// <src()> = src( <string> <url-modifier>* )
const srcFnConsumer = createFunctionalNotationConsumer(
  'src',
  sequenceOf(
    [
      one(consumeString),
      any(withTrivia(urlFunctionModifierConsumer), {
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

// <url()> = url( <string> <url-modifier>* ) | <url-token>
const urlFnConsumer: TryConsumer<UrlValue> = oneOf(
  [
    one(createFunctionalNotationConsumer(
      'url',
      sequenceOf(
        [
          one(consumeString),
          any(withTrivia(urlFunctionModifierConsumer), {
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
    one(urlTokenValueConsumer),
  ],
  ([value]) => value,
);

// <url> = <url()> | <src()>
const urlConsumer: TryConsumer<UrlValue> = oneOf(
  [
    one(urlFnConsumer),
    one(srcFnConsumer),
  ],
  ([value]) => value,
);

const urlParser = createComponentParser(withTrivia(urlConsumer));
