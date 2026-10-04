import { type StyleBlock, type StyleRule } from '../css/stylesheet';
import type { StyleletEnvironment } from '../environment';
import { CSSStyleDeclarationImpl } from './declaration';
import { CSSRuleListImpl } from './rule-list';
import { CSSRuleImpl } from './rule';
import type { StylePropertyMapImpl } from './style-property-map';
import { InternalError } from '../../infra/internal-error';

export class CSSStyleRuleImpl extends CSSRuleImpl {
  selectorText = '';

  #style: CSSStyleDeclarationImpl;
  #cssRules = new CSSRuleListImpl();

  constructor(rule: StyleRule | undefined, env: StyleletEnvironment) {
    super();
    this.#style = new CSSStyleDeclarationImpl({
      declarations: declarationBlock(rule?.block),
      parentRule: this,
      onChange: (declarations) => {
        if (rule) rule.block = [...declarations];
      },
    }, env);
  }

  get cssRules(): CSSRuleListImpl {
    return this.#cssRules;
  }

  insertRule(_rule: string, _index?: number): number {
    return notImplemented('CSSStyleRule.insertRule');
  }

  deleteRule(_index: number): void {
    return notImplemented('CSSStyleRule.deleteRule');
  }

  get cssText(): string {
    return notImplemented('CSSStyleRule.cssText');
  }

  set cssText(_value: string) {
    notImplemented('CSSStyleRule.cssText');
  }

  get type(): number {
    return 1;
  }

  get style(): CSSStyleDeclarationImpl {
    return this.#style;
  }

  get styleMap(): StylePropertyMapImpl {
    return notImplemented('CSSStyleRule.styleMap');
  }
}

function declarationBlock(block?: StyleBlock) {
  return block?.filter((item) => item.type === 'property-declaration') ?? [];
}

function notImplemented(name: string): never {
  throw new InternalError(`${name} is not implemented`);
}
