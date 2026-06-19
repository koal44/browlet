import type { Stylesheet } from '../parser/types';

export class SelectletCSSRuleList implements CSSRuleList {
  [index: number]: CSSRule;

  private readonly rules: CSSRule[];

  constructor(rules: CSSRule[] = []) {
    this.rules = rules;

    for (let i = 0; i < rules.length; i++) {
      this[i] = rules[i];
    }
  }

  get length(): number {
    return this.rules.length;
  }

  item(index: number): CSSRule | null {
    return this.rules[index] ?? null;
  }

  [Symbol.iterator](): ArrayIterator<CSSRule> {
    return this.rules[Symbol.iterator]();
  }
}

export function buildCSSRuleList(_sheet: Stylesheet): SelectletCSSRuleList {
  return new SelectletCSSRuleList();
}
