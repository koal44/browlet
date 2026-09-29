import type { DOMNode as Document, DOMNode } from '../../infra/index';
import { internalType } from '../../infra/promises';
import {
  interpretStylesheet, parseStylesheet,
  type InterpretedRule, type InterpretedStyleSheet,
} from '../css/stylesheet';
import {
  parseRule, type SyntaxRule,
} from '../syntax/parser';
import type { StyleletContext } from '../context';
import type { InternalPromise } from '../stylelet';
import type { StyleletEnvironment } from '../environment';
import { CSSRuleListImpl } from './rule-list';
import { CSSStyleRuleImpl } from './rules';
import { StyleSheetImpl } from './stylesheet';
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
 *
 * dictionary CSSStyleSheetInit {
 *   DOMString? baseURL = null;
 *   (MediaList or DOMString) media = "";
 *   boolean disabled = false;
 * };
 */
export class CSSStyleSheetImpl
  extends StyleSheetImpl
{
  #rules: CSSRuleListImpl;
  #interpretedStyleSheet: InterpretedStyleSheet;

  #ownerRule: CSSRule | null;
  #constructorDocument: Document | null;
  // eslint-disable-next-line no-unused-private-class-members -- CSSOM state
  #stylesheetBaseURL: string | null;

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
    const location = new URL(context.dom.baseURI(document));
    this.#rules = new CSSRuleListImpl();
    this.#interpretedStyleSheet = { location, rules: [] };

    this.#ownerRule = null;
    this.#constructorDocument = document;
    this.#stylesheetBaseURL = null;

    this.#alternate = false;
    this.#originClean = true;
    this.#constructed = true;
    this.#disallowModification = false;

    const {
      baseURL = null,
      media = '',
      disabled = false,
    } = options;

    this.#stylesheetBaseURL = baseURL;
    if (baseURL !== null) {
      this.#interpretedStyleSheet.baseUrl = new URL(baseURL, location);
    }
    this.setLocation(location.href);
    this.setMedia(media);
    this.setDisabled(disabled);
  }

  static create(
    context: StyleletContext,
    properties: CSSStyleSheetProperties,
    rules?: InterpretedStyleSheet,
  ): CSSStyleSheetImpl {
    const sheet = new CSSStyleSheetImpl(context);

    sheet.setLocation(properties.location);
    sheet.setParentStyleSheet(properties.parentStyleSheet);
    sheet.setOwnerNode(properties.ownerNode);
    sheet.#ownerRule = properties.ownerRule;
    sheet.setMedia(properties.media);
    sheet.setTitle(properties.title);
    sheet.#alternate = properties.alternate;
    sheet.#originClean = properties.originClean;
    sheet.#constructed = false;
    sheet.#constructorDocument = null;
    sheet.#stylesheetBaseURL = null;
    if (rules) sheet.replaceInterpretedStyleSheet(rules);

    return sheet;
  }

  get ownerRule(): CSSRule | null {
    return this.#ownerRule;
  }

  get cssRules(): CSSRuleListImpl {
    this.assertOriginClean();
    return this.#rules;
  }

  insertRule(rule: string, index = 0): number {
    this.assertOriginClean();
    this.assertModificationAllowed();

    if (index > this.#rules.length) {
      throw this.env.exec.createDOMException(
        'IndexSizeError',
        `Index ${index} exceeds the rule-list length.`,
      );
    }

    const parsedRule = parseRule(rule);
    if (parsedRule === null || isImportRule(parsedRule)) {
      throw this.env.exec.createDOMException(
        'SyntaxError',
        `Failed to parse the rule: ${rule}`,
      );
    }

    const rulePair = createCSSRule(parsedRule, this.env);
    if (rulePair === null) {
      // Remove this boundary as the remaining CSSRule interfaces are added.
      throw this.env.exec.createDOMException(
        'NotSupportedError',
        `The parsed rule is not supported: ${rule}`,
      );
    }

    this.#interpretedStyleSheet.rules.splice(index, 0, rulePair.interpretedRule);
    this.#rules.insert(index, rulePair.cssRule);
    return index;
  }

  deleteRule(index: number): void {
    this.assertOriginClean();
    this.assertModificationAllowed();

    if (index >= this.#rules.length) {
      throw this.env.exec.createDOMException(
        'IndexSizeError',
        `Index ${index} does not identify a rule.`,
      );
    }

    this.#interpretedStyleSheet.rules.splice(index, 1);
    this.#rules.remove(index);
  }

  replace(text: string): InternalPromise<CSSStyleSheetImpl> {
    if (!this.#constructed || this.#disallowModification) {
      return this.env.exec.Promise.reject(this.env.exec.createDOMException(
        'NotAllowedError',
        'This stylesheet cannot be replaced.',
      ), internalType<CSSStyleSheetImpl>('CSSStyleSheetImpl'));
    }

    this.#disallowModification = true;

    const result = this.env.exec.Promise.withResolvers(internalType<CSSStyleSheetImpl>('CSSStyleSheetImpl'));
    const reject = (error: unknown): void => {
      this.#disallowModification = false;
      result.reject(error);
    };
    // https://drafts.csswg.org/cssom/#dom-cssstylesheet-replace
    // Parse in parallel; return to the owner before changing rules or settling the promise.
    // CSSOM leaves the task source unspecified; use DOM manipulation delivery.
    this.env.exec.runInParallel(() => {
      try {
        const rules = this.parseRules(text);
        this.env.exec.queueTask('dom-manipulation', () => {
          try {
            this.replaceInterpretedStyleSheet(rules);
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
      throw this.env.exec.createDOMException(
        'NotAllowedError',
        'This stylesheet cannot be replaced.',
      );
    }

    this.replaceInterpretedStyleSheet(this.parseRules(text));
  }

  // Internal operations ----------------------------------------------------

  get interpretedStyleSheet(): InterpretedStyleSheet {
    return this.#interpretedStyleSheet;
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

  // Deprecated CSSStyleSheet members ----------------------------------------

  /** @deprecated Use cssRules instead. */
  get rules(): CSSRuleListImpl {
    return this.cssRules;
  }

  /** @deprecated Use insertRule() instead. */
  addRule(
    selector = 'undefined',
    style = 'undefined',
    index = this.#rules.length,
  ): number {
    const block = style === '' ? '' : `${style} `;
    this.insertRule(`${selector} { ${block}}`, index);
    return -1;
  }

  /** @deprecated Use deleteRule() instead. */
  removeRule(index = 0): void {
    this.deleteRule(index);
  }

  // Private helpers ---------------------------------------------------------

  private parseRules(text: string): InterpretedStyleSheet {
    return parseStylesheet(text, {
      ...(this.#interpretedStyleSheet.location === undefined
        ? {}
        : { location: this.#interpretedStyleSheet.location }),
      ...(this.#interpretedStyleSheet.baseUrl === undefined
        ? {}
        : { baseUrl: this.#interpretedStyleSheet.baseUrl }),
    });
  }

  private replaceInterpretedStyleSheet(
    styleSheet: InterpretedStyleSheet,
  ): void {
    this.#interpretedStyleSheet = styleSheet;
    this.#rules.replace(buildCSSRules(styleSheet, this.env));
  }

  private assertOriginClean(): void {
    if (!this.#originClean) {
      throw this.env.exec.createDOMException(
        'SecurityError',
        'The stylesheet is not origin-clean.',
      );
    }
  }

  private assertModificationAllowed(): void {
    if (this.#disallowModification) {
      throw this.env.exec.createDOMException(
        'NotAllowedError',
        'The stylesheet cannot currently be modified.',
      );
    }
  }
}

type CSSStyleSheetProperties = {
  location: string | null;
  parentStyleSheet: CSSStyleSheetImpl | null;
  ownerNode: DOMNode | null;
  ownerRule: CSSRule | null;
  media: CSSOMString | MediaList;
  title: string;
  alternate: boolean;
  originClean: boolean;
};

function buildCSSRules(sheet: InterpretedStyleSheet, env: StyleletEnvironment): CSSRule[] {
  return sheet.rules.flatMap((rule) => {
    const cssRule = createCSSRuleFromInterpretedRule(rule, env);
    return cssRule === null ? [] : [cssRule];
  });
}

function createCSSRule(rule: SyntaxRule, env: StyleletEnvironment): RulePair | null {
  const sheet = interpretStylesheet({ rules: [rule] });
  const interpretedRule = sheet.rules[0];
  if (interpretedRule === undefined) return null;

  const cssRule = createCSSRuleFromInterpretedRule(interpretedRule, env);
  return cssRule === null ? null : { cssRule, interpretedRule };
}

function createCSSRuleFromInterpretedRule(rule: InterpretedRule, env: StyleletEnvironment): CSSRule | null {
  switch (rule.type) {
    case 'style-rule': return new CSSStyleRuleImpl(rule, env);
    case 'property-rule': return null;
  }
}

function isImportRule(rule: SyntaxRule): boolean {
  return rule.type === 'statement-at-rule' && rule.name === 'import';
}

type RulePair = {
  cssRule: CSSRule;
  interpretedRule: InterpretedRule;
};
