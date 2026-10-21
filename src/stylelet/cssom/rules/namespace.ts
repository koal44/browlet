import { asciiLower } from '../../../infra/ascii';
import { defineInterface, impl, reference, roAttr } from '../../../web-idl/core/index';

import type { StyleletEnvironment } from '../../environment';
import {
  consumeIdentToken, consumeStringToken, consumeUrlToken, isFunctionBlock, isWhitespaceToken,
  parseAsComponentGrammar, serializeCssIdentifier, serializeCssString,
  type BlockContents, type ComponentValue, type TokenCursor, type TokenList,
} from '../../syntax/index';
import type { SelectorNamespaces } from '../../selector/index';
import type { RuleListContext } from './context';

import { CSSRuleImpl } from './rule';
import { CSSImportRuleImpl } from './import';

/** A sheet-local namespace declaration; its URI is a literal name, not a resolved resource URL. */
// https://drafts.csswg.org/cssom/#the-cssnamespacerule-interface
export class CSSNamespaceRuleImpl extends CSSRuleImpl {
  /** Namespace name exactly as decoded from the string or URL token. */
  namespaceURI: string;
  /** Case-sensitive prefix, or empty for the default namespace. */
  prefix: string;

  /** Retain the namespace declaration without resolving or normalizing its URI. */
  constructor(namespaceURI: string, prefix: string, env: StyleletEnvironment) {
    super(env);
    this.namespaceURI = namespaceURI;
    this.prefix = prefix;
  }

  /** Interpret a leading namespace statement and apply its bindings after the whole prelude succeeds. */
  // https://drafts.csswg.org/css-namespaces-3/#syntax
  static interpret(
    prelude: TokenList<ComponentValue>,
    preceding: BlockContents | null,
    context: RuleListContext,
  ): CSSNamespaceRuleImpl | null {
    if (preceding !== null && (context.parentSelectors !== null || preceding.some((item) =>
      !(item instanceof CSSNamespaceRuleImpl) && !(item instanceof CSSImportRuleImpl)
    ))) return null;

    const rule = parseAsComponentGrammar(prelude, CSSNamespaceRuleImpl.#consume, context);
    if (rule !== null) rule.applyNamespace(context);
    return rule;
  }

  /** Consume the optional prefix and the namespace's literal string or url() notation. */
  static #consume(this: void, c: TokenCursor<ComponentValue, RuleListContext>): CSSNamespaceRuleImpl | null {
    c.consumeWhile(isWhitespaceToken);
    const prefix = consumeIdentToken(c)?.value ?? '';
    c.consumeWhile(isWhitespaceToken);
    let uri = (consumeStringToken(c) ?? consumeUrlToken(c))?.value;
    if (uri === undefined) {
      const component = c.peek();
      if (!isFunctionBlock(component) || asciiLower(component.name) !== 'url') return null;
      c.next();
      const token = parseAsComponentGrammar(component.value, (inner) => {
        inner.consumeWhile(isWhitespaceToken);
        return consumeStringToken(inner);
      }, c.context);
      if (token === null) return null;
      uri = token.value;
    }
    return new CSSNamespaceRuleImpl(uri, prefix, c.context.env);
  }

  /** Canonical namespace rule text; CSSRule assignment has no effect. */
  // https://drafts.csswg.org/cssom/#serialize-a-css-rule
  get cssText(): string {
    const prefix = this.prefix === '' ? '' : `${serializeCssIdentifier(this.prefix)} `;
    return `@namespace ${prefix}url(${serializeCssString(this.namespaceURI)});`;
  }

  set cssText(_value: string) {}

  /** Historical NAMESPACE_RULE code. */
  get type(): number { return 10; }

  /** Let the last declaration of a prefix or default namespace determine its scope. */
  // https://drafts.csswg.org/css-namespaces-3/#prefixes
  applyNamespace(context: SelectorNamespaces): void {
    if (this.prefix === '') context.defaultNamespace = this.namespaceURI;
    else (context.namespacePrefixes ??= new Map()).set(this.prefix, this.namespaceURI);
  }
}

/*
 * [Exposed=Window]
 * interface CSSNamespaceRule : CSSRule {
 *   readonly attribute CSSOMString namespaceURI;
 *   readonly attribute CSSOMString prefix;
 * };
 */
export const cssNamespaceRuleIDL = defineInterface({
  name: 'CSSNamespaceRule', inherits: 'CSSRule', exposed: 'Window',
  implementation: impl(CSSNamespaceRuleImpl),
  members: [roAttr('namespaceURI', reference('CSSOMString')), roAttr('prefix', reference('CSSOMString'))],
});

