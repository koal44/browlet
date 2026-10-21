import { InternalError } from '../../../infra/internal-error';
import { defineInterface, idlType, impl, nullable, reference, roAttr } from '../../../web-idl/core/index';

import type { StyleletEnvironment } from '../../environment';
import type { CustomPropertyRegistration } from '../../props/index';

import { CSSRuleImpl } from './rule';

/** An @property rule backed by registration data; descriptor text and parsing remain unfinished. */
// https://drafts.css-houdini.org/css-properties-values-api-1/#the-csspropertyrule-interface
export class CSSPropertyRuleImpl extends CSSRuleImpl {
  /** Custom property's name, grammar, inheritance behavior, and initial value. */
  registration: CustomPropertyRegistration;

  /** Retain registration data supplied by the current direct-construction path. */
  constructor(registration: CustomPropertyRegistration, env: StyleletEnvironment) {
    super(env);
    this.registration = registration;
  }

  /** @property serialization remains unimplemented; assignment has no effect. */
  // https://drafts.csswg.org/cssom/#dom-cssrule-csstext
  get cssText(): string {
    throw new InternalError('CSSPropertyRule.cssText is not implemented');
  }

  set cssText(_value: string) {
    // CSSRule.cssText assignment has no effect.
  }

  /** Zero because @property has no historical CSSRule code. */
  get type(): number {
    return 0;
  }

  /** Registered custom-property name, including its leading double hyphen. */
  // https://drafts.css-houdini.org/css-properties-values-api-1/#dom-csspropertyrule-name
  get name(): string {
    return this.registration.name;
  }

  /** Syntax descriptor text; unavailable until parsing retains its original spelling. */
  // https://drafts.css-houdini.org/css-properties-values-api-1/#dom-csspropertyrule-syntax
  get syntax(): string {
    // TODO: retain the descriptor's original spelling when @property is parsed.
    throw new InternalError('CSSPropertyRule.syntax is not implemented');
  }

  /** Whether the registered property inherits by default. */
  // https://drafts.css-houdini.org/css-properties-values-api-1/#dom-csspropertyrule-inherits
  get inherits(): boolean {
    return this.registration.inherits;
  }

  /** Initial-value descriptor text; unavailable until parsing retains the optional descriptor. */
  // https://drafts.css-houdini.org/css-properties-values-api-1/#dom-csspropertyrule-initialvalue
  get initialValue(): string | null {
    // TODO: retain the optional descriptor independently of its registered value.
    throw new InternalError('CSSPropertyRule.initialValue is not implemented');
  }
}

/*
 * [Exposed=Window]
 * interface CSSPropertyRule : CSSRule {
 *   readonly attribute CSSOMString name;
 *   readonly attribute CSSOMString syntax;
 *   readonly attribute boolean inherits;
 *   readonly attribute CSSOMString? initialValue;
 * };
 */
export const cssPropertyRuleIDL = defineInterface({
  name: 'CSSPropertyRule', inherits: 'CSSRule', exposed: 'Window',
  implementation: impl(CSSPropertyRuleImpl),
  members: [
    roAttr('name', reference('CSSOMString')),
    roAttr('syntax', reference('CSSOMString')),
    roAttr('inherits', idlType.boolean),
    roAttr('initialValue', nullable(reference('CSSOMString'))),
  ],
});
