import { arg, defineInterface, idlType, impl, indexedGetter, nullable, op, reference, roAttr } from '../../web-idl/core/index';

import type { CSSRuleImpl } from './rule';

/** Retain the live rule sequence; Binding owns its indexed platform properties. */
export class CSSRuleListImpl {
  #rules: CSSRuleImpl[] = [];

  constructor(rules: CSSRuleImpl[] = []) {
    this.replace(rules);
  }

  get length(): number {
    return this.#rules.length;
  }

  item(index: number): CSSRuleImpl | null {
    return this.#rules[index] ?? null;
  }

  [Symbol.iterator](): ArrayIterator<CSSRuleImpl> {
    return this.#rules[Symbol.iterator]();
  }

  replace(rules: CSSRuleImpl[]): void {
    this.#rules = rules;
  }

  insert(index: number, rule: CSSRuleImpl): void {
    this.#rules.splice(index, 0, rule);
  }

  remove(index: number): void {
    this.#rules.splice(index, 1);
  }

  /** Enumerate the currently supported indexed properties. */
  getSupportedPropertyIndices(): Iterable<number> {
    return this.#rules.keys();
  }
}

// https://drafts.csswg.org/cssom/#the-cssrulelist-interface
export const cssRuleListIDL = defineInterface({
  name: 'CSSRuleList',
  exposed: 'Window',
  implementation: impl(CSSRuleListImpl),
  members: [
    op('item', nullable(reference('CSSRule')),
      [arg('index', idlType.unsignedLong)],
      indexedGetter((list: CSSRuleListImpl) => list.getSupportedPropertyIndices(), { unsupportedValue: null }),
    ),
    roAttr('length', idlType.unsignedLong),
  ],
});
