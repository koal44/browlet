import { type StyleBlock, type StyleRule } from '../css/stylesheet';
import { CSSStyleDeclarationImpl } from './declaration';
import { CSSRuleListImpl } from './rule-list';

export class SelectletCSSStyleRule implements CSSStyleRule {
  readonly STYLE_RULE = 1 as const;
  readonly CHARSET_RULE = 2 as const;
  readonly IMPORT_RULE = 3 as const;
  readonly MEDIA_RULE = 4 as const;
  readonly FONT_FACE_RULE = 5 as const;
  readonly PAGE_RULE = 6 as const;
  readonly KEYFRAMES_RULE = 7 as const;
  readonly KEYFRAME_RULE = 8 as const;
  readonly MARGIN_RULE = 9 as const;
  readonly NAMESPACE_RULE = 10 as const;
  readonly COUNTER_STYLE_RULE = 11 as const;
  readonly SUPPORTS_RULE = 12 as const;
  readonly FONT_FEATURE_VALUES_RULE = 14 as const;

  selectorText = '';

  private _style: CSSStyleDeclarationImpl;
  private _cssRules = new CSSRuleListImpl();

  constructor(rule?: StyleRule) {
    this._style = new CSSStyleDeclarationImpl({
      declarations: declarationBlock(rule?.block),
      parentRule: this,
      onChange: (declarations) => {
        if (rule) rule.block = [...declarations];
      },
    });
  }

  get cssRules(): CSSRuleList {
    return this._cssRules;
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

  get parentStyleSheet(): CSSStyleSheet | null {
    return null;
  }

  get type(): number {
    return 1;
  }

  get style(): CSSStyleDeclaration {
    return this._style;
  }

  get styleMap(): StylePropertyMap {
    return notImplemented('CSSStyleRule.styleMap');
  }
}

function declarationBlock(block?: StyleBlock) {
  return block?.filter((item) => item.type === 'property-declaration') ?? [];
}

function notImplemented(name: string): never {
  throw new Error(`${name} is not implemented`);
}
