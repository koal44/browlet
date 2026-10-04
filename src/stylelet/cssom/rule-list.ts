import type { CSSRuleImpl } from './rule';

export class CSSRuleListImpl {
  [index: number]: CSSRuleImpl;

  #rules: CSSRuleImpl[] = [];
  #indexedLength = 0;

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
    this.#updateIndices();
  }

  insert(index: number, rule: CSSRuleImpl): void {
    this.#rules.splice(index, 0, rule);
    this.#updateIndices();
  }

  remove(index: number): void {
    this.#rules.splice(index, 1);
    this.#updateIndices();
  }

  #updateIndices(): void {
    for (let index = 0; index < this.#indexedLength; index++) {
      Reflect.deleteProperty(this, index);
    }

    for (let index = 0; index < this.#rules.length; index++) {
      Object.defineProperty(this, index, {
        configurable: true,
        enumerable: true,
        get: () => this.item(index),
      });
    }

    this.#indexedLength = this.#rules.length;
  }
}
