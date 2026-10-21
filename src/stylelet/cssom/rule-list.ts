import { arg, defineInterface, idlType, impl, indexedGetter, nullable, op, reference, roAttr } from '../../web-idl/core/index';

import type { CSSRuleImpl } from './rule';

/** Retain the live rule sequence; Binding owns its indexed platform properties. */
// https://drafts.csswg.org/cssom/#the-cssrulelist-interface
export class CSSRuleListImpl {
  /** Rules in source order; the sheet or grouping rule maintains their parent links. */
  #rules: CSSRuleImpl[] = [];

  /** Retain an initial sequence without changing the rules' associations. */
  constructor(rules: CSSRuleImpl[] = []) {
    this.replace(rules);
  }

  /** Current number of rules in the sequence. */
  // https://drafts.csswg.org/cssom/#dom-cssrulelist-length
  get length(): number {
    return this.#rules.length;
  }

  /** Return the rule at an index, or null outside the sequence. */
  // https://drafts.csswg.org/cssom/#dom-cssrulelist-item
  item(index: number): CSSRuleImpl | null {
    return this.#rules[index] ?? null;
  }

  /** Iterate the retained rule implementations in source order. */
  [Symbol.iterator](): ArrayIterator<CSSRuleImpl> {
    return this.#rules[Symbol.iterator]();
  }

  /** Retain a new rule sequence while preserving this list's identity. */
  replace(rules: CSSRuleImpl[]): void {
    this.#rules = rules;
  }

  /** Insert a rule after the owner has checked its index, placement, and associations. */
  insert(index: number, rule: CSSRuleImpl): void {
    this.#rules.splice(index, 0, rule);
  }

  /** Remove the rule at an index already checked by the owner. */
  remove(index: number): void {
    this.#rules.splice(index, 1);
  }

  /** Enumerate the currently supported indexed properties. */
  getSupportedPropertyIndices(): Iterable<number> {
    return this.#rules.keys();
  }
}

/*
 * [Exposed=Window]
 * interface CSSRuleList {
 *   getter CSSRule? item(unsigned long index);
 *   readonly attribute unsigned long length;
 * };
 */
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
