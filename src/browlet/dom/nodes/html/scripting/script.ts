import { HTML_NAMESPACE, InternalError } from '../../../../../infra/index';
import {
  attr, ctor, defineInterface, idlType, impl, nullable, reference, reflectEnumerated, reflectTokens, roAttr,
  xattr,
} from '../../../../../web-idl/core/index';

import { ElementTag, ContentCategory, SanitizationCategory } from '../../element-definitions/index';
import {
  corsSettingsAttribute, referrerPolicyAttribute, getBlockingTokens, blockingAttribute,
  fetchPriorityAttribute,
} from '../attributes/index';
import type { SpeculationRulesParseResult } from '../../../../scripting/index';
import type { WindowImpl } from '../../../../browsing/window/index';

import type { DocumentImpl } from '../../document';
import { HTMLElementImpl } from '../html-element';

/** Represents a script's fetch attributes and prepared result. */
// https://html.spec.whatwg.org/multipage/scripting.html#the-script-element
export class HTMLScriptElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLScript;
    this.prototype.excludeFromAutoDirection = true;
    this.prototype.categories = [
      ContentCategory.Metadata, ContentCategory.Flow, ContentCategory.Phrasing,
      ContentCategory.ScriptSupporting,
    ];
    this.prototype.sanitization = { category: SanitizationCategory.Unsafe };
  }

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

  /** Recognize an HTML script implementation, independently of mutable attributes. */
  static is(value: unknown): value is HTMLScriptElementImpl {
    return value instanceof HTMLScriptElementImpl;
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
  namespaceURI: HTML_NAMESPACE,
  localNames: ['script'],
  members: [
    ctor([], xattr('HTMLConstructor')),
    roAttr('blocking', reference('DOMTokenList'),
      xattr('SameObject', ['PutForwards', 'value'], reflectTokens(blockingAttribute)),
    ),
    // PROVISIONAL: [CEReactions] entry/exit awaits HTML custom-element reaction delivery.
    attr('crossOrigin', nullable(idlType.DOMString), xattr('CEReactions', reflectEnumerated(corsSettingsAttribute))),
    // SPEC_CLASH(script-referrer-policy-null): HTML/Firefox/WebKit stringify null/undefined; Chromium removes the attribute.
    attr('referrerPolicy', idlType.DOMString, xattr('CEReactions', reflectEnumerated(referrerPolicyAttribute))),
    attr('fetchPriority', idlType.DOMString, xattr('CEReactions', reflectEnumerated(fetchPriorityAttribute))),
  ],
});

/** Kind of content selected by script-element preparation; null is separate unprepared state. */
// https://html.spec.whatwg.org/multipage/scripting.html#concept-script-type
export type ScriptElementType = 'classic' | 'module' | 'importmap' | 'speculationrules';
