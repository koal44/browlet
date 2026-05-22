import { cssIdentUnescape, isCssSpace } from "./utils/css";

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
  tests: string[];
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

  consumeTrivia(c);

  if (c.eof()) {
    c.error(`Expected selector, got end of input`);
  }

  while (!c.eof()) {
    selectors.push(parseComplexSelector(c));

    consumeTrivia(c);

    if (!c.match(',')) break;

    consumeTrivia(c);

    if (c.eof()) {
      c.error(`Expected selector after comma, got end of input`);
    }
  }

  consumeTrivia(c);

  if (!c.eof()) {
    c.error(`Unexpected character ${c.peek()}`);
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
    const sawWs = consumeTrivia(c);

    if (c.eof() || c.peek() === ',' || c.peek() === ')') break;

    let combinator: Combinator | null = null;
    const ch = c.peek();

    if (ch === '>' || ch === '+' || ch === '~') {
      combinator = ch;
      c.next();
      consumeTrivia(c);
    } else if (sawWs) {
      combinator = ' ';
    } else {
      c.error(`Expected combinator, got ${c.peek()}`);
    }

    if (c.eof() || c.peek() === ',' || c.peek() === ')' || isCombinator(c.peek())) {
      c.error(`Expected compound selector after combinator, got ${c.peek() || '<eof>'}`);
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
    tests: [],
  };

  let count = 0;

  while (!c.eof() && canStartSimpleSelector(c)) {
    parseSimpleSelectorInto(c, compound, count === 0);
    count++;
    assertSimpleSelectorBoundary(c);
  }

  if (count === 0) {
    c.error(`Expected compound selectors but did not find any simple selector, got ${c.peek()}`);
  }

  return compound;
}

function parseSimpleSelectorInto(c: Cursor, compound: CompoundSelector, isFirstInCompound: boolean): void {
  const ch = c.peek();

  if (ch === '#') {
    if (compound.id) c.error(`Duplicate ID selector in compound, already have ${compound.id.raw}`);
    compound.id = parseIdSelector(c);
    return;
  }

  if (ch === '.') {
    (compound.classes ??= []).push(parseClassSelector(c));
    return;
  }

  if (ch === '[') {
    compound.tests.push(emitAttributeTest(parseAttributeSelector(c)));
    return;
  }

  if (ch === ':') {
    compound.tests.push(parsePseudoTestSource(c));
    return;
  }

  if ((ch === '*' || ch === '|' || canStartIdent(c)) && isFirstInCompound) {
    if (compound.tag) c.error(`Duplicate tag selector in compound, already have ${compound.tag.prefixRaw ? compound.tag.prefixRaw + '|' : ''}${compound.tag.localRaw}`);
    compound.tag = parseTagSelector(c);
    return;
  }

  c.error(`Unexpected simple selector ${ch}`);
}

function assertSimpleSelectorBoundary(c: Cursor): void {
  const ch = c.peek();

  if (
    ch === '' ||
    ch === ',' ||
    ch === ')' ||
    ch === '>' ||
    ch === '+' ||
    ch === '~' ||
    isCssWhitespace(ch) ||
    canStartSimpleSelector(c)
  ) {
    return;
  }

  c.error(`Expected simple selector or combinator boundary, got ${ch}`);
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
    c.error(`Unsupported namespace prefix ${first}`);
  }

  return { localRaw: first };
}

function parseLocalTagName(c: Cursor): string {
  if (c.match('*')) return '*';
  return consumeIdent(c);
}


export type AttributeSelector = {
  prefixRaw?: '' | '*';
  localRaw: string;

  op?: AttrOperator;
  valueRaw?: string;

  // normalized ASCII attr selector flag
  flag?: 'i' | 's';
};

export type AttrOperator = '=' | '~=' | '|=' | '^=' | '$=' | '*=';

export function parseAttributeSelector(c: Cursor): AttributeSelector {
  c.expect('[');
  consumeTrivia(c);

  const name = parseAttributeName(c);

  consumeTrivia(c);

  if (c.match(']') || c.eof()) {
    return name;
  }

  const op = parseAttributeOperator(c);

  consumeTrivia(c);

  const valueRaw = parseAttributeValue(c);

  consumeTrivia(c);

  let flag: 'i' | 's' | undefined;

  if (!c.match(']') && !c.eof()) {
    flag = parseAttributeFlag(c);

    consumeTrivia(c);

    if (!c.match(']') && !c.eof()) {
      c.error(`Expected "]" at end of attribute selector, got ${c.peek()}`);
    }
  }

  return {
    ...name,
    op,
    valueRaw,
    flag,
  };
}

function parseAttributeName(c: Cursor): Pick<AttributeSelector, 'prefixRaw' | 'localRaw'> {
  if (c.match('*')) {
    if (c.match('|')) {
      if (c.peek() === '=') c.error(`Expected attribute name after "*|", got ${c.peek()}`);
      return { prefixRaw: '*', localRaw: consumeIdent(c) };
    }

    c.error( `Expected "|" after "*" in attribute namespace prefix, got ${c.peek()}`);
  }

  if (c.match('|')) {
    if (c.peek() === '=') c.error(`Expected attribute name after "|", got ${c.peek()}`);
    return { prefixRaw: '', localRaw: consumeIdent(c) };
  }

  const first = consumeIdent(c);

  // This is the key: attr|=value is operator, not namespace.
  if (c.peek() === '|' && c.peek(1) !== '=') {
    c.next();
    c.error(`Unsupported namespace prefix ${first}`);
  }

  return { localRaw: first };
}

function parseAttributeOperator(c: Cursor): AttrOperator {
  if (c.matchString('~=')) return '~=';
  if (c.matchString('|=')) return '|=';
  if (c.matchString('^=')) return '^=';
  if (c.matchString('$=')) return '$=';
  if (c.matchString('*=')) return '*=';
  if (c.match('=')) return '=';

  c.error(`Expected attribute operator, got ${c.peek()}`);
}

function parseAttributeValue(c: Cursor): string {
  const ch = c.peek();

  if (ch === '' || ch === ']') {
    c.error(`Expected attribute value, got '${ch}'`);
  }

  if (ch === '"' || ch === "'") {
    return consumeStringValue(c);
  }

  if (!canStartIdent(c)) {
    c.error(`Expected attribute value, got '${ch}'`);
  }

  return consumeIdent(c);
}

function consumeStringValue(c: Cursor): string {
  const quote = c.next();
  const start = c.pos();

  while (!c.eof()) {
    if (c.match(quote)) {
      return c.slice(start, c.pos() - 1);
    }

    if (consumeEscapedChar(c)) continue;

    c.next();
  }

  c.error(`Unterminated string, expected closing quote`);
}

function parseAttributeFlag(c: Cursor): 'i' | 's' {
  const raw = consumeIdent(c);
  const flag = cssIdentUnescape(raw).toLowerCase();

  if (flag === 'i' || flag === 's') return flag;

  c.error(`Invalid attribute selector flag ${JSON.stringify(raw)}`);
}

function parsePseudoTestSource(c: Cursor): string {
  c.expect(':');

  const isElement = c.match(':');
  const rawName = consumeIdent(c);
  const lowerName = rawName.toLowerCase();
  const name = isElement ? `:${lowerName}` : lowerName;

  switch (name) {
    // tree-structural pseudo-classes
    case 'scope': return emitScopePseudoTest();
    case 'root': return emitRootPseudoTest();
    case 'empty': return emitEmptyPseudoTest();
    case 'first-child': return emitFirstChildPseudoTest();
    case 'last-child': return emitLastChildPseudoTest();
    case 'only-child': return emitOnlyChildPseudoTest();
    case 'first-of-type': return emitFirstOfTypePseudoTest();
    case 'last-of-type': return emitLastOfTypePseudoTest();
    case 'only-of-type': return emitOnlyOfTypePseudoTest();

    // child-indexed / typed child-indexed pseudo-classes
    case 'nth-child':        return emitNthPseudoTest(parseNthArgs(c), { ofType: false, last: false });
    case 'nth-last-child':   return emitNthPseudoTest(parseNthArgs(c), { ofType: false, last: true });
    case 'nth-of-type':      return emitNthPseudoTest(parseNthArgs(c), { ofType: true,  last: false });
    case 'nth-last-of-type': return emitNthPseudoTest(parseNthArgs(c), { ofType: true,  last: true });

    // logical / relational pseudo-classes
    case 'is': return emitIsPseudoTest(parseForgivingPseudoBodySelectorList(c));
    case 'where': return emitWherePseudoTest(parseForgivingPseudoBodySelectorList(c));
    case 'not': return emitNotPseudoTest(parseStrictPseudoBodySelectorList(c));
    case 'has': return emitHasPseudoTest(parsePseudoBodyRelativeSelectorList(c));
    case 'matches': c.error('Unsupported pseudo-class :matches(); use :is()');

    // linguistic pseudo-classes
    case 'dir': return emitDirPseudoTest(parseDirPseudoArg(c));
    case 'lang': return emitLangPseudoTest(parseLangPseudoArg(c));

    // location pseudo-classes
    case 'any-link': return emitAnyLinkPseudoTest();
    case 'link': return emitLinkPseudoTest();
    case 'visited': return emitVisitedPseudoTest();
    case 'target': return emitTargetPseudoTest();
    case 'defined': return emitDefinedPseudoTest();

    // user action pseudo-classes
    case 'hover': return emitHoverPseudoTest();
    case 'active': return emitActivePseudoTest();
    case 'focus': return emitFocusPseudoTest();
    case 'focus-visible': return emitFocusVisiblePseudoTest();
    case 'focus-within': return emitFocusWithinPseudoTest();

    // user interface and form pseudo-classes
    case 'enabled': return emitEnabledPseudoTest();
    case 'disabled': return emitDisabledPseudoTest();
    case 'read-only': return emitReadOnlyPseudoTest();
    case 'read-write': return emitReadWritePseudoTest();
    case 'placeholder-shown': return emitPlaceholderShownPseudoTest();
    case 'default': return emitDefaultPseudoTest();

    // input pseudo-classes / form validation
    case 'checked': return emitCheckedPseudoTest();
    case 'indeterminate': return emitIndeterminatePseudoTest();
    case 'required': return emitRequiredPseudoTest();
    case 'optional': return emitOptionalPseudoTest();
    case 'invalid': return emitInvalidPseudoTest();
    case 'valid': return emitValidPseudoTest();
    case 'in-range': return emitInRangePseudoTest();
    case 'out-of-range': return emitOutOfRangePseudoTest();

    // resource state pseudo-classes
    case 'playing': return emitPlayingPseudoTest();
    case 'paused': return emitPausedPseudoTest();
    case 'seeking': return emitSeekingPseudoTest();
    case 'buffering': return emitBufferingPseudoTest();
    case 'stalled': return emitStalledPseudoTest();
    case 'muted': return emitMutedPseudoTest();
    case 'volume-locked': return emitVolumeLockedPseudoTest();

    // parse-valid no-op pseudo-classes
    case 'autofill': return emitNoMatchPseudoTest('autofill');
    case '-webkit-autofill': return emitNoMatchPseudoTest('-webkit-autofill');

    // parse-valid legacy single-colon pseudo-elements; match no DOM elements
    case 'after': return emitNoMatchPseudoElementTest('after');
    case 'before': return emitNoMatchPseudoElementTest('before');
    case 'first-letter': return emitNoMatchPseudoElementTest('first-letter');
    case 'first-line': return emitNoMatchPseudoElementTest('first-line');

    case ':after': return emitNoMatchPseudoElementTest('after');
    case ':before': return emitNoMatchPseudoElementTest('before');
    case ':first-letter': return emitNoMatchPseudoElementTest('first-letter');
    case ':first-line': return emitNoMatchPseudoElementTest('first-line');
    case ':selection': return emitNoMatchPseudoElementTest('selection');
    case ':placeholder': return emitNoMatchPseudoElementTest('placeholder');

    default:
      if (isElement && lowerName.startsWith('-webkit-') && lowerName.length > '-webkit-'.length) {
        return emitNoMatchPseudoElementTest(lowerName);
      }

      c.error(`Unsupported ${isElement ? 'pseudo-element' : 'pseudo-class'} ${rawName}`);
  }
}

export function parseStrictPseudoBodySelectorList(c: Cursor): SelectorList {
  c.expect('(');
  consumeTrivia(c);

  if (c.peek() === ')' || c.eof()) {
    c.error(`Expected selector in pseudo-class body, got ${c.peek()}`);
  }

  const selectors: ComplexSelector[] = [];

  while (!c.eof() && c.peek() !== ')') {
    selectors.push(parseComplexSelector(c));

    consumeTrivia(c);

    if (c.peek() === ')' || c.eof()) break;

    if (!c.match(',')) {
      c.error(`Expected "," or ")" in pseudo-class body, got ${c.peek()}`);
    }

    consumeTrivia(c);

    if (c.peek() === ')' || c.eof()) {
      c.error(`Expected selector after comma in pseudo-class body, got ${c.peek()}`);
    }
  }

  // Selectors syntax / old regex behavior has a lot of EOF tolerance.
  // So allow EOF here as "body ended at EOF" for now.
  if (!c.eof()) {
    c.expect(')');
  }

  return { selectors };
}

export function parseForgivingPseudoBodySelectorList(c: Cursor): SelectorList {
  c.expect('(');
  consumeTrivia(c);

  if (c.peek() === ')' || c.eof()) {
    c.error(`Expected selector in pseudo-class body, got ${c.peek()}`);
  }

  const selectors: ComplexSelector[] = [];

  while (!c.eof() && c.peek() !== ')') {
    consumeTrivia(c);

    if (c.peek() === ',' || c.peek() === ')' || c.eof()) {
      c.error(`Expected selector in pseudo-class body, got ${c.peek()}`);
    }

    const armStart = c.pos();

    try {
      selectors.push(parseComplexSelector(c));
    } catch {
      c.restore(armStart);
      consumeForgivingSelectorArm(c);
    }

    consumeTrivia(c);

    if (c.peek() === ')' || c.eof()) break;

    if (!c.match(',')) {
      c.error(`Expected "," or ")" in pseudo-class body, got ${c.peek()}`);
    }

    consumeTrivia(c);

    if (c.peek() === ',' || c.peek() === ')' || c.eof()) {
      c.error(`Expected selector after comma in pseudo-class body, got ${c.peek()}`);
    }
  }

  if (!c.eof()) c.expect(')');

  return { selectors };
}

function consumeForgivingSelectorArm(c: Cursor): string {
  const start = c.pos();

  let parenDepth = 0;
  let bracketDepth = 0;
  let quote: string | null = null;

  while (!c.eof()) {
    const ch = c.peek();

    if (quote) {
      if (ch === '\\') {
        c.next();
        if (!c.eof()) c.next();
        continue;
      }

      if (ch === quote) {
        quote = null;
        c.next();
        continue;
      }

      c.next();
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      c.next();
      continue;
    }

    if (ch === '/' && c.peek(1) === '*') {
      c.consume(2);

      while (!c.eof()) {
        if (c.peek() === '*' && c.peek(1) === '/') {
          c.consume(2);
          break;
        }

        c.next();
      }

      continue;
    }

    if (ch === '\\') {
      c.next();
      if (!c.eof()) c.next();
      continue;
    }

    if (ch === '[') {
      bracketDepth++;
      c.next();
      continue;
    }

    if (ch === ']') {
      if (bracketDepth > 0) bracketDepth--;
      c.next();
      continue;
    }

    if (bracketDepth === 0) {
      if (ch === '(') {
        parenDepth++;
        c.next();
        continue;
      }

      if (ch === ')') {
        if (parenDepth === 0) break;
        parenDepth--;
        c.next();
        continue;
      }

      if (ch === ',' && parenDepth === 0) break;
    }

    c.next();
  }

  return c.slice(start, c.pos());
}

export type RelativeSelectorList2 = {
  selectors: RelativeSelector2[];
};

export type RelativeSelector2 = {
  steps: RelativeStep2[];
};

export type RelativeStep2 = {
  combinator: Combinator;
  compound: CompoundSelector;
};

export function parsePseudoBodyRelativeSelectorList(c: Cursor): RelativeSelectorList2 {
  c.expect('(');
  consumeTrivia(c);

  if (c.peek() === ')' || c.eof()) {
    c.error(`Expected relative selector in pseudo-class body, got ${c.peek()}`);
  }

  const selectors: RelativeSelector2[] = [];

  while (!c.eof() && c.peek() !== ')') {
    selectors.push(parseRelativeSelector2(c));

    consumeTrivia(c);

    if (c.peek() === ')' || c.eof()) break;

    if (!c.match(',')) {
      c.error(`Expected "," or ")" in relative selector list, got ${c.peek()}`);
    }

    consumeTrivia(c);

    if (c.peek() === ')' || c.eof()) {
      c.error(`Expected relative selector after comma in pseudo-class body, got ${c.peek()}`);
    }
  }

  if (!c.eof()) c.expect(')');

  return { selectors };
}

function parseRelativeSelector2(c: Cursor): RelativeSelector2 {
  const steps: RelativeStep2[] = [];

  consumeTrivia(c);

  let combinator = parseOptionalRelativeCombinator(c) ?? ' ';
  consumeTrivia(c);

  if (c.eof() || c.peek() === ')' || c.peek() === ',' || isCombinator(c.peek())) {
    c.error(`Expected compound selector after combinator in relative selector, got ${c.peek() || '<eof>'}`);
  }

  steps.push({
    combinator,
    compound: parseCompoundSelector(c),
  });

  while (true) {
    const sawWs = consumeTrivia(c);

    if (c.eof() || c.peek() === ')' || c.peek() === ',') break;

    const explicit = parseOptionalRelativeCombinator(c);

    if (explicit) {
      combinator = explicit;
      consumeTrivia(c);
    } else if (sawWs) {
      combinator = ' ';
    } else {
      c.error(`Expected combinator in relative selector, got ${c.peek()}`);
    }

    if (c.eof() || c.peek() === ')' || c.peek() === ',' || isCombinator(c.peek())) {
      c.error(`Expected compound selector after combinator in relative selector, got ${c.peek() || '<eof>'}`);
    }

    steps.push({
      combinator,
      compound: parseCompoundSelector(c),
    });
  }

  return { steps };
}

function parseOptionalRelativeCombinator(c: Cursor): Combinator | null {
  const ch = c.peek();

  if (ch === '>' || ch === '+' || ch === '~') {
    c.next();
    return ch;
  }

  return null;
}

export type NthArgs = {
  step: number;
  offset: number;
};

export function parseNthArgs(c: Cursor): NthArgs {
  c.expect('(');
  consumeTrivia(c);

  const nth = parseNthExpression(c);

  consumeTrivia(c);
  c.expect(')');

  return nth;
}

export function parseNthExpression(c: Cursor): NthArgs {
  const start = c.pos();

  const word = consumeAsciiWord(c).toLowerCase();

  if (word === 'odd') return { step: 2, offset: 1 };
  if (word === 'even') return { step: 2, offset: 0 };

  c.restore(start);

  const sign = parseOptionalSign(c);
  const digits = consumeDigits(c);

  if (c.peek().toLowerCase() !== 'n') {
    if (digits === '') c.error(`Expected nth expression, got ${c.peek()}`);

    return {
      step: 0,
      offset: normalizeZero(sign * Number(digits)),
    };
  }

  c.next(); // n

  const step = digits === '' ? sign : sign * Number(digits);

  consumeTrivia(c);

  let offset = 0;

  if (c.peek() === '+' || c.peek() === '-') {
    const offsetSign = parseOptionalSign(c);
    consumeTrivia(c);

    const offsetDigits = consumeDigits(c);
    if (offsetDigits === '') c.error(`Expected offset in nth expression, got ${c.peek()}`);

    offset = offsetSign * Number(offsetDigits);
  }

  return {
    step: normalizeZero(step),
    offset: normalizeZero(offset),
  };
}

function parseOptionalSign(c: Cursor): 1 | -1 {
  if (c.match('+')) return 1;
  if (c.match('-')) return -1;
  return 1;
}

function normalizeZero(n: number): number {
  return n === 0 ? 0 : n;
}

function parseDirPseudoArg(c: Cursor): 'ltr' | 'rtl' | string {
  const arg = parsePseudoBodyIdentArg(c).toLowerCase();
  return arg;
}

function parseLangPseudoArg(c: Cursor): string {
  return parsePseudoBodyIdentArg(c).toLowerCase();
}

function parsePseudoBodyIdentArg(c: Cursor): string {
  c.expect('(');
  consumeTrivia(c);

  if (c.peek() === ')' || c.eof()) {
    c.error(`Expected argument in pseudo-class, got ${c.peek()}`);
  }

  const arg = consumeIdent(c);

  consumeTrivia(c);

  if (!c.eof()) {
    c.expect(')');
  }

  return arg;
}

function isCombinator(ch: string): ch is Combinator {
  return ch === '>' || ch === '+' || ch === '~';
}

function consumeDigits(c: Cursor): string {
  const start = c.pos();
  c.consumeWhile(isDigit);
  return c.slice(start);
}

function consumeAsciiWord(c: Cursor): string {
  const start = c.pos();
  c.consumeWhile(isAlpha);
  return c.slice(start);
}




function isCssWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === '\f';
}

function consumeComment(c: Cursor): boolean {
  if (!startsComment(c)) return false;

  c.consume(2);

  while (!c.eof()) {
    if (c.peek() === '*' && c.peek(1) === '/') {
      c.consume(2);
      return true;
    }

    c.next();
  }

  c.error('Unterminated comment');
}

function startsComment(c: Cursor): boolean {
  return c.peek() === '/' && c.peek(1) === '*';
}

function consumeTrivia(c: Cursor): boolean {
  let consumed = false;

  while (true) {
    // Consume whitespace.
    const n = c.consumeWhile(isCssWhitespace);
    if (n !== 0) {
      consumed = true;
      continue;
    }

    if (consumeComment(c)) {
      consumed = true;
      continue;
    }

    return consumed;
  }
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
      c.error(`Expected identifier after "-", got ${c.peek()}`);
    }

    while (consumeIdentTail(c)) {
      // consume
    }

    return c.slice(start);
  }

  if (!consumeIdentHead(c)) {
    c.error(`Expected identifier, got ${c.peek()}`);
  }

  while (consumeIdentTail(c)) {
    // consume
  }

  return c.slice(start);
}



function emitAttributeTest(attr: AttributeSelector): string {
  return `/* attr ${attr} */`;
}

function emitScopePseudoTest(): string {
  return '/* pseudo :scope */';
}

function emitRootPseudoTest(): string {
  return '/* pseudo :root */';
}

function emitEmptyPseudoTest(): string {
  return '/* pseudo :empty */';
}

function emitFirstChildPseudoTest(): string {
  return '/* pseudo :first-child */';
}

function emitLastChildPseudoTest(): string {
  return '/* pseudo :last-child */';
}

function emitOnlyChildPseudoTest(): string {
  return '/* pseudo :only-child */';
}

function emitFirstOfTypePseudoTest(): string {
  return '/* pseudo :first-of-type */';
}

function emitLastOfTypePseudoTest(): string {
  return '/* pseudo :last-of-type */';
}

function emitOnlyOfTypePseudoTest(): string {
  return '/* pseudo :only-of-type */';
}

function emitNthPseudoTest(nth: NthArgs, opt: { ofType: boolean; last: boolean }): string {
  return `/* nth ${JSON.stringify({ ...nth, ...opt })} */`;
}

function emitIsPseudoTest(list: SelectorList): string {
  return `/* :is ${list.selectors.length} */`;
}

function emitWherePseudoTest(list: SelectorList): string {
  return `/* :where ${list.selectors.length} */`;
}

function emitNotPseudoTest(list: SelectorList): string {
  return `/* :not ${list.selectors.length} */`;
}

function emitHasPseudoTest(list: RelativeSelectorList2): string {
  return `/* :has ${list.selectors.length} */`;
}

function emitDirPseudoTest(arg: string): string {
  return `/* pseudo :dir(${arg}) */`;
}

function emitLangPseudoTest(arg: string): string {
  return `/* pseudo :lang(${arg}) */`;
}

function emitAnyLinkPseudoTest(): string {
  return '/* pseudo :any-link */';
}

function emitLinkPseudoTest(): string {
  return '/* pseudo :link */';
}

function emitVisitedPseudoTest(): string {
  return '/* pseudo :visited */';
}

function emitTargetPseudoTest(): string {
  return '/* pseudo :target */';
}

function emitDefinedPseudoTest(): string {
  return '/* pseudo :defined */';
}

function emitHoverPseudoTest(): string {
  return '/* pseudo :hover */';
}

function emitActivePseudoTest(): string {
  return '/* pseudo :active */';
}

function emitFocusPseudoTest(): string {
  return '/* pseudo :focus */';
}

function emitFocusVisiblePseudoTest(): string {
  return '/* pseudo :focus-visible */';
}

function emitFocusWithinPseudoTest(): string {
  return '/* pseudo :focus-within */';
}

function emitEnabledPseudoTest(): string {
  return '/* pseudo :enabled */';
}

function emitDisabledPseudoTest(): string {
  return '/* pseudo :disabled */';
}

function emitReadOnlyPseudoTest(): string {
  return '/* pseudo :read-only */';
}

function emitReadWritePseudoTest(): string {
  return '/* pseudo :read-write */';
}

function emitPlaceholderShownPseudoTest(): string {
  return '/* pseudo :placeholder-shown */';
}

function emitDefaultPseudoTest(): string {
  return '/* pseudo :default */';
}

function emitCheckedPseudoTest(): string {
  return '/* pseudo :checked */';
}

function emitIndeterminatePseudoTest(): string {
  return '/* pseudo :indeterminate */';
}

function emitRequiredPseudoTest(): string {
  return '/* pseudo :required */';
}

function emitOptionalPseudoTest(): string {
  return '/* pseudo :optional */';
}

function emitInvalidPseudoTest(): string {
  return '/* pseudo :invalid */';
}

function emitValidPseudoTest(): string {
  return '/* pseudo :valid */';
}

function emitInRangePseudoTest(): string {
  return '/* pseudo :in-range */';
}

function emitOutOfRangePseudoTest(): string {
  return '/* pseudo :out-of-range */';
}

function emitPlayingPseudoTest(): string {
  return '/* pseudo :playing */';
}

function emitPausedPseudoTest(): string {
  return '/* pseudo :paused */';
}

function emitSeekingPseudoTest(): string {
  return '/* pseudo :seeking */';
}

function emitBufferingPseudoTest(): string {
  return '/* pseudo :buffering */';
}

function emitStalledPseudoTest(): string {
  return '/* pseudo :stalled */';
}

function emitMutedPseudoTest(): string {
  return '/* pseudo :muted */';
}

function emitVolumeLockedPseudoTest(): string {
  return '/* pseudo :volume-locked */';
}

function emitNoMatchPseudoTest(name: string): string {
  return `/* pseudo :${name} no-match */`;
}

function emitNoMatchPseudoElementTest(name: string): string {
  return `/* pseudo ::${name} no-match */`;
}
