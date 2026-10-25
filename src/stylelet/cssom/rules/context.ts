import type { StyleletEnvironment } from '../../environment';
import type {
  SyntaxDeclaration, StatementAtRule, ComponentValue, BlockContents, ParserInput, TokenList, TokenCursor, Token,
} from '../../syntax/index';
import type { PropertyContext } from '../../props/index';
import type { SelectorList, SelectorNamespaces } from '../../selector/index';
import type { InterpretedDeclaration } from '../declarations/index';
import type { CSSStyleRuleImpl } from './style';
import type { CSSRuleImpl } from './rule';
import type { CSSRuleListImpl } from '../rule-list';
import type { CSSStyleSheetImpl } from '../css-stylesheet';

/** One rule list's grammar and enclosing style, retaining the existing allocation owner. */
// https://drafts.csswg.org/css-syntax-3/#parser-algorithms
// The context is per parse, not a host facility on StyleletEnvironment. Each
// nested block selects its own context before any declarations are consumed.
export class RuleListContext implements SelectorNamespaces, PropertyContext {
  /** List coordinating interpretation without modifying its retained rules during parsing. */
  ruleList: CSSRuleListImpl;
  /** Environment that owns the rule implementations created during this parse. */
  env: StyleletEnvironment;

  /** Namespace names indexed by their declared prefix. */
  namespacePrefixes?: Map<string, string>;
  /** Namespace applied to unprefixed type selectors, when declared. */
  defaultNamespace?: string;

  /** Enclosing style rule's selectors, or null outside a style-rule block. */
  parentSelectors: SelectorList | null;
  /** Whether the sheet was constructed, which excludes @import from its grammar. */
  isConstructed: boolean;

  /** Select this rule list's enclosing selectors, sheet kind, and allocation owner. */
  constructor(
    ruleList: CSSRuleListImpl,
    parentSelectors: SelectorList | null,
    isConstructed: boolean,
    env: StyleletEnvironment,
  ) {
    this.ruleList = ruleList;
    this.env = env;
    this.parentSelectors = parentSelectors;
    this.isConstructed = isConstructed;
  }

  /** Obtain the current sheet namespaces for an insertion or selector edit. */
  useNamespaces(sheet: CSSStyleSheetImpl | null): void {
    sheet?.ruleList.applyNamespaces(this);
  }

  /** Parse selectors with this rule list's namespace bindings and enclosing style rule. */
  parseSelectors(input: ParserInput): SelectorList | null {
    return this.ruleList.parseSelectors(input, this);
  }

  /** Validate and interpret a property once, before declaration-versus-rule recovery. */
  interpretDeclaration(declaration: SyntaxDeclaration): InterpretedDeclaration[] | null {
    return this.ruleList.interpretDeclaration(declaration, this);
  }

  /** Interpret a statement; null siblings mean standalone parsing, with placement checked by insertion. */
  // https://drafts.csswg.org/css-syntax-3/#consume-at-rule
  interpretStatementAtRule(
    rule: StatementAtRule,
    preceding: BlockContents | null,
  ): CSSRuleImpl | null {
    return this.ruleList.interpretStatementAtRule(rule, preceding, this);
  }

  /** Interpret a standard at-rule's prelude, placement, and entire block. */
  // https://drafts.csswg.org/css-syntax-3/#block-contents
  interpretBlockAtRule(
    name: string,
    prelude: TokenList<ComponentValue>,
    preceding: BlockContents | null,
    c: TokenCursor<Token>,
  ): CSSRuleImpl | null {
    return this.ruleList.interpretBlockAtRule(name, prelude, preceding, c, this);
  }

  /** Interpret selectors, consume their property/nested-rule block, and construct the style rule. */
  // https://drafts.csswg.org/css-syntax-3/#style-rules
  interpretQualifiedRule(prelude: TokenList<ComponentValue>, c: TokenCursor<Token>): CSSStyleRuleImpl | null {
    return this.ruleList.interpretQualifiedRule(prelude, c, this);
  }
}
