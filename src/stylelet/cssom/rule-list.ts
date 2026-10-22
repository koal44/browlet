import { asciiLower } from '../../infra/ascii';
import { InternalError } from '../../infra/internal-error';
import { arg, defineInterface, DOMExceptionImpl, idlType, impl, indexedGetter, nullable, op, reference, roAttr } from '../../web-idl/core/index';

import {
  discardRuleBlock, parseRule,
  type BlockContents, type ComponentValue, type SyntaxDeclaration, type ParserInput,
  type StatementAtRule, type Token, type TokenCursor, type TokenList,
} from '../syntax/index';
import type { SelectorList, SelectorNamespaces } from '../selector/index';
import { InterpretedDeclaration } from './declarations/index';
import {
  CSSImportRuleImpl, CSSNamespaceRuleImpl, CSSNestedDeclarationsImpl, CSSStyleRuleImpl, CSSPageRuleImpl,
  type CSSRuleImpl, type RuleListContext,
} from './rules/index';

/** Retain the live rule sequence; Binding owns its indexed platform properties. */
// https://drafts.csswg.org/cssom/#the-cssrulelist-interface
export class CSSRuleListImpl {
  /** Rules in source order; the owner attaches additions and removal clears their parent links. */
  #rules: CSSRuleImpl[] = [];

  /** Retain an initial sequence without changing the rules' associations. */
  constructor(rules: CSSRuleImpl[] = []) {
    this.replace(rules);
  }

  /** Current number of rules in the sequence. */
  // https://drafts.csswg.org/cssom/#dom-cssrulelist-length
  get length(): number {
    return this.#rules.length;
  }

  /** Return the rule at an index, or null outside the sequence. */
  // https://drafts.csswg.org/cssom/#dom-cssrulelist-item
  item(index: number): CSSRuleImpl | null {
    return this.#rules[index] ?? null;
  }

  /** Iterate the retained rule implementations in source order. */
  [Symbol.iterator](): ArrayIterator<CSSRuleImpl> {
    return this.#rules[Symbol.iterator]();
  }

  /** Retain a new rule sequence while preserving this list's identity. */
  replace(rules: CSSRuleImpl[]): void {
    this.#rules = rules;
  }

  /** Apply this list's leading namespace declarations to an insertion or selector-edit context. */
  // https://drafts.csswg.org/css-namespaces-3/#prefixes
  applyNamespaces(context: SelectorNamespaces): void {
    for (const rule of this.#rules) {
      if (rule instanceof CSSNamespaceRuleImpl) rule.applyNamespace(context);
      else if (!(rule instanceof CSSImportRuleImpl)) break;
    }
  }

  /** Parse and validate an insertion before the owner changes associations or this live list. */
  // https://drafts.csswg.org/cssom/#insert-a-css-rule
  // The owner attaches the returned rule before calling insert(), so failed attachment leaves the list unchanged.
  parseRuleForInsertion(rule: string, index: number, nested: boolean, context: RuleListContext): CSSRuleImpl {
    if (index > this.#rules.length) throw new DOMExceptionImpl('The rule index exceeds the list length.', 'IndexSizeError');
    let parsed = parseRule(rule, context);
    if (parsed === null && nested) {
      const declarations = InterpretedDeclaration.parseBlock(rule, context);
      if (declarations.length > 0) parsed = new CSSNestedDeclarationsImpl(declarations, context.env);
    }
    if (parsed === null) throw new DOMExceptionImpl('The input is not a CSS rule.', 'SyntaxError');

    // SPEC_CLASH(namespace-insertion-error-order): Follow CSSOM/Firefox by checking
    // placement before the namespace-edit restriction; Chromium/WebKit reverse them.
    if (parsed instanceof CSSImportRuleImpl) {
      if (nested) throw new DOMExceptionImpl('Import rules cannot be nested.', 'HierarchyRequestError');
      for (let i = 0; i < index; i++) {
        if (!(this.#rules[i] instanceof CSSImportRuleImpl)) {
          throw new DOMExceptionImpl('Import rules must precede other rules.', 'HierarchyRequestError');
        }
      }
    } else if (parsed instanceof CSSNamespaceRuleImpl) {
      if (nested) throw new DOMExceptionImpl('Namespace rules cannot be nested.', 'HierarchyRequestError');
      for (let i = 0; i < index; i++) {
        const preceding = this.#rules[i]!;
        if (!(preceding instanceof CSSImportRuleImpl) && !(preceding instanceof CSSNamespaceRuleImpl)) {
          throw new DOMExceptionImpl('Namespace rules must precede other rules.', 'HierarchyRequestError');
        }
      }
      this.#assertNamespaceMutationAllowed();
    } else if (!nested) {
      for (let i = index; i < this.#rules.length; i++) {
        const following = this.#rules[i]!;
        if (following instanceof CSSImportRuleImpl || following instanceof CSSNamespaceRuleImpl) {
          throw new DOMExceptionImpl('This rule must follow imports and namespaces.', 'HierarchyRequestError');
        }
      }
    }
    return parsed;
  }

  /** Parse selectors with the current namespace bindings and enclosing style rule. */
  parseSelectors(input: ParserInput, context: RuleListContext): SelectorList | null {
    return CSSStyleRuleImpl.parseSelectors(input, context);
  }

  /** Interpret one property before Syntax decides whether to retry it as a rule. */
  interpretDeclaration(declaration: SyntaxDeclaration, context: RuleListContext): InterpretedDeclaration[] | null {
    return InterpretedDeclaration.interpret(declaration, context);
  }

  /** Select a statement's owner; null siblings mean standalone parsing before insertion checks. */
  // https://drafts.csswg.org/css-syntax-3/#consume-at-rule
  interpretStatementAtRule(
    rule: StatementAtRule,
    preceding: BlockContents | null,
    context: RuleListContext,
  ): CSSRuleImpl | null {
    switch (asciiLower(rule.name)) {
      case 'import': return CSSImportRuleImpl.interpret(rule.prelude, preceding, context);
      case 'namespace': return CSSNamespaceRuleImpl.interpret(rule.prelude, preceding, context);
      case 'layer':
        // TODO: Validate the layer statement's prelude and placement, then construct its CSSOM rule.
        throw new InternalError(`@${rule.name} statement grammar and CSSOM construction are not implemented`);
      default:
        // Unknown rules, including the former @charset rule, are invalid CSS.
        return null;
    }
  }

  /** Select a block-rule owner before consuming its grammar-specific contents. */
  // https://drafts.csswg.org/css-syntax-3/#block-contents
  interpretBlockAtRule(
    name: string,
    prelude: TokenList<ComponentValue>,
    preceding: BlockContents | null,
    c: TokenCursor<Token>,
    context: RuleListContext,
  ): CSSRuleImpl | null {
    switch (asciiLower(name)) {
      case 'media':
      case 'supports':
      case 'layer':
      case 'scope':
      case 'container':
      case 'font-face':
      case 'keyframes':
      case 'property':
      case 'counter-style':
        // TODO: Select this rule's child context, consume its block, validate, and construct its rule.
        // @font-face needs descriptors; @keyframes needs keyframe preludes, not selectors.
        throw new InternalError(`@${name} prelude, placement, and block grammar are not implemented`);
      case 'page': return CSSPageRuleImpl.interpret(prelude, preceding, c, new CSSRuleListImpl(), context);
      default:
        discardRuleBlock(c);
        return null;
    }
  }

  /** Interpret a style rule's selectors and declaration/nested-rule block. */
  // https://drafts.csswg.org/css-syntax-3/#style-rules
  interpretQualifiedRule(
    prelude: TokenList<ComponentValue>,
    c: TokenCursor<Token>,
    context: RuleListContext,
  ): CSSStyleRuleImpl | null {
    const selectors = this.parseSelectors(prelude, context);
    if (selectors === null) {
      discardRuleBlock(c);
      return null;
    }
    return CSSStyleRuleImpl.interpret(selectors, c, new CSSRuleListImpl(), context);
  }

  /** Insert a validated rule after its owner has established the parent associations. */
  insert(index: number, rule: CSSRuleImpl): void {
    this.#rules.splice(index, 0, rule);
  }

  /** Remove one rule and clear its parent associations while preserving this list's identity. */
  // https://drafts.csswg.org/cssom/#remove-a-css-rule
  remove(index: number): void {
    if (index >= this.#rules.length) throw new DOMExceptionImpl('The rule index is outside the list.', 'IndexSizeError');
    const rule = this.#rules[index]!;
    if (rule instanceof CSSNamespaceRuleImpl) this.#assertNamespaceMutationAllowed();
    this.#rules.splice(index, 1);
    rule.parentRule = null;
    rule.setParentStyleSheet(null);
  }

  /** Enumerate the currently supported indexed properties. */
  getSupportedPropertyIndices(): Iterable<number> {
    return this.#rules.keys();
  }

  /** Reject namespace edits once ordinary rules depend on this list's namespace declarations. */
  #assertNamespaceMutationAllowed(): void {
    for (const rule of this.#rules) {
      if (!(rule instanceof CSSImportRuleImpl) && !(rule instanceof CSSNamespaceRuleImpl)) {
        throw new DOMExceptionImpl('The sheet contains rules other than imports and namespaces.', 'InvalidStateError');
      }
    }
  }
}

/*
 * [Exposed=Window]
 * interface CSSRuleList {
 *   getter CSSRule? item(unsigned long index);
 *   readonly attribute unsigned long length;
 * };
 */
export const cssRuleListIDL = defineInterface({
  name: 'CSSRuleList',
  exposed: 'Window',
  implementation: impl(CSSRuleListImpl),
  members: [
    op('item', nullable(reference('CSSRule')),
      [arg('index', idlType.unsignedLong)],
      indexedGetter((list: CSSRuleListImpl) => list.getSupportedPropertyIndices(), { unsupportedValue: null }),
    ),
    roAttr('length', idlType.unsignedLong),
  ],
});
