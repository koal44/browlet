import type { ComponentCursor } from '../parser/component-cursor';
import {
  createFunctionalNotationConsumer,
  tryConsumeFunctionBlock,
} from '../parser/component-consumers';
import { one, oneOf, withComponentTrivia } from '../parser/component-grammar';
import {
  bad, ComponentConsumerBadReason, isBad, ok, type TryComponentConsumer,
  type TryComponentConsumerResult,
} from '../parser/component-try-consumer';
import { parseAsComponentGrammar, type FunctionBlock, type ParserInput } from '../parser/syntax';
import { isAnyValue } from './any-value';
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
 */
export type UrlModifierValue =
  | RequestUrlModifierValue
  | UnknownUrlModifierValue;

export function parseUrlModifier(
  input: ParserInput,
  context: unknown = undefined,
): UrlModifierValue | null {
  const result = parseAsComponentGrammar(
    input,
    withComponentTrivia(tryConsumeUrlModifier),
    context,
  );

  return result === null || isBad(result) ? null : result.value;
}

export function tryConsumeUrlModifier(
  c: ComponentCursor,
): TryComponentConsumerResult<UrlModifierValue> {
  return consumeUrlModifier(c);
}

const consumeUrlModifier: TryComponentConsumer<UrlModifierValue> = oneOf(
  [
    one(tryConsumeRequestUrlModifier),
    one(tryConsumeUnknownUrlModifier),
  ],
  ([value]) => ok(value),
);

/*
 * <request-url-modifier> = <cross-origin-modifier>
 *                        | <integrity-modifier>
 *                        | <referrer-policy-modifier>
 */
export type RequestUrlModifierValue =
  | CrossOriginModifierValue
  | IntegrityModifierValue
  | ReferrerPolicyModifierValue;

export type RequestUrlModifiers = {
  crossOrigin?: CrossOriginModifierValue;
  integrity?: IntegrityModifierValue;
  referrerPolicy?: ReferrerPolicyModifierValue;
};

function tryConsumeRequestUrlModifier(
  c: ComponentCursor,
): TryComponentConsumerResult<RequestUrlModifierValue> {
  return consumeRequestUrlModifier(c);
}

const consumeRequestUrlModifier: TryComponentConsumer<RequestUrlModifierValue> =
  oneOf(
    [
      one(tryConsumeCrossOriginModifier),
      one(tryConsumeIntegrityModifier),
      one(tryConsumeReferrerPolicyModifier),
    ],
    ([value]) => ok(value),
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

/*
 * <unknown-url-modifier> = <ident> | <function-block>
 *
 * <function-block> is the component-value representation of functional
 * notation.
 */
export type UnknownUrlModifierValue = IdentValue | FunctionBlock;

function tryConsumeUnknownUrlModifier(
  c: ComponentCursor,
): TryComponentConsumerResult<UnknownUrlModifierValue> {
  const result = consumeUnknownUrlModifier(c);

  if (
    result !== null &&
    !isBad(result) &&
    'block' in result.value &&
    result.value.value.length > 0 &&
    !isAnyValue(result.value.value)
  ) {
    return bad(
      ComponentConsumerBadReason.Invalid,
      `Invalid component value in ${result.value.name}() arguments`,
    );
  }

  return result;
}

const consumeUnknownUrlModifier: TryComponentConsumer<UnknownUrlModifierValue> =
  oneOf(
    [
      one(tryConsumeIdent),
      one(tryConsumeFunctionBlock),
    ],
    ([value]) => ok(value),
  );

/*
 * <cross-origin-modifier> = cross-origin(anonymous | use-credentials)
 */
export type CrossOriginModifierValue = {
  type: 'cross-origin-modifier';
  value: 'anonymous' | 'use-credentials';
};

function tryConsumeCrossOriginModifier(
  c: ComponentCursor,
): TryComponentConsumerResult<CrossOriginModifierValue> {
  return consumeCrossOriginModifier(c);
}

const consumeCrossOriginModifier = createFunctionalNotationConsumer(
  'cross-origin',
  tryConsumeCrossOriginArgument,
  (value): CrossOriginModifierValue => ({
    type: 'cross-origin-modifier',
    value,
  }),
);

function tryConsumeCrossOriginArgument(
  c: ComponentCursor,
): TryComponentConsumerResult<CrossOriginModifierValue['value']> {
  return consumeCrossOriginArgument(c);
}

const consumeCrossOriginArgument =
  createKeywordConsumer('anonymous', 'use-credentials');

/*
 * <integrity-modifier> = integrity(<string>)
 */
export type IntegrityModifierValue = {
  type: 'integrity-modifier';
  value: string;
};

function tryConsumeIntegrityModifier(
  c: ComponentCursor,
): TryComponentConsumerResult<IntegrityModifierValue> {
  return consumeIntegrityModifier(c);
}

const consumeIntegrityModifier = createFunctionalNotationConsumer(
  'integrity',
  tryConsumeString,
  (value): IntegrityModifierValue => ({
    type: 'integrity-modifier',
    value: value.value,
  }),
);

/*
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

function tryConsumeReferrerPolicyModifier(
  c: ComponentCursor,
): TryComponentConsumerResult<ReferrerPolicyModifierValue> {
  return consumeReferrerPolicyModifier(c);
}

const consumeReferrerPolicyModifier = createFunctionalNotationConsumer(
  'referrer-policy',
  tryConsumeReferrerPolicyArgument,
  (value): ReferrerPolicyModifierValue => ({
    type: 'referrer-policy-modifier',
    value,
  }),
);

function tryConsumeReferrerPolicyArgument(
  c: ComponentCursor,
): TryComponentConsumerResult<ReferrerPolicy> {
  return consumeReferrerPolicyArgument(c);
}

const REFERRER_POLICIES = [
  'no-referrer',
  'no-referrer-when-downgrade',
  'same-origin',
  'origin',
  'strict-origin',
  'origin-when-cross-origin',
  'strict-origin-when-cross-origin',
  'unsafe-url',
] as const satisfies readonly ReferrerPolicy[];

const consumeReferrerPolicyArgument: TryComponentConsumer<ReferrerPolicy> =
  createKeywordConsumer(...REFERRER_POLICIES);
