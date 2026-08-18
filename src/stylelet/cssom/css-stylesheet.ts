import {
  interpretStylesheet, parseStylesheet,
  type InterpretedRule, type InterpretedStyleSheet,
} from '../css/stylesheet';
import {
  parseRule, type SyntaxRule,
} from '../syntax/parser';
import type { Snapshot } from '../snapshot';
import { domExceptionName } from '../../shared/dom-exception';
import { CSSRuleListImpl } from './rule-list';
import { SelectletCSSStyleRule } from './rules';
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
  implements CSSStyleSheet
{
  readonly #rules: CSSRuleListImpl;
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
    snapshot: Snapshot,
    options: CSSStyleSheetInit = {},
  ) {
    super();

    const document = snapshot.document;
    const location = new URL(document.baseURI);
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

  static __create(
    snapshot: Snapshot,
    properties: CSSStyleSheetProperties,
    rules?: InterpretedStyleSheet,
  ): CSSStyleSheetImpl {
    const sheet = new CSSStyleSheetImpl(snapshot);

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

  get cssRules(): CSSRuleList {
    this.assertOriginClean();
    return this.#rules;
  }

  insertRule(rule: string, index = 0): number {
    this.assertOriginClean();
    this.assertModificationAllowed();

    if (index > this.#rules.length) {
      throw new DOMException(
        `Index ${index} exceeds the rule-list length.`,
        domExceptionName.indexSize,
      );
    }

    const parsedRule = parseRule(rule);
    if (parsedRule === null || isImportRule(parsedRule)) {
      throw new DOMException(
        `Failed to parse the rule: ${rule}`,
        domExceptionName.syntax,
      );
    }

    const rulePair = createCSSRule(parsedRule);
    if (rulePair === null) {
      // Remove this boundary as the remaining CSSRule interfaces are added.
      throw new DOMException(
        `The parsed rule is not supported: ${rule}`,
        domExceptionName.notSupported,
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
      throw new DOMException(
        `Index ${index} does not identify a rule.`,
        domExceptionName.indexSize,
      );
    }

    this.#interpretedStyleSheet.rules.splice(index, 1);
    this.#rules.remove(index);
  }

  replace(text: string): Promise<CSSStyleSheet> {
    if (!this.#constructed || this.#disallowModification) {
      return Promise.reject(new DOMException(
        'This stylesheet cannot be replaced.',
        domExceptionName.notAllowed,
      ));
    }

    this.#disallowModification = true;

    return Promise.resolve().then(() => {
      this.replaceRules(text);
      return this;
    }).finally(() => {
      this.#disallowModification = false;
    });
  }

  replaceSync(text: string): void {
    if (!this.#constructed || this.#disallowModification) {
      throw new DOMException(
        'This stylesheet cannot be replaced.',
        domExceptionName.notAllowed,
      );
    }

    this.replaceRules(text);
  }

  // Internal operations ----------------------------------------------------

  get __interpretedStyleSheet(): InterpretedStyleSheet {
    return this.#interpretedStyleSheet;
  }

  __isAlternate(): boolean {
    return this.#alternate;
  }

  __isConstructedFor(document: Document): boolean {
    return this.#constructed && this.#constructorDocument === document;
  }

  __clearAssociation(): void {
    this.setParentStyleSheet(null);
    this.setOwnerNode(null);
    this.#ownerRule = null;
  }

  __setAssociatedMedia(media: CSSOMString): void {
    this.setMedia(media);
  }

  __setAssociatedTitle(title: string): void {
    this.setTitle(title);
  }

  // Deprecated CSSStyleSheet members ----------------------------------------

  /** @deprecated Use cssRules instead. */
  get rules(): CSSRuleList {
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

  private replaceRules(text: string): void {
    this.replaceInterpretedStyleSheet(parseStylesheet(text, {
      ...(this.#interpretedStyleSheet.location === undefined
        ? {}
        : { location: this.#interpretedStyleSheet.location }),
      ...(this.#interpretedStyleSheet.baseUrl === undefined
        ? {}
        : { baseUrl: this.#interpretedStyleSheet.baseUrl }),
    }));
  }

  private replaceInterpretedStyleSheet(
    styleSheet: InterpretedStyleSheet,
  ): void {
    this.#interpretedStyleSheet = styleSheet;
    this.#rules.replace(buildCSSRules(styleSheet));
  }

  private assertOriginClean(): void {
    if (!this.#originClean) {
      throw new DOMException(
        'The stylesheet is not origin-clean.',
        domExceptionName.security,
      );
    }
  }

  private assertModificationAllowed(): void {
    if (this.#disallowModification) {
      throw new DOMException(
        'The stylesheet cannot currently be modified.',
        domExceptionName.notAllowed,
      );
    }
  }
}

type CSSStyleSheetProperties = {
  location: string | null;
  parentStyleSheet: CSSStyleSheet | null;
  ownerNode: Element | ProcessingInstruction | null;
  ownerRule: CSSRule | null;
  media: CSSOMString | MediaList;
  title: string;
  alternate: boolean;
  originClean: boolean;
};

function buildCSSRules(sheet: InterpretedStyleSheet): CSSRule[] {
  return sheet.rules.flatMap((rule) => {
    const cssRule = createCSSRuleFromInterpretedRule(rule);
    return cssRule === null ? [] : [cssRule];
  });
}

function createCSSRule(rule: SyntaxRule): RulePair | null {
  const sheet = interpretStylesheet({ rules: [rule] });
  const interpretedRule = sheet.rules[0];
  if (interpretedRule === undefined) return null;

  const cssRule = createCSSRuleFromInterpretedRule(interpretedRule);
  return cssRule === null ? null : { cssRule, interpretedRule };
}

function createCSSRuleFromInterpretedRule(rule: InterpretedRule): CSSRule | null {
  switch (rule.type) {
    case 'style-rule': return new SelectletCSSStyleRule(rule);
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
