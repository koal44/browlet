import { TextCursor } from '../../infra/text-cursor';

import {
  consumeComments, consumeToken, filterCodePoints, TokenKind, type Token, type ComponentValue,
} from './tokens';
import { isComponentBlock, isFunctionBlock, needsComponentSeparator } from './component-value';

/** Tokens/components and their parallel ranges in the shared preprocessed text. */
export class TokenList<Value extends Token = Token> {
  /** Retained source components; computed function blocks point to their replacements. */
  sourceTokens: Value[] = [];
  /** Full preprocessed input shared with nested and derived lists. */
  #text: string;
  /** Source span corresponding to each token or component. */
  #ranges: SourceRange[] = [];
  /** Owned source interval, including comments outside the first and last tokens. */
  #start = 0;
  #end = 0;
  /** Whether this list already contains parsed component values. */
  #isComponentList: boolean;
  /** Whether source rendering must visit replacements or changed block contents. */
  #hasComputedReplacement = false;
  /** Replacement tokens exposed to grammar consumers, assembled without reading text. */
  #computedTokens?: Value[];
  /** Retained spelling with replacements, cached only after a text request. */
  #computedText?: string;
  /** Whether cached computed text ends in trivia rather than a grammar token. */
  #trailingTrivia = false;

  /** Create an empty sequence; a source position retains the comment gap at that position. */
  constructor(source: string | TokenList, isComponentList = false, position?: number) {
    this.#text = typeof source === 'string' ? source : source.#text;
    this.#isComponentList = isComponentList;
    if (typeof source !== 'string' && position !== undefined) {
      this.#start = source.#ranges[position - 1]?.end ?? source.#start;
      this.#end = source.#ranges[position]?.start ?? source.#end;
    }
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
    list.#end = text.length;

    while (true) {
      // Consume a token's leading comments before recording its source range.
      consumeComments(c);
      const start = c.pos();
      const token = consumeToken(c, unicodeRangesAllowed);

      if (token.type === TokenKind.EOF) {
        return list;
      }

      list.sourceTokens.push(token);
      list.#ranges.push({ start, end: c.pos() });
    }
  }

  /** Tokens presented to grammar consumers; replacement functions contribute their contents. */
  get tokens(): Value[] {
    if (!this.#hasComputedReplacement) return this.sourceTokens;
    if (this.#computedTokens !== undefined) return this.#computedTokens;
    const tokens: Value[] = [];
    for (const token of this.sourceTokens) {
      if (isFunctionBlock(token) && token.replacement !== undefined) {
        for (const replacement of token.replacement.tokens) tokens.push(replacement as Value);
      } else {
        tokens.push(token);
      }
    }
    return this.#computedTokens = tokens;
  }

  /** Recognize components from their construction, without inspecting the token array. */
  isComponentList(): this is TokenList<ComponentValue> {
    return this.#isComponentList;
  }

  /** Read retained spelling, following computed replacements only when text is requested. */
  sourceText(start?: number, end?: number): string {
    if (!this.#hasComputedReplacement) {
      if (start === undefined && end === undefined) {
        return this.#text.slice(this.#start, this.#end);
      }
      start ??= 0;
      end ??= this.sourceTokens.length;
      return start === end ? '' : this.#text.slice(this.#ranges[start]!.start, this.#ranges[end - 1]!.end);
    }
    if (start !== undefined || end !== undefined) return this.slice(start ?? 0, end).sourceText();
    return this.#computedText ??= this.#readComputedSource();
  }

  /** Append a component covering sourceTokens[start, end) in a list sharing this source text. */
  append(token: Value, source: TokenList, start: number, end: number): void {
    const first = source.#ranges[start]!;
    const last = source.#ranges[end - 1]!;
    if (this.sourceTokens.length === 0) this.#start = source.#ranges[start - 1]?.end ?? source.#start;
    this.#end = source.#ranges[end]?.start ?? source.#end;
    this.sourceTokens.push(token);
    this.#ranges.push(first === last ? first : { start: first.start, end: last.end });
    this.#hasComputedReplacement ||= isComponentBlock(token) && (
      token.value.#hasComputedReplacement || (isFunctionBlock(token) && token.replacement !== undefined)
    );
    this.#computedTokens = undefined;
    this.#computedText = undefined;
  }

  /** Select grammar tokens in [start, end), retaining comments beside skipped boundary whitespace. */
  slice(start: number, end = this.tokens.length): TokenList<Value> {
    const list = new TokenList<Value>(this, this.#isComponentList);
    if (!this.#hasComputedReplacement) {
      const range = this.#sliceRange(start, end);
      list.#start = range.start;
      list.#end = range.end;
      list.sourceTokens = this.sourceTokens.slice(start, end);
      list.#ranges = this.#ranges.slice(start, end);
      return list;
    }
    const tokens = this.tokens;
    let before = start;
    let after = end;
    while (before > 0 && tokens[before - 1]!.type === TokenKind.Whitespace) before--;
    while (after < tokens.length && tokens[after]!.type === TokenKind.Whitespace) after++;
    let index = 0;
    let sourceStart = 0;
    let sourceEnd = 0;
    let insideStart = false;
    let insideEnd = false;
    for (let i = 0; i < this.sourceTokens.length; i++) {
      const token = this.sourceTokens[i]!;
      const replacement = isFunctionBlock(token) ? token.replacement : undefined;
      const length = replacement?.tokens.length ?? 1;
      // A replacement touching the boundary can contribute comments without contributing tokens.
      if (replacement === undefined
        ? index >= start && index < end
        : index + length >= before && index <= after) {
        if (list.sourceTokens.length === 0) {
          sourceStart = i;
          insideStart = index < before;
        }
        sourceEnd = i + 1;
        insideEnd = index + length > after;
        let selected = token;
        if (replacement !== undefined && (index < start || index + length > end)) {
          const from = Math.min(length, Math.max(0, start - index));
          const to = Math.max(0, Math.min(length, end - index));
          selected = { ...token, replacement: replacement.slice(from, to) };
        }
        list.append(selected, this, i, i + 1);
      } else if (index + length <= start && list.sourceTokens.length === 0) {
        sourceStart = sourceEnd = i + 1;
      }
      index += length;
    }
    const range = this.#sliceRange(sourceStart, sourceEnd);
    list.#start = insideStart ? this.#ranges[sourceStart]!.start : range.start;
    list.#end = insideEnd ? this.#ranges[sourceEnd - 1]!.end : range.end;
    return list;
  }

  /** Discard retained source components at and after a source position during syntax construction. */
  truncate(length: number): void {
    this.#end = this.#ranges[length]?.start ?? this.#end;
    this.sourceTokens.length = length;
    this.#ranges.length = length;
    this.#computedTokens = undefined;
    this.#computedText = undefined;
  }

  /** Trim boundary whitespace during syntax construction, preserving source pairs and interior whitespace. */
  trimWhitespace(): void {
    let start = 0;
    let end = this.sourceTokens.length;
    while (start < end && this.sourceTokens[start]!.type === TokenKind.Whitespace) start++;
    while (end > start && this.sourceTokens[end - 1]!.type === TokenKind.Whitespace) end--;
    const range = this.#sliceRange(start, end);
    this.#start = range.start;
    this.#end = range.end;

    if (start > 0) {
      this.sourceTokens.copyWithin(0, start, end);
      this.#ranges.copyWithin(0, start, end);
    }
    this.sourceTokens.length = end - start;
    this.#ranges.length = end - start;
    this.#computedTokens = undefined;
    this.#computedText = undefined;
  }

  /** Keep comments in adjacent whitespace even when a grammar has skipped those tokens. */
  #sliceRange(start: number, end: number): SourceRange {
    let before = start;
    let after = end;
    while (before > 0 && this.sourceTokens[before - 1]!.type === TokenKind.Whitespace) before--;
    while (after < this.sourceTokens.length && this.sourceTokens[after]!.type === TokenKind.Whitespace) after++;
    let left = this.#ranges[before - 1]?.end ?? this.#start;
    let right = this.#ranges[after]?.start ?? this.#end;
    for (let i = before; i < start; i++) {
      const range = this.#ranges[i]!;
      if (range.start !== left) break;
      left = range.end;
    }
    for (let i = after; i > (start === end ? before : end); i--) {
      const range = this.#ranges[i - 1]!;
      if (range.end !== right) break;
      right = range.start;
    }
    return { start: left, end: Math.max(left, right) };
  }

  /** Render token spellings and comments without restoring discarded whitespace. */
  // https://drafts.csswg.org/css-variables-1/#serializing-custom-props
  // SPEC_CLASH(custom-property-substitution-comments): Preserve retained comments
  // after substitution; native serializers differ on adjacent and exposed comments.
  #readComputedSource(): string {
    const end = this.sourceTokens.length;
    let text = '';
    let previousEnd = this.#start;
    let previous: ComponentValue | undefined;
    let separated = true;
    let replacementBoundary = false;
    for (let i = 0; i < end; i++) {
      const token = this.sourceTokens[i]!;
      const range = this.#ranges[i]!;
      const comments = this.#sourceComments(previousEnd, range.start);
      text += comments;
      if (comments !== '') separated = true;
      const replacement = isFunctionBlock(token) ? token.replacement : undefined;
      const replacementText = replacement === undefined ? ''
        : replacement.#computedText ??= replacement.#readComputedSource();
      const first = replacement === undefined ? token as ComponentValue : replacement.tokens[0];
      if (replacementText.startsWith('/*')) separated = true;
      if (replacement !== undefined || replacementBoundary) {
        if (!separated && previous !== undefined && first !== undefined && needsComponentSeparator(previous, first)) {
          text += '/**/';
        }
      }
      if (replacement !== undefined) {
        text += replacementText;
        replacementBoundary = true;
        if (replacement.tokens.length > 0) {
          previous = replacement.tokens.at(-1);
          separated = false;
        }
        if (replacement.#trailingTrivia) separated = true;
      } else {
        if (isComponentBlock(token) && token.value.#hasComputedReplacement) {
          const contents = token.value;
          text += this.#text.slice(range.start, contents.#start) + contents.sourceText() +
            this.#text.slice(contents.#end, range.end);
        } else {
          text += this.#text.slice(range.start, range.end);
        }
        previous = token as ComponentValue;
        separated = false;
        replacementBoundary = false;
      }
      previousEnd = range.end;
    }
    const comments = this.#sourceComments(previousEnd, this.#end);
    text += comments;
    this.#trailingTrivia = text.length > 0 && (separated || comments !== '');
    return text;
  }

  /** Keep comments in a gap, without restoring whitespace discarded by grammar selection. */
  // SPEC_GAP(fallback-comment-whitespace): Preserve comments but omit discarded
  // whitespace from replacement text, keeping it consistent with the selected tokens.
  #sourceComments(start: number, end: number): string {
    return this.#text.slice(start, end).match(/\/\*[\s\S]*?(?:\*\/|$)/g)?.join('') ?? '';
  }
}

export interface NonEmptyTokenList<Value extends Token> extends TokenList<Value> {
  tokens: [Value, ...Value[]];
}

/** Half-open UTF-16 offsets in the preprocessed source. */
type SourceRange = {
  start: number;
  end: number;
};
