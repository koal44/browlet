import { TextCursor } from '../../infra/text-cursor';

import { consumeComments, consumeToken, filterCodePoints, TokenKind, type Token } from './tokens';

/** Tokens/components and their parallel ranges in the shared preprocessed text. */
export class TokenList<Value extends Token = Token> {
  /** Tokens in source order; use the list's methods for edits that change their positions. */
  tokens: Value[] = [];
  /** Full preprocessed input shared with nested and derived lists. */
  text: string;
  /** Source span corresponding to each token or component. */
  #ranges: SourceRange[] = [];

  /** Create an empty sequence sharing its input's preprocessed text. */
  constructor(text: string) {
    this.text = text;
  }

  /**
   * Tokenize complete CSS input; TokenCursor supplies EOF when the array is exhausted.
   * Enable unicode ranges only for the unicode-range descriptor's special parsing path.
   */
  // https://drafts.csswg.org/css-syntax-3/#tokenization
  // consumeUnicodeRangeDescriptorValue() opts in; ordinary parsing leaves it false.
  static tokenize(input: string, unicodeRangesAllowed = false): TokenList {
    const text = filterCodePoints(input);
    const c = new TextCursor(text);
    const list = new TokenList(text);

    while (true) {
      // Consume a token's leading comments before recording its source range.
      consumeComments(c);
      const start = c.pos();
      const token = consumeToken(c, unicodeRangesAllowed);

      if (token.type === TokenKind.EOF) {
        return list;
      }

      list.tokens.push(token);
      list.#ranges.push({ start, end: c.pos() });
    }
  }

  /** Read the source spelling of the token interval [start, end), or the whole list. */
  sourceText(start = 0, end = this.tokens.length): string {
    if (start === end) return '';

    return this.text.slice(this.#ranges[start]!.start, this.#ranges[end - 1]!.end);
  }

  /** Append a token/component covering [start, end) in a list sharing this source text. */
  append(token: Value, source: TokenList, start: number, end: number): void {
    const first = source.#ranges[start]!;
    const last = source.#ranges[end - 1]!;
    this.tokens.push(token);
    this.#ranges.push(first === last ? first : { start: first.start, end: last.end });
  }

  /** Copy an in-bounds token interval [start, end), retaining its original source spans. */
  slice(start: number, end = this.tokens.length): TokenList<Value> {
    const list = new TokenList<Value>(this.text);
    for (let i = start; i < end; i++) {
      list.tokens.push(this.tokens[i]!);
      list.#ranges.push(this.#ranges[i]!);
    }
    return list;
  }

  /** Discard tokens at and after an existing boundary, preserving earlier source spans. */
  truncate(length: number): void {
    this.tokens.length = length;
    this.#ranges.length = length;
  }

  /** Remove boundary whitespace while keeping token/source pairs and interior whitespace intact. */
  trimWhitespace(): void {
    let start = 0;
    let end = this.tokens.length;
    while (start < end && this.tokens[start]!.type === TokenKind.Whitespace) start++;
    while (end > start && this.tokens[end - 1]!.type === TokenKind.Whitespace) end--;

    if (start > 0) {
      this.tokens.copyWithin(0, start, end);
      this.#ranges.copyWithin(0, start, end);
    }
    this.truncate(end - start);
  }
}

export interface NonEmptyTokenList<Value extends Token> extends TokenList<Value> {
  tokens: [Value, ...Value[]];
}

/** Half-open UTF-16 offsets in the preprocessed source, excluding preceding comments. */
type SourceRange = {
  start: number;
  end: number;
};
