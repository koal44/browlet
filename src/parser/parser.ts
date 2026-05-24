import { cssIdentUnescape, isCssSpace } from "../utils/css";

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

// export function parseRelativeSelectorList(source: string): RelativeSelectorList {
//   const selectors = splitSelectorGroups(source).map(raw => {
//     const branch = raw.trim();
//     return parseRelativeSelector(branch);
//   });

//   return {
//     kind: 'relative-selector-list', source, selectors,
//   };
// }

// function parseRelativeSelector(source: string): RelativeSelector {
//   return {
//     kind: 'relative', source, steps: parseRelativeSteps(source),
//   };
// }

// function parseRelativeSteps(source: string): RelativeStep[] {
//   const steps: RelativeStep[] = [];

//   let combinator: SelectorCombinator = ' ';
//   let start = skipSelectorSpaces(source, 0);

//   const push = (end: number) => {
//     const compound = source.slice(start, end).trim();

//     if (!compound) {
//       return false;
//     }

//     steps.push({
//       kind: 'relative-step',
//       combinator,
//       compound: {
//         kind: 'compound',
//         source: compound,
//       },
//     });

//     combinator = ' ';
//     return true;
//   };

//   scanTopLevel(source, (index, ch) => {
//     if (index < start) {
//       return 1;
//     }

//     if (isExplicitCombinator(ch)) {
//       push(index);
//       combinator = ch;

//       const next = skipSelectorSpaces(source, index + 1);
//       start = next;

//       return next - index;
//     }

//     if (isSelectorSpace(ch)) {
//       const next = skipSelectorSpaces(source, index + 1);
//       const nextChar = source[next];

//       // Whitespace before explicit combinator is padding:
//       // `.a   > .b`
//       if (isExplicitCombinator(nextChar)) {
//         return next - index;
//       }

//       // Trailing whitespace.
//       if (next >= source.length) {
//         return source.length - index;
//       }

//       // Otherwise whitespace is a descendant combinator.
//       push(index);
//       combinator = ' ';
//       start = next;

//       return next - index;
//     }

//     return 1;
//   });

//   push(source.length);

//   return steps;
// }

// function isExplicitCombinator(ch: string): ch is '>' | '+' | '~' {
//   return ch === '>' || ch === '+' || ch === '~';
// }

// function skipSelectorSpaces(source: string, index: number): number {
//   while (index < source.length && isSelectorSpace(source[index])) {
//     index++;
//   }
//   return index;
// }

// function isSelectorSpace(ch: string): boolean {
//   return ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t' || ch === '\f';
// }

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
import {
  emitActivePseudoTest, emitAnyLinkPseudoTest, emitAttributeTest, emitBufferingPseudoTest,
  emitCheckedPseudoTest, emitDefaultPseudoTest, emitDefinedPseudoTest, emitDirPseudoTest,
  emitDisabledPseudoTest, emitEmptyPseudoTest, emitEnabledPseudoTest, emitFirstChildPseudoTest,
  emitFirstOfTypePseudoTest, emitFocusPseudoTest, emitFocusVisiblePseudoTest, emitFocusWithinPseudoTest,
  emitHasPseudoTest, emitHoverPseudoTest, emitIndeterminatePseudoTest, emitInRangePseudoTest,
  emitInvalidPseudoTest, emitIsPseudoTest, emitLangPseudoTest, emitLastChildPseudoTest,
  emitLastOfTypePseudoTest, emitLinkPseudoTest, emitMutedPseudoTest, emitNoMatchPseudoElementTest,
  emitNoMatchPseudoTest, emitNotPseudoTest, emitNthPseudoTest, emitOnlyChildPseudoTest,
  emitOnlyOfTypePseudoTest, emitOptionalPseudoTest, emitOutOfRangePseudoTest, emitPausedPseudoTest,
  emitPlaceholderShownPseudoTest, emitPlayingPseudoTest, emitReadOnlyPseudoTest, emitReadWritePseudoTest,
  emitRegisteredPseudoTest,
  emitRequiredPseudoTest, emitRootPseudoTest, emitScopePseudoTest, emitSeekingPseudoTest,
  emitStalledPseudoTest, emitTargetPseudoTest, emitValidPseudoTest, emitVisitedPseudoTest,
  emitVolumeLockedPseudoTest, emitWherePseudoTest
} from "../compile/emit";

export type ParseContext = {
  pseudos?: Record<string, CustomPseudoPredicate>;
};

export type SelectorList = {
  selectors: ComplexSelector[];
  usesScope?: boolean;
};

export type Combinator = ' ' | '>' | '+' | '~';

export type ComplexSelector = {
  parts: ComplexPart[];
  source: string;
  usesScope?: boolean;

  // Whether a contained compound's ID/class/tag was used as a seed
  // Source-keyed lambda caching is unsafe because the matcher skips seeded tests.
  hasSeed?: boolean;
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
  tests: CandidateTest[];
  usesScope?: boolean;
};

export type IdSelector = {
  // Raw CSS identifier payload, without "#", before CSS unescaping.
  raw: string;

  // Whether this simple selector is used as a seed and thus should be skipped from compiled tests.
  seed?: boolean; 
};

export type ClassSelector = {
  // Raw CSS identifier payload, without ".", before CSS unescaping.
  raw: string;
  seed?: boolean;
};

export type TagSelector = {
  prefixRaw?: '' | '*';
  localRaw: string;
  seed?: boolean;
};

export type BuildContext = {
  nextPredicate: number;
  declarations: string[];
};

type BaseCandidateTest = {
  unique?: boolean;
  usesScope?: boolean;
};

type StaticCandidateTest = BaseCandidateTest & {
  source: string;
};

type DeferredCandidateTest = BaseCandidateTest & {
  buildSource(ctx: BuildContext): string;
};

export type CandidateTest = StaticCandidateTest | DeferredCandidateTest;

export function parseSelectorList(input: string, ctx: ParseContext): SelectorList {
  const c = new Cursor(input);
  return parseSelectorListFrom(c, ctx);
}

export function parseSelectorListFrom(c: Cursor, ctx: ParseContext): SelectorList {
  const selectors: ComplexSelector[] = [];
  let usesScope = false;

  consumeTrivia(c);

  if (c.eof()) {
    c.error(`Expected selector, got end of input`);
  }

  while (!c.eof()) {
    const complex = parseComplexSelector(c, ctx);
    if (complex.usesScope) usesScope = true;
    selectors.push(complex);

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

  return { selectors, usesScope };
}

export function parseComplexSelector(c: Cursor, ctx: ParseContext): ComplexSelector {
  const start = c.pos();
  const parts: ComplexPart[] = [];

  const first = parseCompoundSelector(c, ctx);
  parts.push({ combinator: null, compound: first });

  let usesScope = !!first.usesScope;
  let end = c.pos();

  while (true) {
    const sawWs = consumeTrivia(c);
    let ch = c.peek();

    if (!ch || ch === ',' || ch === ')') break;

    let combinator: Combinator;

    if (ch === '>' || ch === '+' || ch === '~') {
      combinator = ch;
      c.advance();
      consumeTrivia(c);
      ch = c.peek();
    } else if (sawWs) {
      combinator = ' ';
    } else {
      c.error(`Expected combinator, got ${ch}`);
    }

    if (!ch || ch === ',' || ch === ')' || isCombinator(ch)) {
      c.error(`Expected compound selector after combinator, got ${ch || '<eof>'}`);
    }

    const compound = parseCompoundSelector(c, ctx);
    if (compound.usesScope) usesScope = true;
    end = c.pos();

    parts.push({ combinator, compound });
  }

  return { parts, usesScope, source: c.slice(start, end) };
}

export function parseCompoundSelector(c: Cursor, ctx: ParseContext): CompoundSelector {
  const compound: CompoundSelector = {
    tests: [],
  };

  let count = 0;

  while (true) {
    const ch = c.peek();
    if (!ch || !canStartSimpleSelector(ch)) break;

    parseSimpleSelectorInto(c, compound, count === 0, ctx);
    count++;
    assertSimpleSelectorBoundary(c.peek());
  }

  if (count === 0) {
    c.error(`Expected compound selectors but did not find any simple selector, got ${c.peek() || '<eof>'}`);
  }

  return compound;
}

function parseSimpleSelectorInto(c: Cursor, compound: CompoundSelector, isFirstInCompound: boolean, ctx: ParseContext): void {
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
    const pseudoTest = parsePseudoTestSource(c, ctx);
    if (pseudoTest.usesScope) compound.usesScope = true;
    compound.tests.push(pseudoTest);
    return;
  }

  if (ch === '&') {
    c.advance();
    compound.usesScope = true;
    compound.tests.push(emitScopePseudoTest());
    return;
  }

  if ((ch === '*' || ch === '|' || canStartIdent(ch)) && isFirstInCompound) {
    if (compound.tag) c.error(`Duplicate tag selector in compound, already have ${compound.tag.prefixRaw ? compound.tag.prefixRaw + '|' : ''}${compound.tag.localRaw}`);
    compound.tag = parseTagSelector(c);
    return;
  }

  c.error(`Unexpected simple selector ${ch}`);
}

function assertSimpleSelectorBoundary(ch: string): void {
  if (
    ch === '' ||
    ch === ',' ||
    ch === ')' ||
    ch === '>' ||
    ch === '+' ||
    ch === '~' ||
    isCssWhitespace(ch) ||
    canStartSimpleSelector(ch)
  ) {
    return;
  }

  throw new Error(`Expected simple selector boundary, got ${ch || '<eof>'}`);
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
  const ch = c.peek();

  if (ch === '*') {
    c.advance();

    if (c.match('|')) {
      return { prefixRaw: '*', localRaw: parseLocalTagName(c) };
    }

    return { localRaw: '*' };
  }

  if (ch === '|') {
    c.advance();
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

  const attr = parseAttributeName(c);

  consumeTrivia(c);

  if (c.match(']') || c.eof()) {
    return attr;
  }

  attr.op = parseAttributeOperator(c);

  consumeTrivia(c);

  attr.valueRaw = parseAttributeValue(c);

  consumeTrivia(c);

  if (!c.match(']') && !c.eof()) {
    attr.flag = parseAttributeFlag(c);

    consumeTrivia(c);

    if (!c.match(']') && !c.eof()) {
      c.error(`Expected "]" at end of attribute selector, got ${c.peek()}`);
    }
  }

  return attr;
}

function parseAttributeName(c: Cursor): AttributeSelector {
  const ch = c.peek();

  if (ch === '*') {
    c.advance();

    if (!c.match('|')) {
      c.error(`Expected "|" after "*" in attribute namespace prefix, got ${c.peek() || '<eof>'}`);
    }

    return { prefixRaw: '*', localRaw: consumeIdent(c) };
  }

  if (ch === '|') {
    c.advance();
    return { prefixRaw: '', localRaw: consumeIdent(c) };
  }

  const localRaw = consumeIdent(c);

  // attr|=value is operator, not namespace.
  if (c.peek() === '|' && c.peek(1) !== '=') {
    c.advance();
    c.error(`Unsupported namespace prefix ${localRaw}`);
  }

  return { localRaw };
}

function parseAttributeOperator(c: Cursor): AttrOperator {
  const ch = c.next();

  if (ch === '=') {
    return '=';
  }

  if (ch === '~' || ch === '|' || ch === '^' || ch === '$' || ch === '*') {
    const ch2 = c.next();
    if (ch2 !== '=') c.error(`Expected "=" after "${ch}" in attribute operator, got ${ch2 || '<eof>'}`);
    return `${ch}=`;
  }

  c.error(`Expected attribute operator, got ${ch || '<eof>'}`);
}

function parseAttributeValue(c: Cursor): string {
  const ch = c.peek();

  if (ch === '"' || ch === "'") {
    return consumeStringValue(c);
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

    c.advance();
  }

  // Browser selector parsing accepts EOF as the end of a quoted string.
  return c.slice(start);
}

function parseAttributeFlag(c: Cursor): 'i' | 's' {
  const raw = consumeIdent(c);
  const flag = cssIdentUnescape(raw).toLowerCase();

  if (flag === 'i' || flag === 's') return flag;

  c.error(`Invalid attribute selector flag ${JSON.stringify(raw)}`);
}

function parsePseudoTestSource(c: Cursor, ctx: ParseContext): CandidateTest {
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
    case 'is': return emitIsPseudoTest(parseForgivingSelectorList(c, ctx));
    case 'where': return emitWherePseudoTest(parseForgivingSelectorList(c, ctx));
    case 'not': return emitNotPseudoTest(parseStrictSelectorList(c, ctx));
    case 'has': return emitHasPseudoTest(parseRelativeSelectorList(c, ctx));
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

    default: {
      if (isElement && lowerName.startsWith('-webkit-') && lowerName.length > '-webkit-'.length) {
        return emitNoMatchPseudoElementTest(lowerName);
      }

      if (!isElement && ctx.pseudos?.[lowerName]) {
        return emitRegisteredPseudoTest(lowerName);
      }

      const kind = isElement ? 'pseudo-element' : 'pseudo-class';
      const displayName = isElement ? `::${lowerName}` : `:${lowerName}`;
      c.error(`Unsupported ${kind} '${displayName}'`);
    }
  }
}

export function parseStrictSelectorList(c: Cursor, ctx: ParseContext): SelectorList {
  c.expect('(');
  consumeTrivia(c);

  let ch = c.peek();

  if (ch === ')' || ch === '') {
    c.error(`Expected selector in pseudo-class body, got ${ch || '<eof>'}`);
  }

  const selectors: ComplexSelector[] = [];
  let usesScope = false;

  while (ch !== ')' && ch !== '') {
    const complex = parseComplexSelector(c, ctx);
    if (complex.usesScope) usesScope = true;
    selectors.push(complex);

    consumeTrivia(c);
    ch = c.peek();

    if (ch === ')' || ch === '') break;

    if (ch !== ',') {
      c.error(`Expected "," or ")" in pseudo-class body, got ${ch}`);
    }

    c.advance();
    consumeTrivia(c);
    ch = c.peek();

    if (ch === ')' || ch === '') {
      c.error(`Expected selector after comma in pseudo-class body, got ${ch || '<eof>'}`);
    }
  }

  if (ch === ')') {
    c.advance();
  }

  return { selectors, usesScope };
}

export function parseForgivingSelectorList(c: Cursor, ctx: ParseContext): SelectorList {
  c.expect('(');
  consumeTrivia(c);

  let ch = c.peek();

  if (ch === ')' || ch === '') {
    c.error(`Expected selector in pseudo-class body, got ${ch || '<eof>'}`);
  }

  const selectors: ComplexSelector[] = [];
  let usesScope = false;

  while (ch !== ')' && ch !== '') {
    consumeTrivia(c);
    ch = c.peek();

    if (ch === ',' || ch === ')' || ch === '') {
      c.error(`Expected selector in pseudo-class body, got ${ch || '<eof>'}`);
    }

    const armStart = c.pos();

    try {
      const complex = parseComplexSelector(c, ctx);
      if (complex.usesScope) usesScope = true;
      selectors.push(complex);
    } catch {
      c.restore(armStart);
      consumeForgivingSelectorArm(c);
    }

    consumeTrivia(c);
    ch = c.peek();

    if (ch === ')' || ch === '') break;

    if (ch !== ',') {
      c.error(`Expected "," or ")" in pseudo-class body, got ${ch}`);
    }

    c.advance();
    consumeTrivia(c);
    ch = c.peek();

    if (ch === ',' || ch === ')' || ch === '') {
      c.error(`Expected selector after comma in pseudo-class body, got ${ch || '<eof>'}`);
    }
  }

  if (ch === ')') c.advance();

  return { selectors, usesScope };
}

function consumeForgivingSelectorArm(c: Cursor): void {
  let parenDepth = 0;
  let bracketDepth = 0;
  let quote: string | null = null;

  while (!c.eof()) {
    const ch = c.peek();

    if (quote) {
      if (ch === '\\') {
        c.advance();
        if (!c.eof()) c.advance();
        continue;
      }

      if (ch === quote) {
        quote = null;
        c.advance();
        continue;
      }

      c.advance();
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      c.advance();
      continue;
    }

    if (ch === '/' && c.peek(1) === '*') {
      c.advance(2);

      while (!c.eof()) {
        if (c.peek() === '*' && c.peek(1) === '/') {
          c.advance(2);
          break;
        }

        c.advance();
      }

      continue;
    }

    if (ch === '\\') {
      c.advance();
      if (!c.eof()) c.advance();
      continue;
    }

    if (ch === '[') {
      bracketDepth++;
      c.advance();
      continue;
    }

    if (ch === ']') {
      if (bracketDepth > 0) bracketDepth--;
      c.advance();
      continue;
    }

    if (bracketDepth === 0) {
      if (ch === '(') {
        parenDepth++;
        c.advance();
        continue;
      }

      if (ch === ')') {
        if (parenDepth === 0) break;
        parenDepth--;
        c.advance();
        continue;
      }

      if (ch === ',' && parenDepth === 0) break;
    }

    c.advance();
  }
}

export type RelativeSelectorList = {
  arms: RelativeComplexSelector[];
  usesScope?: boolean;
};

export type RelativeComplexSelector = {
  steps: RelativeStep[];
  usesScope?: boolean;
};

export type RelativeStep = {
  combinator: Combinator;
  compound: RelativeCompoundSelector;
};

export type RelativeCompoundSelector = {
  source: string;
};

export function parseRelativeSelectorList(c: Cursor, ctx: ParseContext): RelativeSelectorList {
  c.expect('(');
  consumeTrivia(c);

  let ch = c.peek();

  if (ch === ')' || ch === '') {
    c.error(`Expected relative selector in pseudo-class body, got ${ch || '<eof>'}`);
  }

  const arms: RelativeComplexSelector[] = [];
  let usesScope = false;

  while (ch !== ')' && ch !== '') {
    const arm = parseRelativeComplexSelector(c, ctx);
    if (arm.usesScope) usesScope = true;
    arms.push(arm);

    consumeTrivia(c);
    ch = c.peek();

    if (ch === ')' || ch === '') break;

    if (ch !== ',') {
      c.error(`Expected "," or ")" in relative selector list, got ${ch}`);
    }

    c.advance();
    consumeTrivia(c);
    ch = c.peek();

    if (ch === ')' || ch === '') {
      c.error(`Expected relative selector after comma in pseudo-class body, got ${ch || '<eof>'}`);
    }
  }

  if (ch === ')') c.advance();

  return { arms, usesScope };
}

function parseRelativeComplexSelector(c: Cursor, ctx: ParseContext): RelativeComplexSelector {
  const steps: RelativeStep[] = [];
  let usesScope = false;

  consumeTrivia(c);

  let combinator = parseOptionalRelativeCombinator(c) ?? ' ';
  consumeTrivia(c);

  while (true) {
    let ch = c.peek();

    if (ch === '' || ch === ')' || ch === ',' || isCombinator(ch)) {
      c.error(`Expected compound selector after combinator in relative selector, got ${ch || '<eof>'}`);
    }

    const start = c.pos();
    const compound = parseCompoundSelector(c, ctx);
    const source = c.slice(start, c.pos());

    if (compound.usesScope) usesScope = true;

    steps.push({
      combinator,
      compound: { source },
    });

    const sawWs = consumeTrivia(c);
    ch = c.peek();

    if (ch === '' || ch === ')' || ch === ',') break;

    const explicit = parseOptionalRelativeCombinator(c);

    if (explicit) {
      combinator = explicit;
      consumeTrivia(c);
    } else if (sawWs) {
      combinator = ' ';
    } else {
      c.error(`Expected combinator in relative selector, got ${ch}`);
    }
  }

  return { steps, usesScope };
}

function parseOptionalRelativeCombinator(c: Cursor): Combinator | null {
  const ch = c.peek();

  if (ch === '>' || ch === '+' || ch === '~') {
    c.advance();
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
  const ch = c.peek();

  if (ch === 'o' || ch === 'O' || ch === 'e' || ch === 'E') {
    const start = c.pos();
    const word = consumeAsciiWord(c).toLowerCase();

    if (word === 'odd') return { step: 2, offset: 1 };
    if (word === 'even') return { step: 2, offset: 0 };

    c.restore(start);
  }

  const sign = parseOptionalSign(c);
  const digits = consumeDigits(c);
  const n = c.peek();

  if (n !== 'n' && n !== 'N') {
    if (digits === '') c.error(`Expected nth expression, got ${n || '<eof>'}`);

    return {
      step: 0,
      offset: normalizeZero(sign * Number(digits)),
    };
  }

  c.advance();

  const step = digits === '' ? sign : sign * Number(digits);

  consumeTrivia(c);

  let offset = 0;
  const offsetCh = c.peek();

  if (offsetCh === '+' || offsetCh === '-') {
    const offsetSign = parseOptionalSign(c);
    consumeTrivia(c);

    const offsetDigits = consumeDigits(c);
    if (offsetDigits === '') c.error(`Expected offset in nth expression, got ${c.peek() || '<eof>'}`);

    offset = offsetSign * Number(offsetDigits);
  }

  return {
    step: normalizeZero(step),
    offset: normalizeZero(offset),
  };
}

function parseOptionalSign(c: Cursor): 1 | -1 {
  const ch = c.peek();

  if (ch !== '+' && ch !== '-') return 1;

  c.advance();
  return ch === '-' ? -1 : 1;
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

  let ch = c.peek();

  if (ch === ')' || ch === '') {
    c.error(`Expected argument in pseudo-class, got ${ch || '<eof>'}`);
  }

  const arg = consumeIdent(c);

  consumeTrivia(c);
  ch = c.peek();

  if (ch !== '') {
    if (ch !== ')') c.error(`Expected ")" after pseudo-class argument, got ${ch}`);
    c.advance();
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

function consumeTrivia(c: Cursor): boolean {
  let consumed = false;

  while (true) {
    // Whitespace run.
    if (c.consumeWhile(isCssWhitespace) !== 0) consumed = true;

    // Block comment.
    if (c.peek() !== '/' || c.peek(1) !== '*') return consumed;

    consumed = true;
    c.advance(2);

    while (true) {
      const ch = c.next();
      if (ch === '') c.error('Unterminated comment');
      if (ch !== '*' || c.peek() !== '/') continue;
      c.advance();
      break;
    }
  }
}

function canStartSimpleSelector(ch: string): boolean {
  return (
    ch === '#' ||
    ch === '.' ||
    ch === '[' ||
    ch === ':' ||
    ch === '*' ||
    ch === '|' ||
    ch === '&' ||
    canStartIdent(ch)
  );
}


function canStartIdent(ch: string): boolean {
  return ch === '-' || ch === '\\' || isIdentHeadChar(ch);
}

function consumeEscapedChar(c: Cursor): boolean {
  if (!c.match('\\')) return false;
  if (!c.eof()) c.advance();
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


function isIdentHeadChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return ch === '_' || code > 0x9f || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isIdentTailChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return ch === '-' || ch === '_' || code > 0x9f || (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}


function consumeCssEscape(c: Cursor): boolean {
  const start = c.pos();

  if (c.peek() !== '\\') return false;
  c.advance();

  const ch = c.peek();

  // CSS backslash EOF escape. Keep the raw backslash in the identifier;
  // cssIdentUnescape later maps it to U+FFFD.
  if (ch === '') return true;

  if (isHexDigit(ch)) {
    let n = 1;

    while (n < 6 && isHexDigit(c.peek(n))) n++;

    c.advance(n);

    if (c.peek() === '\r' && c.peek(1) === '\n') {
      c.advance(2);
    } else if (isCssWhitespace(c.peek())) {
      c.advance();
    }

    return true;
  }

  // Old regex: backslash followed by a char that is not vertical whitespace
  // and not hex.
  if (!isVerticalWhitespace(ch)) {
    c.advance();
    return true;
  }

  c.restore(start);
  return false;
}

function consumeIdentHead(c: Cursor): boolean {
  const ch = c.peek();

  if (ch === '\x00' || isIdentHeadChar(ch)) {
    c.advance();
    return true;
  }

  return consumeCssEscape(c);
}

function consumeIdentTail(c: Cursor): boolean {
  const ch = c.peek();

  if (ch === '\x00' || isIdentTailChar(ch)) {
    c.advance();
    return true;
  }

  return consumeCssEscape(c);
}

export function consumeIdent(c: Cursor): string {
  const start = c.pos();
  const ch = c.peek();

  if (ch === '-') {
    c.advance();

    if (c.peek() === '-') {
      c.advance();
    } else if (!consumeIdentHead(c)) {
      c.restore(start);
      c.error(`Expected identifier after "-", got ${c.peek() || '<eof>'}`);
    }

    while (consumeIdentTail(c)) {}
    return c.slice(start);
  }

  if (!consumeIdentHead(c)) {
    c.error(`Expected identifier, got ${ch || '<eof>'}`);
  }

  while (consumeIdentTail(c)) {}
  return c.slice(start);
}
