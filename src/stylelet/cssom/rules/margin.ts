import { InternalError } from '../../../infra/internal-error';
import { defineInterface, impl, reference, roAttr, xattr } from '../../../web-idl/core/index';

import type { StyleletEnvironment } from '../../environment';
import { CSSStyleDeclarationImpl } from '../declarations/index';

import { CSSRuleImpl } from './rule';

/** A page-margin rule; creation awaits the page grammar and its descriptor representation. */
// https://drafts.csswg.org/cssom/#the-cssmarginrule-interface
export class CSSMarginRuleImpl extends CSSRuleImpl {
  /** Margin-box name without the leading at sign. */
  name: string;

  /** Keep margin rules unavailable until descriptor state can be supplied honestly. */
  constructor(name: string, env: StyleletEnvironment) {
    super(env);
    this.name = name;
    throw new InternalError('Page-margin descriptor parsing is not implemented');
  }

  /** Margin-rule serialization needs the descriptor block. */
  get cssText(): string {
    throw new InternalError('CSSMarginRule serialization is not implemented');
  }

  set cssText(_value: string) {}

  /** Historical MARGIN_RULE code. */
  get type(): number { return 9; }

  /** Retained margin descriptors with this rule as parent and no owner node. */
  get style(): CSSMarginDescriptorsImpl {
    throw new InternalError('Page-margin descriptor storage is not implemented');
  }
}

/*
 * [Exposed=Window]
 * interface CSSMarginRule : CSSRule {
 *   readonly attribute CSSOMString name;
 *   [SameObject, PutForwards=cssText] readonly attribute CSSMarginDescriptors style;
 * };
 */
export const cssMarginRuleIDL = defineInterface({
  name: 'CSSMarginRule', inherits: 'CSSRule', exposed: 'Window',
  implementation: impl(CSSMarginRuleImpl),
  members: [
    roAttr('name', reference('CSSOMString')),
    roAttr('style', reference('CSSMarginDescriptors'), xattr('SameObject', ['PutForwards', 'cssText'])),
  ],
});

/** Provisional declaration subtype for CSSOM's otherwise undefined margin-descriptor reference. */
// https://drafts.csswg.org/cssom/#the-cssmarginrule-interface
// SPEC_GAP(margin-descriptors-interface): CSSOM references CSSMarginDescriptors without defining its interface.
export class CSSMarginDescriptorsImpl extends CSSStyleDeclarationImpl {
  /** Reject construction until the page owner supplies a real descriptor grammar and storage. */
  constructor(parentRule: CSSMarginRuleImpl, env: StyleletEnvironment) {
    super({ parentRule }, env);
    throw new InternalError('Page-margin descriptor parsing and mutation are not implemented');
  }
}

// Provisional IDL, not a quotation: only the declaration inheritance needed by
// CSSMarginRule's PutForwards contract is supplied. Do not invent descriptor attributes.
/*
 * [Exposed=Window]
 * interface CSSMarginDescriptors : CSSStyleDeclaration {};
 */
export const cssMarginDescriptorsIDL = defineInterface({
  name: 'CSSMarginDescriptors', inherits: 'CSSStyleDeclaration', exposed: 'Window',
  implementation: impl(CSSMarginDescriptorsImpl), members: [],
});
