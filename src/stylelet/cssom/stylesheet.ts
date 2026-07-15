import { parseStylesheet } from '../parser/ast';
import { type StyleSheetAst } from '../parser/types';
import { notImplemented } from '../util';
import { SelectletCSSRuleList } from './rule-list';
import { SelectletCSSStyleRule } from './rules';

export class SelectletCSSStyleSheet implements CSSStyleSheet {
  private _source = '';
  private _rules = new SelectletCSSRuleList();
  constructor(source = '') {
    if (source) {
      this.replaceSync(source);
    }
  }

  get source(): string {
    return this._source;
  }

  get cssRules(): CSSRuleList {
    return this._rules;
  }

  get rules(): CSSRuleList {
    return this._rules;
  }

  get ownerRule(): CSSRule | null {
    return null;
  }

  get disabled(): boolean {
    return false;
  }

  set disabled(_value: boolean) {
    notImplemented('CSSStyleSheet.disabled');
  }

  get href(): string | null {
    return null;
  }

  get media(): MediaList {
    return notImplemented('CSSStyleSheet.media');
  }

  get ownerNode(): Element | ProcessingInstruction | null {
    return null;
  }

  get parentStyleSheet(): CSSStyleSheet | null {
    return null;
  }

  get title(): string | null {
    return null;
  }

  get type(): string {
    return 'text/css';
  }

  replaceSync(source: string): void {
    this._source = source;

    const sheet = parseStylesheet(source);
    this._rules = buildCSSRuleList(sheet);
  }

  replace(_source: string): Promise<CSSStyleSheet> {
    return notImplemented('CSSStyleSheet.replace');
  }

  insertRule(_rule: string, _index?: number): number {
    return notImplemented('CSSStyleSheet.insertRule');
  }

  deleteRule(_index: number): void {
    return notImplemented('CSSStyleSheet.deleteRule');
  }

  addRule(_selector?: string, _style?: string, _index?: number): number {
    return notImplemented('CSSStyleSheet.addRule');
  }

  removeRule(_index?: number): void {
    return notImplemented('CSSStyleSheet.removeRule');
  }
}

function buildCSSRuleList(sheet: StyleSheetAst): SelectletCSSRuleList {
  return new SelectletCSSRuleList(
    sheet.rules.map((rule) => new SelectletCSSStyleRule(rule)),
  );
}
