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
import { ValueStage } from '../value-processing/stage';
import type { TreeScope } from '../engine/tree-scope';

/*
 * NOTE: src() provides an escape from url()'s legacy unquoted URL
 * tokenization. For example, url(var(--x)) becomes a bad-url token before
 * value parsing, while src(var(--x)) remains a function block that can support
 * later substitution. We retain src() even though the browser results recorded
 * by the "CSS.supports URL modifier oracle" and "CSSOM URL modifier oracle"
 * scenarios in test/stylelet/scenarios/oracle.test.ts show no current browser support for
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
  // Fragment-only URLs carry this flag before their scope is known.
  local?: true;
  // Captured declaration provenance for local URL matching.
  treeScope?: TreeScope;
};

export type UrlNotation = 'url' | 'src';

export type UrlContext = {
  baseUrl?: URL;
  treeScope?: TreeScope;
};

export const urlDef: ValueDefinition<UrlValue, UrlContext> = {
  consume: consumeUrl,
  resolve: resolveUrl,
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

export function resolveUrl(
  value: UrlValue,
  stage: ValueStage,
  context: UrlContext = {},
): UrlValue {
  if (value.local === true) {
    if (
      stage < ValueStage.Specified ||
      value.treeScope !== undefined ||
      context.treeScope === undefined
    ) {
      return value;
    }

    return { ...value, treeScope: context.treeScope };
  }

  if (
    stage < ValueStage.Computed ||
    value.value === ''
  ) {
    return value;
  }

  try {
    return {
      ...value,
      value: new URL(value.value, context.baseUrl).href,
    };
  } catch {
    // A URL that cannot be made absolute retains its specified value.
    return value;
  }
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

function createUrlValue(
  notation: UrlNotation,
  value: string,
  modifiers: RequestUrlModifiers,
): UrlValue {
  return {
    type: 'url',
    notation,
    value,
    modifiers,
    ...(value.startsWith('#') ? { local: true as const } : {}),
  };
}

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
  (component) => createUrlValue('url', component.value, {}),
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
  (value) => createUrlValue('src', value.value, value.modifiers),
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
      (value) => createUrlValue('url', value.value, value.modifiers),
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
