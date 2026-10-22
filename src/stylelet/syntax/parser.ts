import { asciiLower } from '../../infra/ascii';

import type { InterpretedDeclaration } from '../cssom/declarations/index';
import type { CSSRuleImpl, RuleListContext } from '../cssom/index';

import {
  isBraceBlock, isDelimToken, isIdentToken, isTokenKind, isWhitespaceToken,
  type ComponentValue, type FunctionBlock, type SimpleBlock,
} from './component-value';
import { TokenCursor, type TryConsumer, type TryConsumerResult } from './token-cursor';
import { TokenList } from './token-list';
import { TokenKind, type Token } from './tokens';

/** Statement syntax supplied to the owning stylesheet's rule interpretation. */
// https://drafts.csswg.org/css-syntax-3/#css-tree
export type StatementAtRule = {
  type: 'statement-at-rule';
  name: string;
  prelude: TokenList<ComponentValue>;
};

/** A property or descriptor's syntax, before its grammar is interpreted. */
// https://drafts.csswg.org/css-syntax-3/#declaration
export type SyntaxDeclaration = {
  name: string;
  value: TokenList<ComponentValue>;
  important: boolean;
};

/** Interpreted declaration runs and CSSOM rules in source order. */
// https://drafts.csswg.org/css-syntax-3/#block-contents
export type BlockContents = Array<InterpretedDeclaration[] | CSSRuleImpl>;

/** CSS text, tokens/components, or a stream at its current position; decode bytes first. */
export type ParserInput = string | TokenList | TokenCursor<Token>;

/** Bind a component grammar to a parser entry point. */
export function createComponentParser<T, Context>(
  consumer: TryConsumer<T, Context>,
): (
  input: ParserInput,
  context: Context,
) => TryConsumerResult<T> {
  return (input, context) =>
    parseAsComponentGrammar(input, consumer, context);
}

/** Match the entire remaining input against a grammar, returning null on failure. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#parse-grammar
export function parseAsComponentGrammar<T, Context>(
  input: ParserInput,
  consumer: TryConsumer<T, Context>,
  context: Context,
): TryConsumerResult<T> {
  const list = parseListOfComponentValues(input, context);
  const c = new TokenCursor(list, context);
  const result = consumer(c);

  if (result === null) return null;

  c.consumeWhile(isWhitespaceToken);
  return c.eof() ? result : null;
}

/** Match comma-separated items independently; a failed item contributes null. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#parse-comma-list
export function parseListAsComponentGrammar<T, Context>(
  input: ParserInput,
  consumer: TryConsumer<T, Context>,
  context: Context,
): (TryConsumerResult<T>)[] {
  const lists = parseCommaSeparatedListOfComponentValues(input, context);

  if (
    lists.length === 1 &&
    lists[0]!.tokens.length > 0 &&
    lists[0]!.tokens.every(isWhitespaceToken)
  ) {
    return [];
  }

  return lists.map((item) => parseAsComponentGrammar(item, consumer, context));
}

/** Parse stylesheet contents using the owning grammar's interpretation of each rule. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#parse-stylesheet-contents
export function parseStylesheetContents(
  input: ParserInput,
  context: RuleListContext,
): CSSRuleImpl[] {
  return consumeInput(input, context, consumeStylesheetContents);
}

/** Parse mixed declaration/rule content, stopping before an unmatched closing brace. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#parse-block-contents
export function parseBlockContents(
  input: ParserInput,
  context: RuleListContext,
): BlockContents {
  return consumeInput(input, context, consumeBlockContents);
}

/** Parse exactly one rule in its grammar context; return null on invalid or extra input. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#parse-rule
export function parseRule(
  input: ParserInput,
  context: RuleListContext,
): CSSRuleImpl | null {
  return consumeInput(input, context, consumeSingleRule);
}

/** Read declaration syntax in the caller's context, without interpreting its property or descriptor. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#parse-declaration
export function parseDeclaration<Context>(input: ParserInput, context: Context): SyntaxDeclaration | null {
  return consumeInput(input, context, consumeSingleDeclaration);
}

/** Parse exactly one component value, allowing surrounding whitespace; return null otherwise. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#parse-component-value
export function parseComponentValue<Context>(input: ParserInput, context: Context): ComponentValue | null {
  return consumeInput(input, context, consumeSingleComponentValue);
}

/** Consume all remaining components, reusing blocks that have already been parsed. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#parse-list-of-component-values
export function parseListOfComponentValues<Context>(input: ParserInput, context: Context): TokenList<ComponentValue> {
  if (typeof input !== 'string' && !(input instanceof TokenCursor) && input.isComponentList()) {
    return input;
  }

  return consumeInput(input, context, consumeListOfComponentValues);
}

/** Split on top-level commas, retaining empty arms except for an empty trailing arm. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#parse-comma-separated-list-of-component-values
export function parseCommaSeparatedListOfComponentValues<Context>(
  input: ParserInput,
  context: Context,
): TokenList<ComponentValue>[] {
  return consumeInput(input, context, consumeCommaSeparatedListOfComponentValues);
}

/**
 * Parse declaration-only input into syntax records, without validating property names or values.
 * Preserve the caller's context and recover through semicolons without admitting nested style rules.
 */
// CSS Style Attributes: https://drafts.csswg.org/css-style-attr/#syntax
// This entry point implements that grammar using the shared CSS Syntax consumers.
// SPEC_CLASH(css-style-attribute-parsing): Follow CSS Style Attributes and all
// three engines. CSSOM's newer block-contents reference also admits nested rules
// and treats an unmatched closing brace as the end of the whole input.
export function parseDeclarationList<Context>(input: ParserInput, context: Context): SyntaxDeclaration[] {
  return consumeInput(input, context, consumeDeclarationList);
}

/** Skip an invalid rule's balanced block without interpreting its children. */
export function discardRuleBlock<Value extends Token>(c: TokenCursor<Value>): void {
  consumeComponentValue(c);
}

/** Consume a brace-delimited block, including its closing brace when present. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#consume-block
export function consumeBlock<Value extends Token>(
  c: TokenCursor<Value, RuleListContext>,
): BlockContents {
  const opening = c.peek();

  if (isBraceBlock(opening)) {
    c.next();
    return consumeBlockContents(new TokenCursor(opening.value, c.context));
  }

  if (opening.type !== TokenKind.LeftBrace) {
    c.error('Expected an opening brace token');
  }

  c.next();
  const contents = consumeBlockContents(c);
  c.next();
  return contents;
}

/** Consume the declaration-only attribute grammar, ignoring complete at-rules. */
// https://drafts.csswg.org/css-style-attr/#syntax
function consumeDeclarationList(c: TokenCursor<Token>): SyntaxDeclaration[] {
  const declarations: SyntaxDeclaration[] = [];
  while (!c.eof()) {
    const type = c.peek().type;
    if (type === TokenKind.Whitespace || type === TokenKind.Semicolon) {
      c.next();
    } else if (type === TokenKind.AtKeyword) {
      discardAtRule(c);
    } else {
      const declaration = consumeDeclaration(c);
      if (declaration !== null) declarations.push(declaration);
    }
  }
  return declarations;
}

/** Skip a complete at-rule in declaration-only input without invoking rule interpretation. */
// CSS Style Attributes: https://drafts.csswg.org/css-style-attr/#syntax
// Consume the same boundary as https://drafts.csswg.org/css-syntax-3/#consume-at-rule.
function discardAtRule(c: TokenCursor<Token>): void {
  c.next();
  while (true) {
    switch (c.peek().type) {
      case TokenKind.EOF:
        return;
      case TokenKind.Semicolon:
        c.next();
        return;
      case TokenKind.LeftBrace:
      case TokenKind.BraceBlock:
        discardRuleBlock(c);
        return;
      default:
        consumeComponentValue(c);
    }
  }
}

/** Consume one complete component, allowing surrounding trivia. */
function consumeSingleComponentValue(c: TokenCursor<Token>): ComponentValue | null {
  consumeTrivia(c);
  if (c.eof()) return null;

  const component = consumeComponentValue(c);

  consumeTrivia(c);
  return c.eof() ? component : null;
}

/** Consume comma-delimited component lists without manufacturing a final empty arm. */
function consumeCommaSeparatedListOfComponentValues(c: TokenCursor<Token>): TokenList<ComponentValue>[] {
  const groups: TokenList<ComponentValue>[] = [];

  while (!c.eof()) {
    groups.push(consumeListOfComponentValues(c, TokenKind.Comma));
    c.next();
  }

  return groups;
}

/** Consume with the selected context, restoring it only when the cursor belongs to the caller. */
function consumeInput<Context, Result>(
  input: ParserInput,
  context: Context,
  consume: (c: TokenCursor<Token, Context>) => Result,
): Result {
  if (input instanceof TokenCursor) return input.withContext(context, consume);
  return consume(normalize(input, context));
}

/** Create a cursor with its parsing context, retaining source locations when tokenizing text. */
// https://drafts.csswg.org/css-syntax-3/#normalize-into-a-token-stream
function normalize<Context>(input: string | TokenList, context: Context): TokenCursor<Token, Context> {
  if (typeof input !== 'string') return new TokenCursor(input, context);

  return new TokenCursor(TokenList.tokenize(input), context);
}

/** Discard whitespace tokens; comments were already consumed by tokenization. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#token-stream-discard-whitespace
function consumeTrivia<Value extends Token>(c: TokenCursor<Value>): void {
  c.consumeWhile(isWhitespaceToken);
}

/** Consume whole-sheet rules, ignoring top-level CDO/CDC tokens and malformed rules. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#consume-stylesheet-contents
function consumeStylesheetContents(
  c: TokenCursor<Token, RuleListContext>,
): CSSRuleImpl[] {
  const rules: CSSRuleImpl[] = [];

  while (true) {
    switch (c.peek().type) {
      case TokenKind.Whitespace:
      case TokenKind.CDO:
      case TokenKind.CDC:
        c.next();
        break;

      case TokenKind.EOF:
        return rules;

      case TokenKind.AtKeyword: {
        const rule = consumeAtRule(c, false, rules);
        if (rule !== null) rules.push(rule);
        break;
      }

      default: {
        const rule = consumeQualifiedRule(c);
        if (rule !== null) rules.push(rule);
      }
    }
  }
}

/** Apply the single-rule entry algorithm using the supplied grammar context. */
// Extracted from https://drafts.csswg.org/css-syntax-3/#parse-rule
function consumeSingleRule(
  c: TokenCursor<Token, RuleListContext>,
): CSSRuleImpl | null {
  consumeTrivia(c);
  if (c.eof()) return null;

  const rule = c.peek().type === TokenKind.AtKeyword
    ? consumeAtRule(c, false, null)
    : consumeQualifiedRule(c);

  if (rule === null) return null;

  consumeTrivia(c);
  return c.eof() ? rule : null;
}

/** Consume and validate an at-rule; nested input leaves the containing closing brace unread. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#consume-at-rule
function consumeAtRule<Value extends Token>(
  c: TokenCursor<Value, RuleListContext>,
  nested: boolean,
  preceding: BlockContents | null,
): CSSRuleImpl | null {
  const token = c.next();

  if (token.type !== TokenKind.AtKeyword) {
    c.error('Expected an at-keyword token');
  }

  const name = token.value;
  const prelude = new TokenList<ComponentValue>(c.source, true, c.pos());

  while (true) {
    switch (c.peek().type) {
      case TokenKind.Semicolon:
      case TokenKind.EOF:
        c.next();
        return c.context.interpretStatementAtRule({ type: 'statement-at-rule', name, prelude }, preceding);

      case TokenKind.RightBrace:
        if (nested) {
          return c.context.interpretStatementAtRule({ type: 'statement-at-rule', name, prelude }, preceding);
        }
        consumeComponentValueInto(c, prelude);
        break;

      case TokenKind.LeftBrace:
      case TokenKind.BraceBlock:
        return c.context.interpretBlockAtRule(name, prelude, preceding, c);

      default:
        consumeComponentValueInto(c, prelude);
    }
  }
}

/** Consume a qualified rule, returning null for an incomplete or declaration-shaped construct. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#consume-qualified-rule
// SPEC_CLASH(css-invalid-rule-declaration-runs): A rejected rule returns null,
// just like an incomplete rule, so discarded rules do not split declaration runs.
function consumeQualifiedRule<Value extends Token>(
  c: TokenCursor<Value, RuleListContext>,
  stopToken?: TokenKind,
  nested = false,
): CSSRuleImpl | null {
  const prelude = new TokenList<ComponentValue>(c.source, true, c.pos());

  while (true) {
    const token = c.peek();

    if (token.type === TokenKind.EOF || token.type === stopToken) {
      return null;
    }

    if (token.type === TokenKind.RightBrace) {
      if (nested) return null;

      consumeComponentValueInto(c, prelude);
      continue;
    }

    if (
      token.type === TokenKind.LeftBrace ||
      token.type === TokenKind.BraceBlock
    ) {
      if (looksLikeCustomProperty(prelude.tokens)) {
        if (nested) {
          consumeBadDeclarationRemnants(c, true);
        } else {
          discardRuleBlock(c);
        }
        return null;
      }

      return c.context.interpretQualifiedRule(prelude, c);
    }

    consumeComponentValueInto(c, prelude);
  }
}

/** Identify the custom-property prefix excluded from qualified-rule syntax. */
// Extracted from https://drafts.csswg.org/css-syntax-3/#consume-qualified-rule
function looksLikeCustomProperty(prelude: ComponentValue[]): boolean {
  const components = prelude.filter((component) => !isWhitespaceToken(component));

  return components.length >= 2 &&
    isIdentToken(components[0]!) &&
    components[0].value.startsWith('--') &&
    isTokenKind(components[1]!, TokenKind.Colon);
}

/** Consume ordered declaration runs and rules, leaving a containing closing brace unread. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#consume-block-contents
function consumeBlockContents<Value extends Token>(
  c: TokenCursor<Value, RuleListContext>,
): BlockContents {
  const contents: BlockContents = [];
  let declarations: InterpretedDeclaration[] = [];

  const flushDeclarations = (): void => {
    if (declarations.length === 0) return;

    contents.push(declarations);
    declarations = [];
  };

  while (true) {
    switch (c.peek().type) {
      case TokenKind.Whitespace:
      case TokenKind.Semicolon:
        c.next();
        break;

      case TokenKind.EOF:
      case TokenKind.RightBrace:
        // SPEC_CLASH(css-block-final-declarations): Retain the final run, as all
        // browsers do. The draft's return step omits it and would lose even a
        // declaration-only block; the rest of the algorithm requires this flush.
        flushDeclarations();
        return contents;

      case TokenKind.AtKeyword: {
        flushDeclarations();
        const rule = consumeAtRule(c, true, contents);
        if (rule !== null) contents.push(rule);
        break;
      }

      default: {
        const start = c.pos();
        const syntax = consumeDeclaration(c, true);
        const expanded = syntax === null ? null : c.context.interpretDeclaration(syntax);

        if (expanded !== null) {
          declarations.push(...expanded);
          break;
        }

        c.restore(start);
        const rule = consumeQualifiedRule(c, TokenKind.Semicolon, true);

        if (rule !== null) {
          flushDeclarations();
          contents.push(rule);
        }
      }
    }
  }
}

/** Consume a standalone declaration after leading whitespace, leaving its semicolon unread. */
// Extracted from https://drafts.csswg.org/css-syntax-3/#parse-declaration
function consumeSingleDeclaration(c: TokenCursor<Token>): SyntaxDeclaration | null {
  consumeTrivia(c);
  return consumeDeclaration(c);
}

/** Consume declaration syntax and priority; the owning grammar interprets the result. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#consume-declaration
// SPEC_MISMATCH: consume a declaration(input, nested) -> declaration
// The value list retains the original text; the declaration does not store a second string.
function consumeDeclaration<Value extends Token>(
  c: TokenCursor<Value>,
  nested = false,
): SyntaxDeclaration | null {
  const token = c.peek();

  if (!isIdentToken(token)) {
    consumeBadDeclarationRemnants(c, nested);
    return null;
  }

  c.next();

  consumeTrivia(c);

  if (c.peek().type !== TokenKind.Colon) {
    consumeBadDeclarationRemnants(c, nested);
    return null;
  }

  c.next();
  const valueStart = c.pos();
  const declaration: SyntaxDeclaration = {
    name: token.value,
    value: consumeListOfComponentValues(c, TokenKind.Semicolon, nested),
    important: false,
  };
  const valueEnd = c.pos();

  consumeImportantFlag(declaration);
  declaration.value.trimWhitespace();

  if (!declaration.name.startsWith('--')) {
    if (hasDisallowedTopLevelBraceBlock(declaration.value.tokens)) return null;
    if (asciiLower(declaration.name) === 'unicode-range') {
      const originalText = c.source.sourceText(valueStart, valueEnd);
      declaration.value = consumeUnicodeRangeDescriptorValue(originalText, c.context);
      declaration.value.trimWhitespace();
    }
  }

  return declaration;
}

/** Recover through the next semicolon, or stop before the containing brace in nested input. */
// Bad-declaration recovery: https://drafts.csswg.org/css-syntax-3/#consume-declaration
function consumeBadDeclarationRemnants<Value extends Token>(
  c: TokenCursor<Value>,
  nested: boolean,
): void {
  while (true) {
    switch (c.peek().type) {
      case TokenKind.EOF:
      case TokenKind.Semicolon:
        c.next();
        return;

      case TokenKind.RightBrace:
        if (nested) return;
        c.next();
        break;

      default:
        consumeComponentValue(c);
    }
  }
}

/** Remove a final important flag and following whitespace. */
// Extracted from https://drafts.csswg.org/css-syntax-3/#consume-declaration
function consumeImportantFlag(declaration: SyntaxDeclaration): void {
  const components = declaration.value.tokens;
  const importantIndex = lastNonWhitespaceIndex(components, components.length - 1);
  if (importantIndex < 0) return;

  const bangIndex = lastNonWhitespaceIndex(components, importantIndex - 1);
  if (bangIndex < 0) return;

  const bang = components[bangIndex]!;
  const important = components[importantIndex]!;

  if (
    isDelimToken(bang, '!') &&
    isIdentToken(important) &&
    asciiLower(important.value) === 'important'
  ) {
    declaration.value.truncate(bangIndex);
    declaration.important = true;
  }
}

/** Locate the last significant component at or before start, or return -1. */
function lastNonWhitespaceIndex(
  components: ComponentValue[],
  start: number,
): number {
  for (let i = start; i >= 0; i--) {
    if (!isWhitespaceToken(components[i]!)) return i;
  }

  return -1;
}

/** Detect a brace block mixed with another significant value in a non-custom declaration. */
// Extracted from https://drafts.csswg.org/css-syntax-3/#consume-declaration
function hasDisallowedTopLevelBraceBlock(components: ComponentValue[]): boolean {
  const significant = components.filter((component) => !isWhitespaceToken(component));
  const braces = significant.filter(isBraceBlock);

  return braces.length > 0 && (significant.length !== 1 || braces.length !== 1);
}

/** Consume components up to EOF, the stop token, or a containing brace in nested input. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#consume-list-of-components
function consumeListOfComponentValues<Value extends Token>(
  c: TokenCursor<Value>,
  stopToken?: TokenKind,
  nested = false,
): TokenList<ComponentValue> {
  const source: TokenList = c.source;
  if (source.isComponentList()) {
    const start = c.pos();
    while (!c.eof() && c.peek().type !== stopToken && (!nested || c.peek().type !== TokenKind.RightBrace)) c.next();
    return source.slice(start, c.pos());
  }
  const list = new TokenList<ComponentValue>(c.source, true, c.pos());

  while (true) {
    const token = c.peek();

    if (token.type === TokenKind.EOF || token.type === stopToken) {
      return list;
    }

    if (token.type === TokenKind.RightBrace && nested) {
      return list;
    }

    consumeComponentValueInto(c, list);
  }
}

/** Fold one component while recording its complete consumed span in the output sequence. */
function consumeComponentValueInto<Value extends Token>(c: TokenCursor<Value>, list: TokenList<ComponentValue>): void {
  const start = c.pos();
  const component = consumeComponentValue(c);
  list.append(component, c.source, start, c.pos());
}

/** Consume a preserved token or fold an opening token into a block/function. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#consume-component-value
// The parser uses one cursor abstraction for both lexical token streams and
// component-value streams. Consuming a component value folds opening and
// function tokens into blocks; grammar consumers then reuse the same cursor
// over the resulting component values.
function consumeComponentValue<Value extends Token>(
  c: TokenCursor<Value>,
): ComponentValue {
  switch (c.peek().type) {
    case TokenKind.LeftBrace:
    case TokenKind.LeftBracket:
    case TokenKind.LeftParen:
      return consumeSimpleBlock(c);

    case TokenKind.Function:
      return consumeFunction(c);

    case TokenKind.EOF:
      return c.error('Unexpected end of token stream');

    default:
      return c.next() as ComponentValue;
  }
}

/** Consume a simple block through its matching delimiter, closing it implicitly at EOF. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#consume-simple-block
function consumeSimpleBlock<Value extends Token>(
  c: TokenCursor<Value>,
): SimpleBlock {
  const opening = c.peek();
  let type: SimpleBlock['type'];
  let ending: TokenKind;

  switch (opening.type) {
    case TokenKind.LeftBrace:
      type = TokenKind.BraceBlock;
      ending = TokenKind.RightBrace;
      break;

    case TokenKind.LeftBracket:
      type = TokenKind.BracketBlock;
      ending = TokenKind.RightBracket;
      break;

    case TokenKind.LeftParen:
      type = TokenKind.ParensBlock;
      ending = TokenKind.RightParen;
      break;

    default:
      c.error('Expected an opening block token');
  }

  c.next();
  const list = consumeListOfComponentValues(c, ending);
  c.next();
  return { type, value: list };
}

/** Consume a function through its matching parenthesis, closing it implicitly at EOF. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#consume-function
function consumeFunction<Value extends Token>(
  c: TokenCursor<Value>,
): FunctionBlock {
  const token = c.next();

  if (token.type !== TokenKind.Function) {
    c.error('Expected a function token');
  }

  const list = consumeListOfComponentValues(c, TokenKind.RightParen);
  c.next();
  return { type: TokenKind.FunctionBlock, name: token.value, value: list };
}

/** Retokenize a unicode-range descriptor's source; its grammar validates the resulting ranges. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#consume-unicode-range-value
function consumeUnicodeRangeDescriptorValue<Context>(input: string, context: Context): TokenList<ComponentValue> {
  return parseListOfComponentValues(TokenList.tokenize(input, true), context);
}
