import type { DOMDocument as Document } from '../../infra/index';
import type { InternalPromise } from '../../infra/promises';
import {
  arg, ctor, defineDictionary, defineInterface, definePartialInterface, dictMember, DOMExceptionImpl,
  emptyDictionary, idlType, impl, implementationType, integer, nullable, op, promise, reference, roAttr, union, xattr,
} from '../../web-idl/core/index';

import type { StyleletEnvironment, StyleletURL } from '../environment';
import { parseRule, parseStylesheetContents } from '../syntax/index';
import type { StyleletContext } from '../context';

import { CSSRuleListImpl } from './rule-list';
import { StylesheetContext } from './parser';
import { StyleSheetImpl } from './stylesheet';
import type { CSSRuleImpl } from './rule';
import { MediaListImpl } from './media-list';

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
export class CSSStyleSheetImpl
  extends StyleSheetImpl
{
  /** Authoritative rules, also available internally for non-origin-clean sheets. */
  ruleList = new CSSRuleListImpl();
  /** Parse-time base URL, independent of the public stylesheet location. */
  baseURL?: StyleletURL;

  ownerRule: CSSRuleImpl | null;

  #constructorDocument: Document | null;

  #alternate: boolean;
  #originClean: boolean;
  #constructed: boolean;
  #disallowModification = false;

  /** Initialize a sheet once, whether constructed or supplied by a resource owner. */
  constructor(properties: CSSStyleSheetProperties, env: StyleletEnvironment) {
    super(typeof properties.media === 'string' ? properties.media : properties.media.mediaText, env);
    this.location = properties.location;
    this.baseURL = properties.baseURL;
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
    options: CSSStyleSheetInitRecord,
    document: Document,
    env: StyleletEnvironment,
  ): CSSStyleSheetImpl {
    const documentBaseURL = env.userAgent.dom.baseURI(document);
    let baseURL: StyleletURL;
    try {
      baseURL = new env.userAgent.URL(options.baseURL ?? documentBaseURL, documentBaseURL);
    } catch {
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

  static create(
    context: StyleletContext,
    properties: CSSStyleSheetProperties,
    rules?: CSSRuleImpl[],
  ): CSSStyleSheetImpl {
    const sheet = new CSSStyleSheetImpl(properties, context.env);
    if (rules) sheet.replaceRules(rules);

    return sheet;
  }

  get cssRules(): CSSRuleListImpl {
    this.#assertOriginClean();
    return this.ruleList;
  }

  /** @deprecated Use cssRules instead. */
  get rules(): CSSRuleListImpl {
    return this.cssRules;
  }

  insertRule(rule: string, index = 0): number {
    this.#assertOriginClean();
    this.#assertModificationAllowed();

    // SPEC_CLASH(sheet-insert-error-order): All three browsers and the insertion
    // helper check the index first; §6.1's insertRule prose parses first.
    if (index > this.ruleList.length) {
      throw new DOMExceptionImpl(
        `Index ${index} exceeds the rule-list length.`,
        'IndexSizeError',
      );
    }

    // https://drafts.csswg.org/cssom/#dom-cssstylesheet-insertrule
    const context = new StylesheetContext(null, this.#constructed, this.env);
    const cssRule = parseRule(rule, context);
    if (cssRule === null) {
      throw new DOMExceptionImpl(
        `Failed to parse the rule: ${rule}`,
        'SyntaxError',
      );
    }

    cssRule.setParentStyleSheet(this);
    this.ruleList.insert(index, cssRule);
    return index;
  }

  deleteRule(index: number): void {
    this.#assertOriginClean();
    this.#assertModificationAllowed();

    if (index >= this.ruleList.length) {
      throw new DOMExceptionImpl(
        `Index ${index} does not identify a rule.`,
        'IndexSizeError',
      );
    }

    this.ruleList.item(index)!.setParentStyleSheet(null);
    this.ruleList.remove(index);
  }

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
    // https://drafts.csswg.org/cssom/#dom-cssstylesheet-replace
    // Parse in parallel; return to the owner before changing rules or settling the promise.
    // CSSOM leaves the task source unspecified; use DOM manipulation delivery.
    this.env.exec.runInParallel(() => {
      try {
        // CSSOM removes imports from replacement input; discard them during parsing.
        const rules = parseStylesheetContents(text, new StylesheetContext(null, this.#constructed, this.env));
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

  replaceSync(text: string): void {
    if (!this.#constructed || this.#disallowModification) {
      throw new DOMExceptionImpl(
        'This stylesheet cannot be replaced.',
        'NotAllowedError',
      );
    }

    // https://drafts.csswg.org/cssom/#dom-cssstylesheet-replacesync
    // Imports are excluded from replacement, independently of import support.
    this.replaceRules(parseStylesheetContents(text, new StylesheetContext(null, this.#constructed, this.env)));
  }

  /** Install parsed rules without applying the author API's access and construction checks. */
  replaceRules(rules: CSSRuleImpl[]): void {
    for (const rule of this.ruleList) rule.setParentStyleSheet(null);
    for (const rule of rules) rule.setParentStyleSheet(this);
    this.ruleList.replace(rules);
  }

  isAlternate(): boolean {
    return this.#alternate;
  }

  isConstructedFor(document: Document): boolean {
    return this.#constructed && this.#constructorDocument === document;
  }

  clearAssociation(): void {
    this.parentStyleSheet = null;
    this.ownerNode = null;
    this.ownerRule = null;
  }

  setAssociatedMedia(media: string): void {
    this.media.mediaText = media;
  }

  setAssociatedTitle(title: string): void {
    this.titleText = title;
  }

  /** @deprecated Use insertRule() instead. */
  addRule(
    selector = 'undefined',
    style = 'undefined',
    index = this.ruleList.length,
  ): number {
    const block = style === '' ? '' : `${style} `;
    this.insertRule(`${selector} { ${block}}`, index);
    return -1;
  }

  /** @deprecated Use deleteRule() instead. */
  removeRule(index = 0): void {
    this.deleteRule(index);
  }

  #assertOriginClean(): void {
    if (!this.#originClean) {
      throw new DOMExceptionImpl(
        'The stylesheet is not origin-clean.',
        'SecurityError',
      );
    }
  }

  #assertModificationAllowed(): void {
    if (this.#disallowModification) {
      throw new DOMExceptionImpl(
        'The stylesheet cannot currently be modified.',
        'NotAllowedError',
      );
    }
  }
}

/*
 * dictionary CSSStyleSheetInit {
 *   DOMString? baseURL = null;
 *   (MediaList or DOMString) media = "";
 *   boolean disabled = false;
 * };
 */
export type CSSStyleSheetInitRecord = {
  baseURL: string | null;
  media: MediaListImpl | string;
  disabled: boolean;
};

/** Standalone implementation callers may omit the dictionary's defaulted members. */
export type CSSStyleSheetInit = Partial<CSSStyleSheetInitRecord>;

type CSSStyleSheetProperties = {
  location: StyleletURL | null;
  baseURL?: StyleletURL;
  parentStyleSheet: CSSStyleSheetImpl | null;
  ownerNode: StyleSheetImpl['ownerNode'];
  ownerRule: CSSRuleImpl | null;
  media: string | MediaListImpl;
  title: string;
  alternate: boolean;
  originClean: boolean;
  disabled?: boolean;
  constructorDocument?: Document;
};

export const cssStyleSheetIDL = defineInterface<StyleletEnvironment>({
  name: 'CSSStyleSheet',
  inherits: 'StyleSheet',
  exposed: 'Window',
  implementation: impl(CSSStyleSheetImpl),
  members: [
    ctor(
      [arg('options', implementationType<CSSStyleSheetInitRecord>(reference('CSSStyleSheetInit')), {
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

export const cssStyleSheetInitIDL = defineDictionary({
  name: 'CSSStyleSheetInit',
  members: [
    dictMember('baseURL', nullable(idlType.DOMString), { default: null }),
    dictMember('media', union(reference(MediaListImpl), idlType.DOMString), { default: '' }),
    dictMember('disabled', idlType.boolean, { default: false }),
  ],
});

// https://drafts.csswg.org/cssom/#legacy-css-style-sheet-members
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
