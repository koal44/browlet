import { TypeError, asciiLower, isAsciiWhitespace } from '../../infra/index';
import {
  arg, attr, defineInterface, idlType, impl, indexedGetter, iter, nullable, op, roAttr, xattr,
  DOMExceptionImpl, DOMExceptionNames,
} from '../../web-idl/core/index';

import { parseOrderedSet } from './infra/index';
import type { ElementImpl } from './nodes/index';

/** Shared attribute definition used by internal callers and reflected token-list bindings. */
export type TokenListAttribute = {
  name: string;
  /** Lowercase supported tokens; null means no supported-token set is defined. */
  supportedTokens: ReadonlySet<string> | null;
};

/** An ordered token set kept in sync with one element's null-namespace attribute. */
// https://dom.spec.whatwg.org/#interface-domtokenlist
export class DOMTokenListImpl {
  /** Element whose ordinary attribute mutation path owns every write. */
  #element: ElementImpl;
  /** Attribute local name, fixed for the lifetime of this list. */
  #attributeName: string;
  /** Unique tokens in attribute order, stored as an array for direct indexed access. */
  #tokens: string[] = [];
  /** Lowercase supported tokens supplied by the consuming specification; null means undefined. */
  #supportedTokens: ReadonlySet<string> | null;

  constructor(element: ElementImpl, attributeName: string, supportedTokens: ReadonlySet<string> | null = null) {
    this.#element = element;
    this.#attributeName = attributeName;
    this.#supportedTokens = supportedTokens;
    this.updateTokens(element.getAttributeNS(null, attributeName));
  }

  /** Number of distinct tokens in the associated attribute. */
  // https://dom.spec.whatwg.org/#dom-domtokenlist-length
  get length(): number {
    return this.#tokens.length;
  }

  /** Raw attribute spelling; token operations alone normalize whitespace and duplicates. */
  // https://dom.spec.whatwg.org/#dom-domtokenlist-value
  get value(): string {
    return this.#element.getAttributeNS(null, this.#attributeName) ?? '';
  }

  set value(value: string) {
    this.#element.setAttributeValue(this.#attributeName, value);
  }

  /** Return a token by position, or null outside the set. */
  // https://dom.spec.whatwg.org/#dom-domtokenlist-item
  item(index: number): string | null {
    return this.#tokens[index] ?? null;
  }

  /** Test exact token membership without applying mutation syntax checks. */
  // https://dom.spec.whatwg.org/#dom-domtokenlist-contains
  contains(token: string): boolean {
    return this.#tokens.includes(token);
  }

  /** Validate every input before appending new tokens in argument order. */
  // https://dom.spec.whatwg.org/#dom-domtokenlist-add
  add(...tokens: string[]): void {
    for (const token of tokens) validateToken(token);
    for (const token of tokens) {
      if (!this.#tokens.includes(token)) this.#tokens.push(token);
    }
    this.#update();
  }

  /** Validate every input before removing tokens, preserving the remaining order. */
  // https://dom.spec.whatwg.org/#dom-domtokenlist-remove
  remove(...tokens: string[]): void {
    for (const token of tokens) validateToken(token);
    for (const token of tokens) {
      const index = this.#tokens.indexOf(token);
      if (index !== -1) this.#tokens.splice(index, 1);
    }
    this.#update();
  }

  /** Change membership unless force already agrees with it; return the resulting membership. */
  // https://dom.spec.whatwg.org/#dom-domtokenlist-toggle
  toggle(token: string, force?: boolean): boolean {
    validateToken(token);
    const index = this.#tokens.indexOf(token);
    if (index !== -1) {
      if (force === true) return true;
      this.#tokens.splice(index, 1);
      this.#update();
      return false;
    }
    if (force === false) return false;
    this.#tokens.push(token);
    this.#update();
    return true;
  }

  /** Replace a present token, merging duplicates at the earlier of their positions. */
  // https://dom.spec.whatwg.org/#dom-domtokenlist-replace
  replace(token: string, newToken: string): boolean {
    // Both empty-string checks precede either whitespace check.
    if (token === '' || newToken === '') throw new DOMExceptionImpl('', DOMExceptionNames.syntax);
    validateToken(token);
    validateToken(newToken);
    const index = this.#tokens.indexOf(token);
    if (index === -1) return false;
    const replacementIndex = this.#tokens.indexOf(newToken);
    if (replacementIndex === -1) {
      this.#tokens[index] = newToken;
    } else if (replacementIndex !== index) {
      this.#tokens[Math.min(index, replacementIndex)] = newToken;
      this.#tokens.splice(Math.max(index, replacementIndex), 1);
    }
    this.#update();
    return true;
  }

  /** Check the consuming specification's supported tokens, independently of current membership. */
  // https://dom.spec.whatwg.org/#dom-domtokenlist-supports
  // https://dom.spec.whatwg.org/#concept-domtokenlist-validation
  supports(token: string): boolean {
    if (this.#supportedTokens === null) throw new TypeError('This attribute has no supported tokens');
    return this.#supportedTokens.has(asciiLower(token));
  }

  /** Synchronize tokens from the selected attribute's current value; null clears the list. */
  updateTokens(value: string | null): void {
    this.#tokens = value === null ? [] : [...parseOrderedSet(value)];
  }

  /** Live indexed properties supplied to Web IDL; authors iterate through those properties. */
  getSupportedPropertyIndices(): Iterable<number> {
    return this.#tokens.keys();
  }

  // https://dom.spec.whatwg.org/#concept-dtl-update
  #update(): void {
    // SPEC_CLASH(domtokenlist-empty-add): Follow DOM/WebKit; Chromium/Firefox create an absent attribute for add().
    if (this.#tokens.length === 0 && !this.#element.hasAttributeNS(null, this.#attributeName)) return;
    this.#element.setAttributeValue(this.#attributeName, this.#tokens.join(' '));
  }
}

/*
 * [Exposed=Window]
 * interface DOMTokenList {
 *   readonly attribute unsigned long length;
 *   getter DOMString? item(unsigned long index);
 *   boolean contains(DOMString token);
 *   [CEReactions] undefined add(DOMString... tokens);
 *   [CEReactions] undefined remove(DOMString... tokens);
 *   [CEReactions] boolean toggle(DOMString token, optional boolean force);
 *   [CEReactions] boolean replace(DOMString token, DOMString newToken);
 *   boolean supports(DOMString token);
 *   [CEReactions] stringifier attribute DOMString value;
 *   iterable<DOMString>;
 * };
 */
export const domTokenListIDL = defineInterface({
  name: 'DOMTokenList', exposed: 'Window', implementation: impl(DOMTokenListImpl),
  members: [
    roAttr('length', idlType.unsignedLong),
    op('item', nullable(idlType.DOMString),
      [arg('index', idlType.unsignedLong)],
      indexedGetter((list: DOMTokenListImpl) => list.getSupportedPropertyIndices(), { unsupportedValue: null }),
    ),
    op('contains', idlType.boolean, [arg('token', idlType.DOMString)]),
    op('add', idlType.undefined,
      [arg('tokens', idlType.DOMString, { variadic: true })], xattr('CEReactions'),
    ),
    op('remove', idlType.undefined,
      [arg('tokens', idlType.DOMString, { variadic: true })], xattr('CEReactions'),
    ),
    op('toggle', idlType.boolean,
      [arg('token', idlType.DOMString), arg('force', idlType.boolean, { optional: true })], xattr('CEReactions'),
    ),
    op('replace', idlType.boolean,
      [arg('token', idlType.DOMString), arg('newToken', idlType.DOMString)], xattr('CEReactions'),
    ),
    op('supports', idlType.boolean, [arg('token', idlType.DOMString)]),
    attr('value', idlType.DOMString, { stringifier: true, ...xattr('CEReactions') }),
    iter(idlType.DOMString),
  ],
});

/** Shared syntax checks from add, remove, toggle, and replace. */
function validateToken(token: string): void {
  if (token === '') throw new DOMExceptionImpl('', DOMExceptionNames.syntax);
  for (let index = 0; index < token.length; index++) {
    if (isAsciiWhitespace(token.charCodeAt(index))) {
      throw new DOMExceptionImpl('', DOMExceptionNames.invalidCharacter);
    }
  }
}
