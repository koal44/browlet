import { HTML_NAMESPACE } from '../../../../infra/index';
import { InternalError } from '../../../../infra/internal-error';
import { defineInterface, impl } from '../../../../web-idl/index';

import type { SpeculationRulesParseResult } from '../../../scripting/index';
import type { WindowImpl } from '../../../browsing/window/index';

import { defineElementInterface } from '../element';
import { HTMLElementImpl } from './html-element';

/** Retains script-result state needed when the containing document's base URL changes. */
// https://html.spec.whatwg.org/multipage/scripting.html#the-script-element
// PROVISIONAL: script preparation, execution, and reflected members are not implemented.
export class HTMLScriptElementImpl extends HTMLElementImpl {
  /** Prepared result, an error represented by null, or the initial unprepared state. */
  // https://html.spec.whatwg.org/multipage/scripting.html#concept-script-result
  // PROVISIONAL: extend the union when classic/module scripts and import maps exist.
  result: 'uninitialized' | null | SpeculationRulesParseResult = 'uninitialized';

  /** Recognize an HTML script implementation, independently of mutable attributes. */
  static is(value: unknown): value is HTMLScriptElementImpl {
    return value instanceof HTMLScriptElementImpl;
  }

  /** Window of this script's realm, unchanged when another document adopts it. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#concept-relevant-global
  getRelevantGlobalObject(): WindowImpl {
    const { realm } = this.env;
    if (!realm.isWindow()) throw new InternalError('An HTML script element requires a Window realm');
    return realm.windowImplementation;
  }
}

/*
 * [Exposed=Window]
 * interface HTMLScriptElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, Reflect] attribute DOMString type;
 *   [CEReactions, ReflectURL] attribute USVString src;
 *   [CEReactions, Reflect] attribute boolean noModule;
 *   [CEReactions] attribute boolean async;
 *   [CEReactions, Reflect] attribute boolean defer;
 *   [SameObject, PutForwards=value, Reflect] readonly attribute DOMTokenList blocking;
 *   [CEReactions] attribute DOMString? crossOrigin;
 *   [CEReactions] attribute DOMString referrerPolicy;
 *   [CEReactions, Reflect] attribute DOMString integrity;
 *   [CEReactions] attribute DOMString fetchPriority;
 *
 *   [CEReactions] attribute DOMString text;
 *
 *   static boolean supports(DOMString type);
 *
 *   // also has obsolete members
 * };
 */
export const htmlScriptElementIDL = defineInterface({
  name: 'HTMLScriptElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLScriptElementImpl),
  members: [],
});

export const htmlScriptElementInterface = defineElementInterface({
  definition: htmlScriptElementIDL,
  localNames: ['script'],
  namespaceURI: HTML_NAMESPACE,
});
