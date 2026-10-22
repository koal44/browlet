import { InternalError } from '../../infra/internal-error';

import type { StyleletURL, StyleletURLConstructor } from '../environment';
import {
  createFunctionalNotationConsumer, consumeUrlToken, any, one, oneOf, adaptConsumer, sequenceOf, withTrivia,
  createComponentParser, serializeCssString, serializeCssFunction,
  type TokenCursor, type TryConsumer, type TryConsumerResult, type ParserInput,
} from '../syntax/index';
import { ValueStage } from '../value-processing/index';
import type { TreeScope } from '../engine/index';

import type { Value } from './value';
import { StringValue } from './string';
import { UrlModifierValue, type RequestUrlModifiers } from './url-modifier';

/** A URL and request modifiers retaining their declaration's local-fragment provenance. */
// https://drafts.csswg.org/css-values-4/#urls
export class UrlValue<Representation extends Url = Url> implements Value<UrlContext> {
  /** The URL text, notation, modifiers, and any captured local tree scope. */
  value: Representation;

  constructor(value: Representation) {
    this.value = value;
  }

  /** Parse a complete url() or src() value. */
  static parse(input: ParserInput, context: unknown): UrlValue | null {
    return urlParser(input, context);
  }

  /** Consume a URL without resolving against a base URL. */
  static consume(this: void, c: TokenCursor): TryConsumerResult<UrlValue> {
    return urlConsumer(c);
  }

  /** Construct an interpreted URL and identify local fragment syntax. */
  static fromString(notation: UrlNotation, href: string, modifiers: RequestUrlModifiers): UrlValue {
    return new UrlValue({ notation, href, modifiers, ...(href.startsWith('#') ? { local: true as const } : {}) });
  }

  /** Capture local scope from the specified stage; resolve other URLs from the computed stage. */
  resolve(stage: ValueStage, context: UrlContext = {}): UrlValue {
    const url = this.value;
    if (url.local === true) {
      return stage < ValueStage.Specified || url.treeScope !== undefined || context.treeScope === undefined
        ? this : new UrlValue({ ...url, treeScope: context.treeScope });
    }
    if (stage < ValueStage.Computed || url.href === '') return this;
    const URL = context.URL;
    if (URL === undefined) throw new InternalError('URL resolution requires a host URL constructor');
    try {
      const href = new URL(url.href, context.baseUrl?.href).href;
      return href === url.href ? this : new UrlValue({ ...url, href });
    } catch {
      // A URL that cannot be made absolute retains its specified value.
      return this;
    }
  }

  /** Serialize the retained URL and modifiers without resolving against a new base. */
  // https://drafts.csswg.org/cssom/#serialize-a-url
  // CSS Values extends URL notation with src() and request modifiers.
  serialize(): string {
    const url = this.value;
    const { crossOrigin, integrity, referrerPolicy } = url.modifiers;
    let args = serializeCssString(url.href);
    // CSS Values 4 section 9.1 and CSSWG issue #12151 use grammar order.
    if (crossOrigin !== undefined) args += ` ${crossOrigin.serialize()}`;
    if (integrity !== undefined) args += ` ${integrity.serialize()}`;
    if (referrerPolicy !== undefined) args += ` ${referrerPolicy.serialize()}`;
    return serializeCssFunction(url.notation, args);
  }
}

type Url = {
  notation: UrlNotation;
  href: string;
  modifiers: RequestUrlModifiers;
  // Fragment-only URLs carry this flag before their scope is known.
  local?: true;
  // Captured declaration provenance for local URL matching.
  treeScope?: TreeScope;
};

export type UrlNotation = 'url' | 'src';

export type UrlContext = {
  /** Required when computing a nonempty URL without the local fragment flag. */
  URL?: StyleletURLConstructor;
  baseUrl?: StyleletURL;
  treeScope?: TreeScope;
};

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

// Shared arguments for url() and src(); unknown modifiers do not become request options.
const urlArgumentsConsumer = sequenceOf(
  [one(StringValue.consume), any(withTrivia(UrlModifierValue.consume))],
  ([[string], values]) => {
    const modifiers: RequestUrlModifiers = {};
    for (const modifier of values) {
      if (modifier.isRequest() && !modifier.value.applyTo(modifiers)) return null;
    }
    return { href: string.value, modifiers };
  },
);

// <url-token>
const urlTokenValueConsumer: TryConsumer<UrlValue> = adaptConsumer(
  consumeUrlToken,
  (component) => UrlValue.fromString('url', component.value, {}),
);

// <src()> = src( <string> <url-modifier>* )
const srcFnConsumer = createFunctionalNotationConsumer(
  'src',
  urlArgumentsConsumer,
  ({ href, modifiers }) => UrlValue.fromString('src', href, modifiers),
);

// <url()> = url( <string> <url-modifier>* ) | <url-token>
const urlFnConsumer: TryConsumer<UrlValue> = oneOf(
  [
    one(createFunctionalNotationConsumer(
      'url',
      urlArgumentsConsumer,
      ({ href, modifiers }) => UrlValue.fromString('url', href, modifiers),
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
