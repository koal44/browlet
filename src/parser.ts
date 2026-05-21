import { isCssSpace } from "./utils/css";

// Parse a normal selector list. In forgiving mode, invalid selector-list arms
// are dropped; this is intended for :is()/:where() argument parsing.
export function parse(selectors: string, re: Rex, forgiving = false): string[] {
  if (selectors === '') {
    throw new Error(`[parse] '' is not a valid selector`);
  }

  const normalized = normalizeSelectorInput(selectors, re);

  if (!forgiving && normalized.endsWith(',')) {
    throw new Error(`[parse] Selector cannot end with a comma: '${selectors}'`);
  }

  const groups = splitSelectorGroups(normalized)
    .map(group => trimSelectorSpaces(group));

  const valid: string[] = [];

  for (const group of groups) {
    if (!group) {
      if (!forgiving) {
        throw new Error(`[parse] Empty selector-list item in selector: '${selectors}'`);
      }
      continue;
    }

    if (/^[>+~]/.test(group)) {
      if (!forgiving) {
        throw new Error(`[parse] Relative selector is not valid here: '${group}'`);
      }
      continue;
    }

    const validated = group.match(re.validator);
    if (validated?.join('') === group) {
      valid.push(group);
      continue;
    }

    if (!forgiving) {
      throw new Error(`[parse] Failed to validate selector: '${group}'`);
    }
  }

  return valid;
}

export function normalizeSelectorInput(selectors: string, re: Rex): string {
  let
  normalized = stripCssComments(selectors);
  normalized = normalizeNestingSelector(normalized);
  normalized = normalized
    .replace(/\x00|\\$/g, '\ufffd')
    .replace(re.CombineWSP, '\x20')
    .replace(re.PseudosWSP, '$1$2')
    .replace(re.TabCharWSP, '\t')
    .replace(re.CommaGroup, ',')
    // .replace(re.TrimSpaces, '');
  normalized = trimSelectorSpaces(normalized);
  return normalized;
}

export function matchLogicalSelector(selector: string): RegExpMatchArray | null {
  const head = /^:(is|where|matches|not|has)\(/i.exec(selector);
  if (!head) return null;

  const open = head[0].length - 1;
  let close = findClosingParen(selector, open);

  // Browser-compatible tolerance: a missing final ")" on these functional
  // pseudos is treated as if the pseudo closed at EOF.
  if (close < 0) close = selector.length;

  const argStart = open + 1;
  const arg = selector.slice(argStart, close).trim();
  const tail = close < selector.length ? selector.slice(close + 1) : '';

  return Object.assign([selector, head[1], arg, tail], {
    index: 0,
    input: selector,
  }) as RegExpMatchArray;
}

function findClosingParen(input: string, openIndex: number): number {
  let depth = 1;
  let quote: '"' | "'" | null = null;
  let inAttr = false;

  for (let i = openIndex + 1; i < input.length; i++) {
    const ch = input[i];

    if (ch === '\\') { i++; continue; }
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (inAttr) { if (ch === ']') inAttr = false; continue; }
    if (ch === '[') { inAttr = true; continue; }
    if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i;
  }

  return -1;
}

// Scans selector chars that are top-level with respect to escapes, strings, attribute selectors, and parentheses.
// The visitor returns how many chars it consumed from `index`.
function scanTopLevel(source: string, visit: (index: number, ch: string) => number): void {
  let depth = 0;
  let quote = '';
  let inAttr = false;

  for (let i = 0; i < source.length;) {
    const ch = source[i];
    if (ch === '\\') i += 2;
    else if (quote) { if (ch === quote) quote = ''; i++; }
    else if (ch === '"' || ch === "'") { quote = ch; i++; }
    else if (inAttr) { if (ch === ']') inAttr = false; i++; }
    else if (ch === '[') { inAttr = true; i++; }
    else if (ch === '(') { depth++; i++; }
    else if (ch === ')' && depth) { depth--; i++; }
    else if (depth !== 0) i++;
    else {
      const consumed = visit(i, ch);
      if (consumed <= 0) throw new Error('scanTopLevel visitor must consume at least one character');
      i += consumed;
    }
  }
}

export function splitSelectorGroups(selector: string): string[] {
  const out: string[] = [];
  let start = 0;

  scanTopLevel(selector, (index, ch) => {
    if (ch === ',') {
      out.push(selector.slice(start, index));
      start = index + 1;
    }

    return 1;
  });

  out.push(selector.slice(start));
  return out;
}

export function findUnescapedPipe(str: string): number {
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '\\') { i++; continue; }
    if (str[i] === '|') return i;
  }
  return -1;
}

export function parseRelativeSelectorList(source: string): RelativeSelectorList {
  const selectors = splitSelectorGroups(source).map(raw => {
    const branch = raw.trim();
    return parseRelativeSelector(branch);
  });

  return {
    kind: 'relative-selector-list', source, selectors,
  };
}

function parseRelativeSelector(source: string): RelativeSelector {
  return {
    kind: 'relative', source, steps: parseRelativeSteps(source),
  };
}

function parseRelativeSteps(source: string): RelativeStep[] {
  const steps: RelativeStep[] = [];

  let combinator: SelectorCombinator = ' ';
  let start = skipSelectorSpaces(source, 0);

  const push = (end: number) => {
    const compound = source.slice(start, end).trim();

    if (!compound) {
      return false;
    }

    steps.push({
      kind: 'relative-step',
      combinator,
      compound: {
        kind: 'compound',
        source: compound,
      },
    });

    combinator = ' ';
    return true;
  };

  scanTopLevel(source, (index, ch) => {
    if (index < start) {
      return 1;
    }

    if (isExplicitCombinator(ch)) {
      push(index);
      combinator = ch;

      const next = skipSelectorSpaces(source, index + 1);
      start = next;

      return next - index;
    }

    if (isSelectorSpace(ch)) {
      const next = skipSelectorSpaces(source, index + 1);
      const nextChar = source[next];

      // Whitespace before explicit combinator is padding:
      // `.a   > .b`
      if (isExplicitCombinator(nextChar)) {
        return next - index;
      }

      // Trailing whitespace.
      if (next >= source.length) {
        return source.length - index;
      }

      // Otherwise whitespace is a descendant combinator.
      push(index);
      combinator = ' ';
      start = next;

      return next - index;
    }

    return 1;
  });

  push(source.length);

  return steps;
}

function isExplicitCombinator(ch: string): ch is '>' | '+' | '~' {
  return ch === '>' || ch === '+' || ch === '~';
}

function skipSelectorSpaces(source: string, index: number): number {
  while (index < source.length && isSelectorSpace(source[index])) {
    index++;
  }
  return index;
}

function isSelectorSpace(ch: string): boolean {
  return ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t' || ch === '\f';
}

function stripCssComments(s: string): string {
  let out = '';
  let quote = '';

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (ch === '\\') {
      out += ch;
      if (i + 1 < s.length) out += s[++i];
    } else if (quote) {
      out += ch;
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
    } else if (ch === '/' && s[i + 1] === '*') {
      i += 2;
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++;
      if (i < s.length) i++;
      out += ' ';
    } else {
      out += ch;
    }
  }

  return out;
}

function normalizeNestingSelector(s: string): string {
  let out = '';
  let quote = '';
  let inAttr = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (ch === '\\') {
      out += ch + (s[++i] ?? '');
      continue;
    }

    if (quote) {
      out += ch;
      if (ch === quote) quote = '';
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
    } else if (inAttr) {
      if (ch === ']') inAttr = false;
      out += ch;
    } else if (ch === '[') {
      inAttr = true;
      out += ch;
    } else {
      out += ch === '&' ? ':scope' : ch;
    }
  }

  return out;
}

export function trimSelectorSpaces(input: string): string {
  let start = 0;
  let end = input.length;

  while (start < end && isCssSpace(input.charCodeAt(start))) {
    start++;
  }

  while (end > start && isCssSpace(input.charCodeAt(end - 1))) {
    if (isEscapedAt(input, end - 1, start)) break;
    end--;
  }

  return input.slice(start, end);
}

function isEscapedAt(input: string, index: number, start = 0): boolean {
  let slashCount = 0;
  for (let i = index - 1; i >= start && input[i] === '\\'; i--) {
    slashCount++;
  }
  return slashCount % 2 === 1;
}












import { Cursor } from './cursor';

export type SelectorList = {
  selectors: ComplexSelector[];
};

export type Combinator = ' ' | '>' | '+' | '~';

export type ComplexSelector = {
  parts: ComplexPart[];
};

export type ComplexPart = {
  // null for the first compound in the complex selector
  combinator: Combinator | null;
  compound: CompoundSelector;
};

export type CompoundSelector = {
  id?: IdSelector;
  classes?: ClassSelector[];
  tag?: TagSelector;

  // Generated JS source for non-planner simple-selector tests
  // such as attrs and pseudos. ID/class/tag are deferred for the planner.
  // TODO: maybe a list so that planner can reorder for perf?
  testSource: string;
};

export type IdSelector = {
  // Raw CSS identifier payload, without "#", before CSS unescaping.
  raw: string;
};

export type ClassSelector = {
  // Raw CSS identifier payload, without ".", before CSS unescaping.
  raw: string;
};

export type TagSelector = {
  prefixRaw?: '' | '*';
  localRaw: string;
};

export function parseSelectorList(input: string): SelectorList {
  const c = new Cursor(input);
  return parseSelectorListFrom(c);
}

export function parseSelectorListFrom(c: Cursor): SelectorList {
  const selectors: ComplexSelector[] = [];

  consumeWhitespace(c);

  if (c.eof()) {
    c.error('Expected selector');
  }

  while (!c.eof()) {
    selectors.push(parseComplexSelector(c));

    consumeWhitespace(c);

    if (!c.match(',')) break;

    consumeWhitespace(c);

    if (c.eof()) {
      c.error('Expected selector after comma');
    }
  }

  consumeWhitespace(c);

  if (!c.eof()) {
    c.error(`Unexpected character ${JSON.stringify(c.peek())}`);
  }

  return { selectors };
}

export function parseComplexSelector(c: Cursor): ComplexSelector {
  const parts: ComplexPart[] = [];

  parts.push({
    combinator: null,
    compound: parseCompoundSelector(c),
  });

  while (true) {
    const sawWs = consumeWhitespace(c);

    if (c.eof() || c.peek() === ',' || c.peek() === ')') break;

    let combinator: Combinator | null = null;
    const ch = c.peek();

    if (ch === '>' || ch === '+' || ch === '~') {
      combinator = ch;
      c.next();
      consumeWhitespace(c);
    } else if (sawWs) {
      combinator = ' ';
    } else {
      c.error('Expected combinator');
    }

    if (c.eof() || c.peek() === ',' || c.peek() === ')') {
      c.error('Expected compound selector after combinator');
    }

    parts.push({
      combinator,
      compound: parseCompoundSelector(c),
    });
  }

  return { parts };
}

export function parseCompoundSelector(c: Cursor): CompoundSelector {
  const compound: CompoundSelector = {
    testSource: '',
  };

  let count = 0;

  while (!c.eof() && canStartSimpleSelector(c)) {
    parseSimpleSelectorInto(c, compound, count === 0);
    count++;
  }

  if (count === 0) {
    c.error('Expected compound selector');
  }

  return compound;
}

function parseSimpleSelectorInto(c: Cursor, compound: CompoundSelector, isFirstInCompound: boolean): void {
  const ch = c.peek();

  if (ch === '#') {
    if (compound.id) c.error('Duplicate id selector in compound');
    compound.id = parseIdSelector(c);
    return;
  }

  if (ch === '.') {
    (compound.classes ??= []).push(parseClassSelector(c));
    return;
  }

  if (ch === '[') {
    compound.testSource += _emitAttributeTest(_parseAttributeSelector(c));
    return;
  }

  if (ch === ':') {
    compound.testSource += emitPseudoTest(_parsePseudoSelector(c));
    return;
  }

  if ((ch === '*' || ch === '|' || canStartIdent(c)) && isFirstInCompound) {
    if (compound.tag) c.error('Duplicate tag selector in compound');
    compound.tag = parseTagSelector(c);
    return;
  }

  c.error(`Unexpected simple selector ${JSON.stringify(ch)}`);
}

function parseIdSelector(c: Cursor): IdSelector {
  c.expect('#');

  return {
    raw: consumeIdent(c),
  };
}

function parseClassSelector(c: Cursor): ClassSelector {
  c.expect('.');

  return {
    raw: consumeIdent(c),
  };
}

function parseTagSelector(c: Cursor): TagSelector {
  if (c.match('*')) {
    if (c.match('|')) {
      return { prefixRaw: '*', localRaw: parseLocalTagName(c) };
    }

    return { localRaw: '*' };
  }

  if (c.match('|')) {
    return { prefixRaw: '', localRaw: parseLocalTagName(c) };
  }

  const first = consumeIdent(c);

  if (c.match('|')) {
    c.error(`Unsupported namespace prefix ${JSON.stringify(first)}`);
  }

  return { localRaw: first };
}

function parseLocalTagName(c: Cursor): string {
  if (c.match('*')) return '*';
  return consumeIdent(c);
}


export type _AttributeSelector = {
  raw: string;
};

function _parseAttributeSelector(c: Cursor): _AttributeSelector {
  const start = c.pos();

  _consumeBracketBlock(c);

  return {
    raw: c.slice(start),
  };
}

function _emitAttributeTest(attr: _AttributeSelector): string {
  return `/* attr ${JSON.stringify(attr)} */`;
}

export type PseudoSelector = {
  raw: string;
};

function _parsePseudoSelector(c: Cursor): PseudoSelector {
  const start = c.pos();

  c.expect(':');

  // Allow pseudo-elements for now.
  if (c.match(':')) {
    // keep going
  }

  consumeIdent(c);

  if (c.peek() === '(') {
    _consumeParenBlock(c);
  }

  return {
    raw: c.slice(start),
  };
}

function emitPseudoTest(pseudo: PseudoSelector): string {
  return `/* pseudo ${JSON.stringify(pseudo)} */`;
}


function isCssWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === '\f';
}

function consumeWhitespace(c: Cursor): boolean {
  const n = c.consumeWhile(isCssWhitespace);
  return n !== 0;
}

function canStartSimpleSelector(c: Cursor): boolean {
  const ch = c.peek();

  return (
    ch === '#' ||
    ch === '.' ||
    ch === '[' ||
    ch === ':' ||
    ch === '*' ||
    ch === '|' ||
    canStartIdent(c)
  );
}


function canStartIdent(c: Cursor): boolean {
  const ch = c.peek();

  return (
    ch === '-' ||
    ch === '\\' ||
    isIdentHeadChar(ch)
  );
}

function _consumeBracketBlock(c: Cursor): void {
  c.expect('[');

  while (!c.eof()) {
    const ch = c.peek();

    if (ch === ']') {
      c.next();
      return;
    }

    if (ch === '"' || ch === "'") {
      consumeString(c);
      continue;
    }

    if (consumeEscapedChar(c)) {
      continue;
    }

    c.next();
  }

  c.error('Unclosed attribute selector');
}

function _consumeParenBlock(c: Cursor): void {
  c.expect('(');

  let depth = 1;

  while (!c.eof()) {
    const ch = c.peek();

    if (ch === '"' || ch === "'") {
      consumeString(c);
      continue;
    }

    if (consumeEscapedChar(c)) {
      continue;
    }

    if (ch === '(') {
      depth++;
      c.next();
      continue;
    }

    if (ch === ')') {
      depth--;
      c.next();
      if (depth === 0) return;
      continue;
    }

    c.next();
  }

  c.error('Unclosed pseudo arguments');
}

function consumeString(c: Cursor): void {
  const quote = c.next();

  while (!c.eof()) {
    if (c.match(quote)) return;
    if (consumeEscapedChar(c)) continue;
    c.next();
  }

  c.error('Unclosed string');
}

function consumeEscapedChar(c: Cursor): boolean {
  if (!c.match('\\')) return false;
  if (!c.eof()) c.next();
  return true;
}


function isVerticalWhitespace(ch: string): boolean {
  return ch === '\n' || ch === '\r' || ch === '\f';
}

function isHexDigit(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||  // 0-9
    (code >= 65 && code <= 70) ||  // A-F
    (code >= 97 && code <= 102)    // a-f
  );
}

function isAlpha(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122)
  );
}

function isDigit(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function isNonAsciiIdentChar(ch: string): boolean {
  return ch !== '' && ch.charCodeAt(0) > 0x9f;
}

function isIdentHeadChar(ch: string): boolean {
  return isAlpha(ch) || ch === '_' || isNonAsciiIdentChar(ch);
}

function isIdentTailChar(ch: string): boolean {
  return isIdentHeadChar(ch) || isDigit(ch) || ch === '-';
}


function consumeCssEscape(c: Cursor): boolean {
  const start = c.pos();

  if (!c.match('\\')) return false;

  const ch = c.peek();

  if (ch === '') {
    c.restore(start);
    return false;
  }

  if (isHexDigit(ch)) {
    let n = 0;

    while (n < 6 && isHexDigit(c.peek())) {
      c.next();
      n++;
    }

    // Old regex allows either CRLF or one CSS whitespace after hex escape.
    if (c.peek() === '\r' && c.peek(1) === '\n') {
      c.consume(2);
    } else if (isCssWhitespace(c.peek())) {
      c.next();
    }

    return true;
  }

  // Old regex: backslash followed by a char that is not vertical whitespace
  // and not hex.
  if (!isVerticalWhitespace(ch) && !isHexDigit(ch)) {
    c.next();
    return true;
  }

  c.restore(start);
  return false;
}

function consumeIdentHead(c: Cursor): boolean {
  if (isIdentHeadChar(c.peek())) {
    c.next();
    return true;
  }

  return consumeCssEscape(c);
}

function consumeIdentTail(c: Cursor): boolean {
  if (isIdentTailChar(c.peek())) {
    c.next();
    return true;
  }

  return consumeCssEscape(c);
}

export function consumeIdent(c: Cursor): string {
  const start = c.pos();

  if (c.matchString('--')) {
    while (consumeIdentTail(c)) {
      // consume
    }

    return c.slice(start);
  }

  if (c.match('-')) {
    if (!consumeIdentHead(c)) {
      c.restore(start);
      c.error('Expected identifier');
    }

    while (consumeIdentTail(c)) {
      // consume
    }

    return c.slice(start);
  }

  if (!consumeIdentHead(c)) {
    c.error('Expected identifier');
  }

  while (consumeIdentTail(c)) {
    // consume
  }

  return c.slice(start);
}
