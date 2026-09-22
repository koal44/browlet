import { type StyleBlock, type StyleRule } from '../css/stylesheet';
import type { ExecutionCaps } from '../stylelet';
import { CSSStyleDeclarationImpl } from './declaration';
import { CSSRuleListImpl } from './rule-list';
import { InternalError } from '../../infra/internal-error';

export class CSSStyleRuleImpl implements CSSStyleRule {
  STYLE_RULE = 1 as const;
  CHARSET_RULE = 2 as const;
  IMPORT_RULE = 3 as const;
  MEDIA_RULE = 4 as const;
  FONT_FACE_RULE = 5 as const;
  PAGE_RULE = 6 as const;
  KEYFRAMES_RULE = 7 as const;
  KEYFRAME_RULE = 8 as const;
  MARGIN_RULE = 9 as const;
  NAMESPACE_RULE = 10 as const;
  COUNTER_STYLE_RULE = 11 as const;
  SUPPORTS_RULE = 12 as const;
  FONT_FEATURE_VALUES_RULE = 14 as const;

  selectorText = '';

  #style: CSSStyleDeclarationImpl;
  #cssRules = new CSSRuleListImpl();

  constructor(rule: StyleRule | undefined, exec: ExecutionCaps) {
    this.#style = new CSSStyleDeclarationImpl({
      declarations: declarationBlock(rule?.block),
      parentRule: this,
      onChange: (declarations) => {
        if (rule) rule.block = [...declarations];
      },
    }, exec);
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

  get parentRule(): CSSRule | null {
    return null;
  }

  get parentStyleSheet(): null {
    return null;
  }

  get type(): number {
    return 1;
  }

  get style(): CSSStyleDeclarationImpl {
    return this.#style;
  }

  get styleMap(): StylePropertyMap {
    return notImplemented('CSSStyleRule.styleMap');
  }
}

function declarationBlock(block?: StyleBlock) {
  return block?.filter((item) => item.type === 'property-declaration') ?? [];
}

function notImplemented(name: string): never {
  throw new InternalError(`${name} is not implemented`);
}
