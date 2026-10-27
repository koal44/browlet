import type { DOMDocument as Document } from '../../infra/index';
import type { InternalPromise } from '../../infra/promises';
import {
  arg, ctor, defineDictionary, defineInterface, definePartialInterface, dictMember, DOMExceptionImpl,
  emptyDictionary, idlType, impl, implementationType, integer, nullable, op, promise, reference, roAttr, union, xattr,
} from '../../web-idl/core/index';
import type { Encoding } from '../../encoding/index';
import { parseURL, type URLRecord } from '../../url/index';
import type { ReferrerPolicy } from '../../fetch/index';

import type { StyleletEnvironment } from '../environment';
import { parseStylesheetContents } from '../syntax/index';
import type { StyleletContext } from '../context';
import { MediaListImpl } from './media/index';
import { RuleListContext, type CSSImportRuleImpl, type CSSRuleImpl } from './rules/index';

import { CSSRuleListImpl } from './rule-list';
import { StyleSheetImpl } from './stylesheet';
import { StyleSheetLoad, type FetchImportedStyleSheet } from './stylesheet-load';

/** A CSS stylesheet's rule tree, resource associations, and author-mutation state. */
// https://drafts.csswg.org/cssom/#the-cssstylesheet-interface
export class CSSStyleSheetImpl
  extends StyleSheetImpl
{
  /** Authoritative rules, also available internally for non-origin-clean sheets. */
  ruleList = new CSSRuleListImpl();
  /** Parse-time base URL, independent of the public stylesheet location. */
  baseURL?: URLRecord;
  /** Decoded resource encoding, supplied by the loading owner for subsequent imports. */
  encoding?: Encoding;
  /** Response policy, or empty when unspecified; inline sheets use their document's current policy. */
  referrerPolicy: ReferrerPolicy;
  /** Last import attempt on this loading root; retained so later mutations can start another. */
  importLoad?: StyleSheetLoad;

  /** Import rule that owns the sheet, or null for a sheet that was not imported. */
  ownerRule: CSSRuleImpl | null;

  /** Document that constructed the sheet, or null for a resource-owned sheet. */
  #constructorDocument: Document | null;

  /** Whether the sheet belongs to an alternate stylesheet set. */
  #alternate: boolean;
  /** Whether the sheet's rules may be exposed through author-facing CSSOM operations. */
  #originClean: boolean;
  /** Whether author construction enables replacement and restricts imports. */
  #constructed: boolean;
  /** Mutation lock held until an asynchronous replacement settles. */
  #disallowModification = false;

  /** Initialize a sheet once, whether constructed or supplied by a resource owner. */
  constructor(properties: CSSStyleSheetProperties, env: StyleletEnvironment) {
    super(typeof properties.media === 'string' ? properties.media : properties.media.mediaText, env);
    this.location = properties.location;
    this.baseURL = properties.baseURL;
    this.encoding = properties.encoding;
    this.referrerPolicy = properties.referrerPolicy ?? '';
    this.parentStyleSheet = properties.parentStyleSheet;
    this.ownerNode = properties.ownerNode;
    this.ownerRule = properties.ownerRule;
    this.titleText = properties.title;
    this.disabled = properties.disabled ?? false;
    this.#alternate = properties.alternate;
    this.#originClean = properties.originClean;
    this.#constructorDocument = properties.constructorDocument ?? null;
    this.#constructed = this.#constructorDocument !== null;
  }

  /** Construct a sheet for the document selected by the host's constructor binding. */
  // https://drafts.csswg.org/cssom/#create-a-constructed-cssstylesheet
  // SPEC_MISMATCH: create a constructed CSSStyleSheet(options) -> CSSStyleSheet
  // The host supplies the associated Document explicitly; Stylelet does not discover globals.
  static createConstructed(
    options: CSSStyleSheetInit,
    document: Document,
    env: StyleletEnvironment,
  ): CSSStyleSheetImpl {
    const documentBaseURL = parseURL(env.userAgent.dom.baseURI(document), null, 'UTF-8', env.userAgent).url;
    const baseURL = options.baseURL === null ? documentBaseURL
      : parseURL(options.baseURL, documentBaseURL, 'UTF-8', env.userAgent).url;
    if (baseURL === null) {
      // SPEC_GAP(constructed-sheet-invalid-base-url): CSSOM omits validation.
      // Follow Firefox/WebKit and Chromium's gated implementation with NotAllowedError.
      throw new DOMExceptionImpl('The stylesheet base URL is invalid.', 'NotAllowedError');
    }
    return new CSSStyleSheetImpl({
      // SPEC_CLASH(constructed-sheet-location): All three browsers expose null href;
      // §6.1 instead assigns the document base URL to location. Retain it as the parse base.
      location: null,
      baseURL,
      parentStyleSheet: null,
      ownerNode: null,
      ownerRule: null,
      title: '',
      media: options.media,
      disabled: options.disabled,
      alternate: false,
      originClean: true,
      constructorDocument: document,
    }, env);
  }

  /** Create a sheet in the supplied Stylelet context and attach any initial rules. */
  static create(
    context: StyleletContext,
    properties: CSSStyleSheetProperties,
    rules?: CSSRuleImpl[],
  ): CSSStyleSheetImpl {
    const sheet = new CSSStyleSheetImpl(properties, context.env);
    if (rules) sheet.replaceRules(rules);

    return sheet;
  }

  /** Whether resource requests may identify this sheet as their CSS initiator. */
  get originClean(): boolean { return this.#originClean; }

  /** Retained rule list, exposed only when the sheet is origin-clean. */
  // https://drafts.csswg.org/cssom/#dom-cssstylesheet-cssrules
  get cssRules(): CSSRuleListImpl {
    this.#assertOriginClean();
    return this.ruleList;
  }

  /** @deprecated Alias for cssRules, including its origin-clean check. */
  // https://drafts.csswg.org/cssom/#dom-cssstylesheet-rules
  get rules(): CSSRuleListImpl {
    return this.cssRules;
  }

  /** Parse and insert one rule into a mutable, origin-clean sheet, returning its index. */
  // https://drafts.csswg.org/cssom/#dom-cssstylesheet-insertrule
  insertRule(rule: string, index = 0): number {
    this.#assertOriginClean();
    this.#assertModificationAllowed();

    // SPEC_CLASH(sheet-insert-error-order): All three browsers and the insertion
    // helper check the index first; §6.1's insertRule prose parses first.
    const context = new RuleListContext(this.ruleList, null, this.#constructed, this.env);
    context.useNamespaces(this);
    const child = this.ruleList.parseRuleForInsertion(rule, index, false, context);
    child.setParentStyleSheet(this);
    this.ruleList.insert(index, child);
    this.getImportLoad()?.updateImports([child], []);
    return index;
  }

  /** Remove an existing rule and detach its subtree from the sheet. */
  // https://drafts.csswg.org/cssom/#dom-cssstylesheet-deleterule
  deleteRule(index: number): void {
    this.#assertOriginClean();
    this.#assertModificationAllowed();

    const removed = this.ruleList.item(index);
    this.ruleList.remove(index);
    this.getImportLoad()?.updateImports([], [removed!]);
  }

  /** Replace a constructed sheet asynchronously, locking mutations until completion. */
  // https://drafts.csswg.org/cssom/#dom-cssstylesheet-replace
  replace(text: string): InternalPromise<CSSStyleSheetImpl> {
    if (!this.#constructed || this.#disallowModification) {
      return this.env.exec.Promise.reject(new DOMExceptionImpl(
        'This stylesheet cannot be replaced.',
        'NotAllowedError',
      ), reference(CSSStyleSheetImpl));
    }

    this.#disallowModification = true;

    const result = this.env.exec.Promise.withResolvers(reference(CSSStyleSheetImpl));
    const reject = (error: unknown): void => {
      this.#disallowModification = false;
      result.reject(error);
    };
    // Parse in parallel; return to the owner before changing rules or settling the promise.
    // CSSOM leaves the task source unspecified; use DOM manipulation delivery.
    this.env.exec.runInParallel(() => {
      try {
        // CSSOM removes imports from replacement input; discard them during parsing.
        const rules = parseStylesheetContents(text, new RuleListContext(this.ruleList, null, this.#constructed, this.env));
        this.env.exec.queueTask('dom-manipulation', () => {
          try {
            this.replaceRules(rules);
            this.#disallowModification = false;
            result.resolve(this);
          } catch (error) {
            reject(error);
          }
        });
      } catch (error) {
        this.env.exec.queueTask('dom-manipulation', () => { reject(error); });
      }
    });
    return result.promise;
  }

  /** Replace an unlocked constructed sheet's rules synchronously, discarding imports. */
  // https://drafts.csswg.org/cssom/#dom-cssstylesheet-replacesync
  replaceSync(text: string): void {
    if (!this.#constructed || this.#disallowModification) {
      throw new DOMExceptionImpl(
        'This stylesheet cannot be replaced.',
        'NotAllowedError',
      );
    }

    // Imports are excluded from replacement, independently of import support.
    this.replaceRules(parseStylesheetContents(text, new RuleListContext(this.ruleList, null, this.#constructed, this.env)));
  }

  /** Install parsed rules without applying the author API's access and construction checks. */
  replaceRules(rules: CSSRuleImpl[]): void {
    const removed = [...this.ruleList];
    for (const rule of removed) rule.setParentStyleSheet(null);
    for (const rule of rules) rule.setParentStyleSheet(this);
    this.ruleList.replace(rules);
    this.getImportLoad()?.updateImports(rules, removed);
  }

  /** Connect import loading, notifying the caller before each finite attempt and when it completes. */
  loadImports(
    fetchImport: FetchImportedStyleSheet, complete: (success: boolean) => void, started?: (load: StyleSheetLoad) => void,
  ): StyleSheetLoad {
    return StyleSheetLoad.start(this, fetchImport, complete, started, this.env);
  }

  /** Find the retained loading connection through currently attached import rules. */
  getImportLoad(): StyleSheetLoad | undefined {
    return this.importLoad ?? this.ownerRule?.parentStyleSheet?.getImportLoad();
  }

  /** Whether stylesheet-set selection should treat this sheet as an alternate. */
  isAlternate(): boolean {
    return this.#alternate;
  }

  /** Whether this document constructed the sheet and can adopt it. */
  isConstructedFor(document: Document): boolean {
    return this.#constructed && this.#constructorDocument === document;
  }

  /** Associate a freshly fetched sheet with an attached import, retaining the parent's access restrictions. */
  // https://drafts.csswg.org/css-cascade-4/#fetch-an-import
  associateWithImport(rule: CSSImportRuleImpl): void {
    const parent = rule.parentStyleSheet!;
    this.#originClean &&= parent.#originClean;
    this.parentStyleSheet = parent;
    this.ownerRule = rule;
    this.media = rule.media;
    rule.styleSheet = this;
  }

  /** Cancel this sheet's loading connection and clear its parent and owner associations. */
  clearAssociation(): void {
    this.importLoad?.cancel();
    this.parentStyleSheet = null;
    this.ownerNode = null;
    this.ownerRule = null;
  }

  /** Replace the owner-supplied media conditions without replacing the MediaList. */
  setAssociatedMedia(media: string): void {
    this.media.mediaText = media;
  }

  /** Update the stylesheet-set title supplied by the sheet's owner. */
  setAssociatedTitle(title: string): void {
    this.titleText = title;
  }

  /** @deprecated Insert a style rule from selector/declaration text and return the legacy -1 result. */
  // https://drafts.csswg.org/cssom/#dom-cssstylesheet-addrule
  addRule(
    selector = 'undefined',
    style = 'undefined',
    index = this.ruleList.length,
  ): number {
    const block = style === '' ? '' : `${style} `;
    this.insertRule(`${selector} { ${block}}`, index);
    return -1;
  }

  /** @deprecated Delete a rule, defaulting to the first entry. */
  // https://drafts.csswg.org/cssom/#dom-cssstylesheet-removerule
  removeRule(index = 0): void {
    this.deleteRule(index);
  }

  /** Reject author access to rules whose resource origin does not permit inspection. */
  #assertOriginClean(): void {
    if (!this.#originClean) {
      throw new DOMExceptionImpl(
        'The stylesheet is not origin-clean.',
        'SecurityError',
      );
    }
  }

  /** Reject mutations while an asynchronous replacement owns the rule list. */
  #assertModificationAllowed(): void {
    if (this.#disallowModification) {
      throw new DOMExceptionImpl(
        'The stylesheet cannot currently be modified.',
        'NotAllowedError',
      );
    }
  }
}

/** Converted constructor options, including the defaults supplied by Web IDL. */
// https://drafts.csswg.org/cssom/#dictdef-cssstylesheetinit
export type CSSStyleSheetInit = {
  /** Base URL override, or null to use the constructing document's base URL. */
  baseURL: string | null;
  /** Initial media conditions; an existing list is copied by its serialized value. */
  media: MediaListImpl | string;
  /** Whether the constructed sheet starts disabled. */
  disabled: boolean;
};

/** Initial metadata for either a constructed sheet or a sheet supplied by a resource owner. */
type CSSStyleSheetProperties = {
  /** Resource URL exposed by href, or null when no location is assigned. */
  location: URLRecord | null;
  /** Base URL retained for relative references in the sheet's contents. */
  baseURL?: URLRecord;
  /** Encoding inherited by imports; byte-loading owners retain the actual decoded encoding. */
  encoding?: Encoding;
  /** External response policy; omitted means unspecified. */
  referrerPolicy?: ReferrerPolicy;
  /** Sheet containing the import that created this sheet, or null. */
  parentStyleSheet: CSSStyleSheetImpl | null;
  /** Element or processing instruction responsible for the sheet, or null. */
  ownerNode: StyleSheetImpl['ownerNode'];
  /** Import rule responsible for the sheet, or null. */
  ownerRule: CSSRuleImpl | null;
  /** Initial media conditions, parsed or copied into the sheet's own MediaList. */
  media: string | MediaListImpl;
  /** Stylesheet-set title; empty when no title is assigned. */
  title: string;
  /** Whether the sheet is an alternate for stylesheet-set selection. */
  alternate: boolean;
  /** Whether author CSSOM operations may inspect the sheet's rules. */
  originClean: boolean;
  /** Initial disabled state; omitted means enabled. */
  disabled?: boolean;
  /** Constructing document; omitted for sheets supplied by a resource owner. */
  constructorDocument?: Document;
};

/*
 * [Exposed=Window]
 * interface CSSStyleSheet : StyleSheet {
 *   constructor(optional CSSStyleSheetInit options = {});
 *
 *   readonly attribute CSSRule? ownerRule;
 *   [SameObject] readonly attribute CSSRuleList cssRules;
 *   unsigned long insertRule(CSSOMString rule, optional unsigned long index = 0);
 *   undefined deleteRule(unsigned long index);
 *
 *   Promise<CSSStyleSheet> replace(USVString text);
 *   undefined replaceSync(USVString text);
 * };
 */
export const cssStyleSheetIDL = defineInterface<StyleletEnvironment>({
  name: 'CSSStyleSheet',
  inherits: 'StyleSheet',
  exposed: 'Window',
  implementation: impl(CSSStyleSheetImpl),
  members: [
    ctor(
      [arg('options', implementationType<CSSStyleSheetInit>(reference('CSSStyleSheetInit')), {
        default: emptyDictionary, optional: true,
      })],
      {
        construct(env, options) {
          return CSSStyleSheetImpl.createConstructed(options, env.getAssociatedDocument()!, env);
        },
      },
    ),
    roAttr('ownerRule', nullable(reference('CSSRule'))),
    roAttr('cssRules', reference(CSSRuleListImpl), xattr('SameObject')),
    op('insertRule', idlType.unsignedLong, [
      arg('rule', reference('CSSOMString')),
      arg('index', idlType.unsignedLong, { optional: true, default: integer(0) }),
    ]),
    op('deleteRule', idlType.undefined, [arg('index', idlType.unsignedLong)]),
    op('replace', promise(reference(CSSStyleSheetImpl)), [arg('text', idlType.USVString)]),
    op('replaceSync', idlType.undefined, [arg('text', idlType.USVString)]),
  ],
});

/*
 * dictionary CSSStyleSheetInit {
 *   DOMString? baseURL = null;
 *   (MediaList or DOMString) media = "";
 *   boolean disabled = false;
 * };
 */
export const cssStyleSheetInitIDL = defineDictionary({
  name: 'CSSStyleSheetInit',
  members: [
    dictMember('baseURL', nullable(idlType.DOMString), { default: null }),
    dictMember('media', union(reference(MediaListImpl), idlType.DOMString), { default: '' }),
    dictMember('disabled', idlType.boolean, { default: false }),
  ],
});

// https://drafts.csswg.org/cssom/#legacy-css-style-sheet-members
/*
 * partial interface CSSStyleSheet {
 *   [SameObject] readonly attribute CSSRuleList rules;
 *   long addRule(optional DOMString selector = "undefined", optional DOMString style = "undefined", optional unsigned long index);
 *   undefined removeRule(optional unsigned long index = 0);
 * };
 */
export const legacyCSSStyleSheetIDL = definePartialInterface({
  name: 'CSSStyleSheet',
  members: [
    roAttr('rules', reference(CSSRuleListImpl), xattr('SameObject')),
    op('addRule', idlType.long, [
      arg('selector', idlType.DOMString, { optional: true, default: 'undefined' }),
      arg('style', idlType.DOMString, { optional: true, default: 'undefined' }),
      arg('index', idlType.unsignedLong, { optional: true }),
    ]),
    op('removeRule', idlType.undefined,
      [arg('index', idlType.unsignedLong, { optional: true, default: integer(0) })],
    ),
  ],
});
