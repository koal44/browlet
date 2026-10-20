import type { DOMDocument as Document } from '../../infra/index';
import { internalType, type InternalPromise } from '../../infra/promises';

import type { StyleletURL } from '../environment';
import { parseRule, type Rule } from '../syntax/index';
import type { StyleletContext } from '../context';

import { CSSRuleListImpl } from './rule-list';
import { interpretCSSRule, parseCSSRules } from './parser';
import { StyleSheetImpl } from './stylesheet';
import type { CSSRuleImpl } from './rule';
import type { MediaListImpl } from './media-list';
import type { CSSOMString } from './string';

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

  #ownerRule: CSSRuleImpl | null;
  #constructorDocument: Document | null;

  #alternate: boolean;
  #originClean: boolean;
  #constructed: boolean;
  #disallowModification: boolean;

  constructor(
    context: StyleletContext,
    options: CSSStyleSheetInit = {},
  ) {
    super(context.env);

    const document = context.document;
    this.location = new this.env.userAgent.URL(context.dom.baseURI(document));

    this.#ownerRule = null;
    this.#constructorDocument = document;

    this.#alternate = false;
    this.#originClean = true;
    this.#constructed = true;
    this.#disallowModification = false;

    const {
      baseURL = null,
      media = '',
      disabled = false,
    } = options;

    if (baseURL !== null) {
      this.baseURL = new this.env.userAgent.URL(baseURL, this.location.href);
    }
    this.setMedia(media);
    this.setDisabled(disabled);
  }

  static create(
    context: StyleletContext,
    properties: CSSStyleSheetProperties,
    rules?: CSSRuleImpl[],
  ): CSSStyleSheetImpl {
    const sheet = new CSSStyleSheetImpl(context);

    sheet.location = properties.location;
    sheet.baseURL = properties.baseURL;
    sheet.setParentStyleSheet(properties.parentStyleSheet);
    sheet.setOwnerNode(properties.ownerNode);
    sheet.#ownerRule = properties.ownerRule;
    sheet.setMedia(properties.media);
    sheet.setTitle(properties.title);
    sheet.#alternate = properties.alternate;
    sheet.#originClean = properties.originClean;
    sheet.#constructed = false;
    sheet.#constructorDocument = null;
    if (rules) sheet.replaceRules(rules);

    return sheet;
  }

  get ownerRule(): CSSRuleImpl | null {
    return this.#ownerRule;
  }

  get cssRules(): CSSRuleListImpl {
    this.#assertOriginClean();
    return this.ruleList;
  }

  // Deprecated CSSStyleSheet members ----------------------------------------

  /** @deprecated Use cssRules instead. */
  get rules(): CSSRuleListImpl {
    return this.cssRules;
  }

  insertRule(rule: string, index = 0): number {
    this.#assertOriginClean();
    this.#assertModificationAllowed();

    if (index > this.ruleList.length) {
      throw new this.env.exec.DOMException(
        `Index ${index} exceeds the rule-list length.`,
        'IndexSizeError',
      );
    }

    const parsedRule = parseRule(rule);
    if (parsedRule === null || isImportRule(parsedRule)) {
      throw new this.env.exec.DOMException(
        `Failed to parse the rule: ${rule}`,
        'SyntaxError',
      );
    }

    const cssRule = interpretCSSRule(parsedRule, this.env);
    if (cssRule === null) {
      // Remove this boundary as the remaining CSSRule interfaces are added.
      throw new this.env.exec.DOMException(
        `The parsed rule is not supported: ${rule}`,
        'NotSupportedError',
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
      throw new this.env.exec.DOMException(
        `Index ${index} does not identify a rule.`,
        'IndexSizeError',
      );
    }

    this.ruleList.item(index)!.setParentStyleSheet(null);
    this.ruleList.remove(index);
  }

  replace(text: string): InternalPromise<CSSStyleSheetImpl> {
    if (!this.#constructed || this.#disallowModification) {
      return this.env.exec.Promise.reject(new this.env.exec.DOMException(
        'This stylesheet cannot be replaced.',
        'NotAllowedError',
      ), internalType<CSSStyleSheetImpl>());
    }

    this.#disallowModification = true;

    const result = this.env.exec.Promise.withResolvers(internalType<CSSStyleSheetImpl>());
    const reject = (error: unknown): void => {
      this.#disallowModification = false;
      result.reject(error);
    };
    // https://drafts.csswg.org/cssom/#dom-cssstylesheet-replace
    // Parse in parallel; return to the owner before changing rules or settling the promise.
    // CSSOM leaves the task source unspecified; use DOM manipulation delivery.
    this.env.exec.runInParallel(() => {
      try {
        const rules = parseCSSRules(text, this.env);
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
      throw new this.env.exec.DOMException(
        'This stylesheet cannot be replaced.',
        'NotAllowedError',
      );
    }

    this.replaceRules(parseCSSRules(text, this.env));
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
    this.setParentStyleSheet(null);
    this.setOwnerNode(null);
    this.#ownerRule = null;
  }

  setAssociatedMedia(media: CSSOMString): void {
    this.setMedia(media);
  }

  setAssociatedTitle(title: string): void {
    this.setTitle(title);
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
      throw new this.env.exec.DOMException(
        'The stylesheet is not origin-clean.',
        'SecurityError',
      );
    }
  }

  #assertModificationAllowed(): void {
    if (this.#disallowModification) {
      throw new this.env.exec.DOMException(
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
export type CSSStyleSheetInit = {
  baseURL?: string | null;
  media?: MediaListImpl | CSSOMString;
  disabled?: boolean;
};

type CSSStyleSheetProperties = {
  location: StyleletURL | null;
  baseURL?: StyleletURL;
  parentStyleSheet: CSSStyleSheetImpl | null;
  ownerNode: StyleSheetImpl['ownerNode'];
  ownerRule: CSSRuleImpl | null;
  media: CSSOMString | MediaListImpl;
  title: string;
  alternate: boolean;
  originClean: boolean;
};

/** Recognize the import syntax excluded by the current insertion path. */
function isImportRule(rule: Rule): boolean {
  return rule.type === 'statement-at-rule' && rule.name === 'import';
}
