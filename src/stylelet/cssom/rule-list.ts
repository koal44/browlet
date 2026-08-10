export class CSSRuleListImpl implements CSSRuleList {
  [index: number]: CSSRule;

  #rules: CSSRule[] = [];
  #indexedLength = 0;

  constructor(rules: CSSRule[] = []) {
    this.replace(rules);
  }

  get length(): number {
    return this.#rules.length;
  }

  item(index: number): CSSRule | null {
    return this.#rules[index] ?? null;
  }

  [Symbol.iterator](): ArrayIterator<CSSRule> {
    return this.#rules[Symbol.iterator]();
  }

  replace(rules: CSSRule[]): void {
    this.#rules = rules;
    this.updateIndices();
  }

  insert(index: number, rule: CSSRule): void {
    this.#rules.splice(index, 0, rule);
    this.updateIndices();
  }

  remove(index: number): void {
    this.#rules.splice(index, 1);
    this.updateIndices();
  }

  private updateIndices(): void {
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
