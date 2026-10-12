import { HTML_NAMESPACE } from '../../../../infra/index';
import { InternalError } from '../../../../infra/internal-error';
import { attr, defineInterface, idlType, impl, nullable, reference, roAttr, xattr } from '../../../../web-idl/index';
import type { ReferrerPolicy, RequestPriority } from '../../../../fetch/index';

import {
  corsSettingsAttribute, referrerPolicyAttribute, getBlockingTokens, possibleBlockingTokens,
  fetchPriorityAttribute,
} from './attributes/index';
import type { SpeculationRulesParseResult } from '../../../scripting/index';
import { DOMTokenListImpl } from '../../token-list';
import type { WindowImpl } from '../../../browsing/window/index';

import { defineElementInterface } from '../element';
import type { DocumentImpl } from '../document';
import { HTMLElementImpl } from './html-element';

/** Represents a script's fetch attributes and prepared result. */
// https://html.spec.whatwg.org/multipage/scripting.html#the-script-element
// PROVISIONAL: script preparation, execution, and the remaining reflected members are not implemented.
export class HTMLScriptElementImpl extends HTMLElementImpl {
  /** Parser association; script preparation may clear and restore it. Null means not parser-inserted. */
  // https://html.spec.whatwg.org/multipage/scripting.html#parser-document
  parserDocument: DocumentImpl | null = null;
  /** Type selected by script preparation, distinct from the mutable type content attribute. */
  // https://html.spec.whatwg.org/multipage/scripting.html#concept-script-type
  // PROVISIONAL: prepare the script element must populate this state; the current script handler does not.
  scriptType: ScriptElementType | null = null;
  /** Prepared result, an error represented by null, or the initial unprepared state. */
  // https://html.spec.whatwg.org/multipage/scripting.html#concept-script-result
  // PROVISIONAL: extend the union when classic/module scripts and import maps exist.
  result: 'uninitialized' | null | SpeculationRulesParseResult = 'uninitialized';

  /** Stable author-facing token list, created on first access. */
  #blocking: DOMTokenListImpl | undefined;

  /** Recognize an HTML script implementation, independently of mutable attributes. */
  static is(value: unknown): value is HTMLScriptElementImpl {
    return value instanceof HTMLScriptElementImpl;
  }

  /** Live, case-preserving token list for the blocking content attribute. */
  // https://html.spec.whatwg.org/multipage/scripting.html#dom-script-blocking
  get blocking(): DOMTokenListImpl {
    return this.#blocking ??= new DOMTokenListImpl(this, 'blocking', possibleBlockingTokens);
  }

  /** Canonical CORS keyword, or null for the missing attribute's No CORS state. */
  // https://html.spec.whatwg.org/multipage/scripting.html#dom-script-crossOrigin
  // https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#reflect
  get crossOrigin(): string | null {
    const state = corsSettingsAttribute.getState(this.getAttributeNS(null, 'crossorigin'))!;
    return corsSettingsAttribute.getCanonicalKeyword(state);
  }

  set crossOrigin(value: string | null) {
    if (value === null) this.removeAttributeNS(null, 'crossorigin');
    else this.setAttributeValue('crossorigin', value);
  }

  /** Canonical referrer policy, or an empty string to defer to the request's policy container. */
  // https://html.spec.whatwg.org/multipage/scripting.html#dom-script-referrerPolicy
  // https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#reflect
  get referrerPolicy(): ReferrerPolicy {
    return referrerPolicyAttribute.getState(this.getAttributeNS(null, 'referrerpolicy'))!;
  }

  set referrerPolicy(value: string) {
    this.setAttributeValue('referrerpolicy', value);
  }

  /** Canonical fetch-priority hint; assignment preserves the supplied attribute text. */
  // https://html.spec.whatwg.org/multipage/scripting.html#dom-script-fetchPriority
  get fetchPriority(): RequestPriority {
    return fetchPriorityAttribute.getState(this.getAttributeNS(null, 'fetchpriority'))!;
  }

  set fetchPriority(value: string) {
    this.setAttributeValue('fetchpriority', value);
  }

  override attributeChanged(
    localName: string, oldValue: string | null, newValue: string | null, namespace: string | null,
  ): void {
    super.attributeChanged(localName, oldValue, newValue, namespace);
    this.#blocking?.attributeChanged(localName, oldValue, newValue, namespace);
  }

  override initializeFromParser(): void {
    this.parserDocument = this.nodeDocument;
  }

  /** Prepared classic parser-inserted scripts qualify unless async or defer is present. */
  // https://html.spec.whatwg.org/multipage/scripting.html#script-processing-model:implicitly-potentially-render-blocking
  isImplicitlyPotentiallyRenderBlocking(): boolean {
    return this.scriptType === 'classic' && this.parserDocument !== null &&
      !this.hasAttributeNS(null, 'async') && !this.hasAttributeNS(null, 'defer');
  }

  /** Potential eligibility; actual rendering waits belong to the document and resource loader. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#potentially-render-blocking
  override isPotentiallyRenderBlocking(): boolean {
    return getBlockingTokens(this).has('render') || this.isImplicitlyPotentiallyRenderBlocking();
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
  members: [
    roAttr('blocking', reference('DOMTokenList'), xattr('SameObject', ['PutForwards', 'value'])),
    // PROVISIONAL: [CEReactions] entry/exit awaits HTML custom-element reaction delivery.
    attr('crossOrigin', nullable(idlType.DOMString), xattr('CEReactions')),
    // SPEC_CLASH(script-referrer-policy-null): HTML/Firefox/WebKit stringify null/undefined; Chromium removes the attribute.
    attr('referrerPolicy', idlType.DOMString, xattr('CEReactions')),
    attr('fetchPriority', idlType.DOMString, xattr('CEReactions')),
  ],
});

export const htmlScriptElementInterface = defineElementInterface({
  definition: htmlScriptElementIDL,
  localNames: ['script'],
  namespaceURI: HTML_NAMESPACE,
});

/** Kind of content selected by script-element preparation; null is separate unprepared state. */
// https://html.spec.whatwg.org/multipage/scripting.html#concept-script-type
export type ScriptElementType = 'classic' | 'module' | 'importmap' | 'speculationrules';
