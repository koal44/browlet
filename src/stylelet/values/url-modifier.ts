import { asciiLower } from '../../infra/ascii';
import { referrerPolicyValues, type ReferrerPolicy } from '../../fetch/core/index';

import {
  createKeywordConsumer, createFunctionalNotationConsumer, consumeFunctionBlock, one, oneOf, withTrivia, createComponentParser,
  isAnyValueContents, serializeCssString, serializeComponentValues, TokenKind,
  type TokenCursor, type TryConsumer, type TryConsumerResult, type FunctionBlock, type ParserInput,
} from '../syntax/index';
import type { ValueStage } from '../value-processing/index';

import type { Value } from './value';
import { IdentValue } from './ident';
import { StringValue } from './string';

/** A recognized request modifier or an opaque modifier retained during URL parsing. */
export class UrlModifierValue<R extends UrlModifier = UrlModifier> implements Value {
  /** The decoded request option or unknown identifier/function syntax. */
  repr: R;

  constructor(value: R) {
    this.repr = value;
  }

  /** Parse one complete URL modifier. */
  static parse(input: ParserInput, context: unknown): UrlModifierValue | null {
    return urlModifierParser(input, context);
  }

  /** Consume one recognized or unknown modifier. */
  static consume(this: void, c: TokenCursor): TryConsumerResult<UrlModifierValue> {
    return urlModifierConsumer(c);
  }

  /** URL request options have no contextual value conversion. */
  resolve(_stage: ValueStage, _context: unknown): UrlModifierValue<R> {
    return this;
  }

  /** Whether this modifier contributes a recognized request option. */
  isRequest(): this is UrlModifierValue<R & RequestUrlModifier> {
    return !(this.repr instanceof IdentValue) && this.repr.type !== TokenKind.FunctionBlock;
  }

  /** Serialize the retained modifier without applying request behavior. */
  serialize(): string {
    const modifier = this.repr;
    return !(modifier instanceof IdentValue) && modifier.type === TokenKind.FunctionBlock
      ? serializeComponentValues([modifier])
      : modifier.serialize();
  }
}

type UrlModifier = RequestUrlModifier | UnknownUrlModifier;
type RequestUrlModifier = CrossOriginModifier | IntegrityModifier | ReferrerPolicyModifier;
type UnknownUrlModifier = IdentValue | FunctionBlock;

export type RequestUrlModifiers = {
  crossOrigin?: CrossOriginModifier;
  integrity?: IntegrityModifier;
  referrerPolicy?: ReferrerPolicyModifier;
};

/** The credentials mode requested by cross-origin(). */
class CrossOriginModifier {
  /** The recognized credentials modifier kind. */
  type = 'cross-origin-modifier' as const;
  /** Whether the request includes credentials across origins. */
  value: 'anonymous' | 'use-credentials';

  constructor(value: CrossOriginModifier['value']) {
    this.value = value;
  }

  /** Retain this option on the enclosing URL, rejecting a duplicate. */
  applyTo(modifiers: RequestUrlModifiers): boolean {
    if (modifiers.crossOrigin !== undefined) return false;
    modifiers.crossOrigin = this;
    return true;
  }

  serialize(): string {
    return `cross-origin(${this.value})`;
  }
}

/** The integrity metadata requested by integrity(). */
class IntegrityModifier {
  /** The recognized integrity modifier kind. */
  type = 'integrity-modifier' as const;
  /** Decoded integrity metadata, before CSS string escaping. */
  value: string;

  constructor(value: string) {
    this.value = value;
  }

  /** Retain this option on the enclosing URL, rejecting a duplicate. */
  applyTo(modifiers: RequestUrlModifiers): boolean {
    if (modifiers.integrity !== undefined) return false;
    modifiers.integrity = this;
    return true;
  }

  serialize(): string {
    return `integrity(${serializeCssString(this.value)})`;
  }
}

/** The policy requested by referrer-policy(). */
class ReferrerPolicyModifier {
  /** The recognized referrer-policy modifier kind. */
  type = 'referrer-policy-modifier' as const;
  /** The policy keyword controlling the request's referrer. */
  value: Exclude<ReferrerPolicy, ''>;

  constructor(value: Exclude<ReferrerPolicy, ''>) {
    this.value = value;
  }

  /** Retain this option on the enclosing URL, rejecting a duplicate. */
  applyTo(modifiers: RequestUrlModifiers): boolean {
    if (modifiers.referrerPolicy !== undefined) return false;
    modifiers.referrerPolicy = this;
    return true;
  }

  serialize(): string {
    return `referrer-policy(${this.value})`;
  }
}

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

// <cross-origin-modifier> = cross-origin(anonymous | use-credentials)
const crossOriginModifierConsumer = createFunctionalNotationConsumer(
  'cross-origin',
  createKeywordConsumer('anonymous', 'use-credentials'),
  (value) => new CrossOriginModifier(value),
);

// <integrity-modifier> = integrity(<string>)
const integrityModifierConsumer = createFunctionalNotationConsumer(
  'integrity',
  StringValue.consume,
  (value) => new IntegrityModifier(value.repr),
);

// <referrer-policy-modifier> = referrer-policy(no-referrer | no-referrer-when-downgrade | same-origin | origin | strict-origin | origin-when-cross-origin | strict-origin-when-cross-origin | unsafe-url)
const [, ...referrerPolicyKeywords] = referrerPolicyValues;
const referrerPolicyModifierConsumer = createFunctionalNotationConsumer(
  'referrer-policy',
  createKeywordConsumer(...referrerPolicyKeywords),
  (value) => new ReferrerPolicyModifier(value),
);

// <request-url-modifier> = <cross-origin-modifier> | <integrity-modifier> | <referrer-policy-modifier>
const requestUrlModifierConsumer: TryConsumer<RequestUrlModifier> =
  oneOf(
    [
      one(crossOriginModifierConsumer),
      one(integrityModifierConsumer),
      one(referrerPolicyModifierConsumer),
    ],
    ([value]) => value,
  );

// <unknown-url-modifier> = <ident> | <function-block>
const unknownUrlModifierConsumer: TryConsumer<UnknownUrlModifier> =
  oneOf(
    [
      one(IdentValue.consume),
      one(consumeFunctionBlock),
    ],
    ([value]) => {
      if (!(value instanceof IdentValue)) {
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
  ([value]) => new UrlModifierValue(value),
);

const urlModifierParser = createComponentParser(withTrivia(urlModifierConsumer));
