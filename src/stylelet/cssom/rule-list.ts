import { RuleKind, type StyleSheetAst } from '../parser/types';
import { SelectletCSSStyleRule } from './rules';

export class SelectletCSSRuleList implements CSSRuleList {
  [index: number]: CSSRule;

  private _rules: CSSRule[];

  constructor(rules: CSSRule[] = []) {
    this._rules = rules;

    for (let i = 0; i < rules.length; i++) {
      this[i] = rules[i];
    }
  }

  get length(): number {
    return this._rules.length;
  }

  item(index: number): CSSRule | null {
    return this._rules[index] ?? null;
  }

  [Symbol.iterator](): ArrayIterator<CSSRule> {
    return this._rules[Symbol.iterator]();
  }
}

export function buildCSSRuleList(sheet: StyleSheetAst): SelectletCSSRuleList {
  const rules: CSSRule[] = [];

  for (const rule of sheet.rules) {
    if (rule.kind === RuleKind.Style) {
      rules.push(new SelectletCSSStyleRule(rule));
    }
  }

  return new SelectletCSSRuleList(rules);
}
