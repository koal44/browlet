import { attr, constant, defineInterface, idlType, impl, integer, nullable, reference, roAttr } from '../../web-idl/core/index';

import type { StyleletEnvironment } from '../environment';

import type { CSSStyleSheetImpl } from './css-stylesheet';

/** Common state and contract for CSS rule implementations. */
export abstract class CSSRuleImpl {
  parentRule: CSSRuleImpl | null = null;
  parentStyleSheet: CSSStyleSheetImpl | null = null;
  abstract type: number;

  protected env: StyleletEnvironment;

  constructor(env: StyleletEnvironment) {
    this.env = env;
  }

  abstract get cssText(): string;
  abstract set cssText(value: string);

  /** Associate this rule with its containing sheet, or detach it from that sheet. */
  setParentStyleSheet(sheet: CSSStyleSheetImpl | null): void {
    this.parentStyleSheet = sheet;
  }
}

// https://drafts.csswg.org/cssom/#the-cssrule-interface
export const cssRuleIDL = defineInterface({
  name: 'CSSRule',
  exposed: 'Window',
  implementation: impl(CSSRuleImpl),
  members: [
    attr('cssText', reference('CSSOMString')),
    roAttr('parentRule', nullable(reference(CSSRuleImpl))),
    roAttr('parentStyleSheet', nullable(reference('CSSStyleSheet'))),
    roAttr('type', idlType.unsignedShort),
    constant('STYLE_RULE', idlType.unsignedShort, integer(1)),
    constant('CHARSET_RULE', idlType.unsignedShort, integer(2)),
    constant('IMPORT_RULE', idlType.unsignedShort, integer(3)),
    constant('MEDIA_RULE', idlType.unsignedShort, integer(4)),
    constant('FONT_FACE_RULE', idlType.unsignedShort, integer(5)),
    constant('PAGE_RULE', idlType.unsignedShort, integer(6)),
    constant('MARGIN_RULE', idlType.unsignedShort, integer(9)),
    constant('NAMESPACE_RULE', idlType.unsignedShort, integer(10)),
    // CSSRule partial contributions share this primary implementation.
    // https://drafts.csswg.org/css-animations-1/#interface-cssrule-idl
    constant('KEYFRAMES_RULE', idlType.unsignedShort, integer(7)),
    constant('KEYFRAME_RULE', idlType.unsignedShort, integer(8)),
    // https://drafts.csswg.org/css-counter-styles-3/#extensions-to-cssrule-interface
    constant('COUNTER_STYLE_RULE', idlType.unsignedShort, integer(11)),
    // https://drafts.csswg.org/css-conditional-3/#extensions-to-cssrule-interface
    constant('SUPPORTS_RULE', idlType.unsignedShort, integer(12)),
    // https://drafts.csswg.org/css-fonts-4/#om-fontfeaturevalues
    constant('FONT_FEATURE_VALUES_RULE', idlType.unsignedShort, integer(14)),
  ],
});
