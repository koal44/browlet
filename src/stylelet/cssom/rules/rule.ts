import {
  attr, constant, defineInterface, definePartialInterface, idlType, impl, integer, nullable, reference, roAttr,
} from '../../../web-idl/core/index';
import type { URLRecord } from '../../../url/core/index';

import type { StyleletEnvironment } from '../../environment';
import type { SelectorList } from '../../selector/index';
import type { CSSStyleSheetImpl } from '../css-stylesheet';

/** Common state and contract for CSS rule implementations. */
// https://drafts.csswg.org/cssom/#the-cssrule-interface
export abstract class CSSRuleImpl {
  /** Enclosing rule, or null when this rule has no parent rule. */
  parentRule: CSSRuleImpl | null = null;
  /** Containing stylesheet, or null while the rule is detached. */
  parentStyleSheet: CSSStyleSheetImpl | null = null;
  /** Historical rule-kind number; rule interfaces without a legacy code return zero. */
  abstract type: number;

  /** Owning environment retained when the rule is attached to or removed from a sheet. */
  protected env: StyleletEnvironment;

  /** Establish the execution owner before the rule is associated with a sheet. */
  constructor(env: StyleletEnvironment) {
    this.env = env;
  }

  /** Serialized rule text; assignment has no effect under CSSOM. */
  // https://drafts.csswg.org/cssom/#dom-cssrule-csstext
  abstract get cssText(): string;
  abstract set cssText(value: string);

  /** Containing stylesheet's base URL or location; null when neither is available. */
  get baseURL(): URLRecord | null {
    const sheet = this.parentStyleSheet;
    return sheet?.baseURL ?? sheet?.location ?? null;
  }

  /** Associate this rule with its containing sheet, or detach it from that sheet. */
  setParentStyleSheet(sheet: CSSStyleSheetImpl | null): void {
    this.parentStyleSheet = sheet;
  }

  /** Selectors available to nested rules, inherited from the nearest enclosing style rule. */
  getNestingSelectors(): SelectorList | null {
    return this.parentRule?.getNestingSelectors() ?? null;
  }
}

/*
 * [Exposed=Window]
 * interface CSSRule {
 *   attribute CSSOMString cssText;
 *   readonly attribute CSSRule? parentRule;
 *   readonly attribute CSSStyleSheet? parentStyleSheet;
 *
 *   // the following attribute and constants are historical
 *   readonly attribute unsigned short type;
 *   const unsigned short STYLE_RULE = 1;
 *   const unsigned short CHARSET_RULE = 2;
 *   const unsigned short IMPORT_RULE = 3;
 *   const unsigned short MEDIA_RULE = 4;
 *   const unsigned short FONT_FACE_RULE = 5;
 *   const unsigned short PAGE_RULE = 6;
 *   const unsigned short MARGIN_RULE = 9;
 *   const unsigned short NAMESPACE_RULE = 10;
 * };
 */
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
  ],
});

// Keep these contributions beside CSSRule until their feature modules own them.
// https://drafts.csswg.org/css-animations-1/#interface-cssrule-idl
/*
 * partial interface CSSRule {
 *   const unsigned short KEYFRAMES_RULE = 7;
 *   const unsigned short KEYFRAME_RULE = 8;
 * };
 */
export const cssAnimationsRuleIDL = definePartialInterface({
  name: 'CSSRule',
  members: [
    constant('KEYFRAMES_RULE', idlType.unsignedShort, integer(7)),
    constant('KEYFRAME_RULE', idlType.unsignedShort, integer(8)),
  ],
});

// https://drafts.csswg.org/css-counter-styles-3/#extensions-to-cssrule-interface
/*
 * partial interface CSSRule {
 *   const unsigned short COUNTER_STYLE_RULE = 11;
 * };
 */
export const cssCounterStylesRuleIDL = definePartialInterface({
  name: 'CSSRule',
  members: [constant('COUNTER_STYLE_RULE', idlType.unsignedShort, integer(11))],
});

// https://drafts.csswg.org/css-conditional-3/#extensions-to-cssrule-interface
/*
 * partial interface CSSRule {
 *   const unsigned short SUPPORTS_RULE = 12;
 * };
 */
export const cssConditionalRuleIDL = definePartialInterface({
  name: 'CSSRule',
  members: [constant('SUPPORTS_RULE', idlType.unsignedShort, integer(12))],
});

// https://drafts.csswg.org/css-fonts-4/#om-fontfeaturevalues
/*
 * partial interface CSSRule {
 *   const unsigned short FONT_FEATURE_VALUES_RULE = 14;
 * };
 */
export const cssFontsRuleIDL = definePartialInterface({
  name: 'CSSRule',
  members: [constant('FONT_FEATURE_VALUES_RULE', idlType.unsignedShort, integer(14))],
});
