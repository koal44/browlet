import { asciiLower } from '../../shared/css';
import { type ComponentCursor, type TryComponentConsumer, type TryComponentConsumerResult } from '../parser/component-cursor';
import {
  createFunctionalNotationConsumer,
  tryConsumeFunctionBlock,
} from '../parser/component-consumers';
import { one, oneOf, withTrivia } from '../parser/component-grammar';
import {
  isFunctionBlock, parseAsComponentGrammar,
  type FunctionBlock, type ParserInput,
} from '../parser/syntax';
import { isAnyValueContents } from './any-value';
import { tryConsumeIdent, type IdentValue } from './ident';
import { createKeywordConsumer } from './keyword';
import { serializeCssString, tryConsumeString } from './string';

/*
 * NOTE: The URL modifier grammar is a provisional synthesis, not a verbatim
 * grammar from one specification. CSSWG issue #12151 develops the recognized
 * request-modifier grammar, while issue #1603 requires unknown modifiers to be
 * ignored. The explicit <unknown-url-modifier> arm lets the URL grammar consume
 * and later discard those unknown values. The oracle scenarios in
 * test/stylelet/browser/oracle.test.ts currently record only partial WebKit support, so
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
  const result = parseAsComponentGrammar(
    input,
    withTrivia(tryConsumeUrlModifier),
    context,
  );

  return result;
}

export function tryConsumeUrlModifier(
  c: ComponentCursor,
): TryComponentConsumerResult<UrlModifierValue> {
  return consumeUrlModifier(c);
}

// <url-modifier> = <request-url-modifier> | <unknown-url-modifier>
const consumeUrlModifier: TryComponentConsumer<UrlModifierValue> = (c) => {
  const start = c.pos();
  const request = tryConsumeRequestUrlModifier(c);

  if (request !== null) return request;

  const component = c.peek();

  if (isFunctionBlock(component)) {
    switch (asciiLower(component.name)) {
      case 'cross-origin':
      case 'integrity':
      case 'referrer-policy':
        return null;
    }
  }

  const unknown = tryConsumeUnknownUrlModifier(c);

  if (unknown === null) {
    c.restore(start);
  }

  return unknown;
};

function tryConsumeRequestUrlModifier(
  c: ComponentCursor,
): TryComponentConsumerResult<RequestUrlModifierValue> {
  return consumeRequestUrlModifier(c);
}

// <request-url-modifier> = <cross-origin-modifier> | <integrity-modifier> | <referrer-policy-modifier>
const consumeRequestUrlModifier: TryComponentConsumer<RequestUrlModifierValue> =
  oneOf(
    [
      one(tryConsumeCrossOriginModifier),
      one(tryConsumeIntegrityModifier),
      one(tryConsumeReferrerPolicyModifier),
    ],
    ([value]) => value,
  );

function tryConsumeUnknownUrlModifier(
  c: ComponentCursor,
): TryComponentConsumerResult<UnknownUrlModifierValue> {
  const result = consumeUnknownUrlModifier(c);

  if (
    result !== null &&
    result.type === 'block' &&
    !isAnyValueContents(result.value)
  ) {
    return null;
  }

  return result;
}

// <unknown-url-modifier> = <ident> | <function-block>
const consumeUnknownUrlModifier: TryComponentConsumer<UnknownUrlModifierValue> =
  oneOf(
    [
      one(tryConsumeIdent),
      one(tryConsumeFunctionBlock),
    ],
    ([value]) => value,
  );

function tryConsumeCrossOriginModifier(
  c: ComponentCursor,
): TryComponentConsumerResult<CrossOriginModifierValue> {
  return consumeCrossOriginModifier(c);
}

// <cross-origin-modifier> = cross-origin(anonymous | use-credentials)
const consumeCrossOriginModifier = createFunctionalNotationConsumer(
  'cross-origin',
  createKeywordConsumer('anonymous', 'use-credentials'),
  (value): CrossOriginModifierValue => ({
    type: 'cross-origin-modifier',
    value,
  }),
);

function tryConsumeIntegrityModifier(
  c: ComponentCursor,
): TryComponentConsumerResult<IntegrityModifierValue> {
  return consumeIntegrityModifier(c);
}

// <integrity-modifier> = integrity(<string>)
const consumeIntegrityModifier = createFunctionalNotationConsumer(
  'integrity',
  tryConsumeString,
  (value): IntegrityModifierValue => ({
    type: 'integrity-modifier',
    value: value.value,
  }),
);

function tryConsumeReferrerPolicyModifier(
  c: ComponentCursor,
): TryComponentConsumerResult<ReferrerPolicyModifierValue> {
  return consumeReferrerPolicyModifier(c);
}

// <referrer-policy-modifier> = referrer-policy(no-referrer | no-referrer-when-downgrade | same-origin | origin | strict-origin | origin-when-cross-origin | strict-origin-when-cross-origin | unsafe-url)
const consumeReferrerPolicyModifier = createFunctionalNotationConsumer(
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
