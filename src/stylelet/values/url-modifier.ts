import { asciiLower } from '../../shared/css';
import type {
  TokenCursor, TryConsumer, TryConsumerResult,
} from '../syntax/token-cursor';
import {
  createFunctionalNotationConsumer,
  consumeFunctionBlock,
} from '../syntax/component-consumers';
import {
  one, oneOf,
  withTrivia,
} from '../syntax/component-grammar';
import { type FunctionBlock } from '../syntax/component-value';
import { createComponentParser, type ParserInput } from '../syntax/parser';
import { isAnyValueContents } from '../syntax/any-value';
import { consumeIdent, type IdentValue } from './ident';
import { createKeywordConsumer } from './keyword';
import { serializeCssString } from '../syntax/component-value';
import { TokenKind } from '../syntax/tokens';
import { consumeString } from './string';

/*
 * NOTE: The URL modifier grammar is a provisional synthesis, not a verbatim
 * grammar from one specification. CSSWG issue #12151 develops the recognized
 * request-modifier grammar, while issue #1603 requires unknown modifiers to be
 * ignored. The explicit <unknown-url-modifier> arm lets the URL grammar consume
 * and later discard those unknown values. The oracle scenarios in
 * test/stylelet/scenarios/oracle.test.ts currently record only partial WebKit support, so
 * revisit this grammar as the specifications and implementations converge.
 *
 * https://github.com/w3c/csswg-drafts/issues/12151
 * https://github.com/w3c/csswg-drafts/issues/1603
 */

/*
 * <url-modifier> = <request-url-modifier> | <unknown-url-modifier>
 * <request-url-modifier> = <cross-origin-modifier>
 *                        | <integrity-modifier>
 *                        | <referrer-policy-modifier>
 * <unknown-url-modifier> = <ident> | <function-block>
 * <cross-origin-modifier> = cross-origin(anonymous | use-credentials)
 * <integrity-modifier> = integrity(<string>)
 * <referrer-policy-modifier> = referrer-policy(
 *     no-referrer
 *   | no-referrer-when-downgrade
 *   | same-origin
 *   | origin
 *   | strict-origin
 *   | origin-when-cross-origin
 *   | strict-origin-when-cross-origin
 *   | unsafe-url
 * )
 */
export type UrlModifierValue =
  | RequestUrlModifierValue
  | UnknownUrlModifierValue;

export type RequestUrlModifierValue =
  | CrossOriginModifierValue
  | IntegrityModifierValue
  | ReferrerPolicyModifierValue;

export type RequestUrlModifiers = {
  crossOrigin?: CrossOriginModifierValue;
  integrity?: IntegrityModifierValue;
  referrerPolicy?: ReferrerPolicyModifierValue;
};

export type UnknownUrlModifierValue = IdentValue | FunctionBlock;

export type CrossOriginModifierValue = {
  type: 'cross-origin-modifier';
  value: 'anonymous' | 'use-credentials';
};

export type IntegrityModifierValue = {
  type: 'integrity-modifier';
  value: string;
};

export type ReferrerPolicyModifierValue = {
  type: 'referrer-policy-modifier';
  value: ReferrerPolicy;
};

export type ReferrerPolicy =
  | 'no-referrer'
  | 'no-referrer-when-downgrade'
  | 'same-origin'
  | 'origin'
  | 'strict-origin'
  | 'origin-when-cross-origin'
  | 'strict-origin-when-cross-origin'
  | 'unsafe-url';

export function parseUrlModifier(
  input: ParserInput,
  context: unknown = undefined,
): UrlModifierValue | null {
  return urlModifierParser(input, context);
}

export function consumeUrlModifier(
  c: TokenCursor,
): TryConsumerResult<UrlModifierValue> {
  return urlModifierConsumer(c);
}

export function isRequestUrlModifierValue(
  value: unknown,
): value is RequestUrlModifierValue {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    (
      value.type === 'cross-origin-modifier' ||
      value.type === 'integrity-modifier' ||
      value.type === 'referrer-policy-modifier'
    )
  );
}

export function serializeRequestUrlModifiers(
  modifiers: RequestUrlModifiers,
): string[] {
  // CSS Values 4 section 9.1 serializes arguments in grammar order; CSSWG
  // issue #12151 applies that canonical ordering to request URL modifiers.
  const serialized: string[] = [];

  if (modifiers.crossOrigin !== undefined) {
    serialized.push(serializeRequestUrlModifier(modifiers.crossOrigin));
  }

  if (modifiers.integrity !== undefined) {
    serialized.push(serializeRequestUrlModifier(modifiers.integrity));
  }

  if (modifiers.referrerPolicy !== undefined) {
    serialized.push(serializeRequestUrlModifier(modifiers.referrerPolicy));
  }

  return serialized;
}

export function serializeRequestUrlModifier(
  value: RequestUrlModifierValue,
): string {
  const name = requestUrlModifierName(value);

  switch (value.type) {
    case 'cross-origin-modifier':
      return `${name}(${value.value})`;
    case 'integrity-modifier':
      return `${name}(${serializeCssString(value.value)})`;
    case 'referrer-policy-modifier':
      return `${name}(${value.value})`;
  }
}

export function requestUrlModifierName(
  value: RequestUrlModifierValue,
): 'cross-origin' | 'integrity' | 'referrer-policy' {
  switch (value.type) {
    case 'cross-origin-modifier':
      return 'cross-origin';
    case 'integrity-modifier':
      return 'integrity';
    case 'referrer-policy-modifier':
      return 'referrer-policy';
  }
}

// =============================================================================
// Syntax
// =============================================================================

// <cross-origin-modifier> = cross-origin(anonymous | use-credentials)
const crossOriginModifierConsumer = createFunctionalNotationConsumer(
  'cross-origin',
  createKeywordConsumer('anonymous', 'use-credentials'),
  (value): CrossOriginModifierValue => ({
    type: 'cross-origin-modifier',
    value,
  }),
);

// <integrity-modifier> = integrity(<string>)
const integrityModifierConsumer = createFunctionalNotationConsumer(
  'integrity',
  consumeString,
  (value): IntegrityModifierValue => ({
    type: 'integrity-modifier',
    value: value.value,
  }),
);

// <referrer-policy-modifier> = referrer-policy(no-referrer | no-referrer-when-downgrade | same-origin | origin | strict-origin | origin-when-cross-origin | strict-origin-when-cross-origin | unsafe-url)
const referrerPolicyModifierConsumer = createFunctionalNotationConsumer(
  'referrer-policy',
  createKeywordConsumer(
    'no-referrer',
    'no-referrer-when-downgrade',
    'same-origin',
    'origin',
    'strict-origin',
    'origin-when-cross-origin',
    'strict-origin-when-cross-origin',
    'unsafe-url',
  ),
  (value): ReferrerPolicyModifierValue => ({
    type: 'referrer-policy-modifier',
    value,
  }),
);

// <request-url-modifier> = <cross-origin-modifier> | <integrity-modifier> | <referrer-policy-modifier>
const requestUrlModifierConsumer: TryConsumer<RequestUrlModifierValue> =
  oneOf(
    [
      one(crossOriginModifierConsumer),
      one(integrityModifierConsumer),
      one(referrerPolicyModifierConsumer),
    ],
    ([value]) => value,
  );

// <unknown-url-modifier> = <ident> | <function-block>
const unknownUrlModifierConsumer: TryConsumer<UnknownUrlModifierValue> =
  oneOf(
    [
      one(consumeIdent),
      one(consumeFunctionBlock),
    ],
    ([value]) => {
      if (value.type === TokenKind.FunctionBlock) {
        // A recognized request modifier does not become unknown when its arguments fail.
        switch (asciiLower(value.name)) {
          case 'cross-origin':
          case 'integrity':
          case 'referrer-policy':
            return null;
        }

        if (!isAnyValueContents(value.value)) return null;
      }

      return value;
    },
  );

// <url-modifier> = <request-url-modifier> | <unknown-url-modifier>
const urlModifierConsumer = oneOf(
  [
    one(requestUrlModifierConsumer),
    one(unknownUrlModifierConsumer),
  ],
  ([value]) => value,
);

const urlModifierParser = createComponentParser(withTrivia(urlModifierConsumer));
