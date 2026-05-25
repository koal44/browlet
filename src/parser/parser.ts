import type { CustomPseudoPredicate } from "../selectlet";
import { cssIdentUnescape } from "../utils/css";
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
import { canStartIdent, canStartSimpleSelector, consumeIdent, consumeStringValue, consumeTrivia, isCombinator, isCssWhitespace } from "./lex";
import { parseNthArgs } from "./nth";

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

type ComplexPart = {
  // null for the first compound in the complex selector
  combinator: Combinator | null;
  compound: CompoundSelector;
};

export type CompoundSelector = {
  id?: IdSelector;
  classes?: ClassSelector[];
  tag?: TagSelector;
  usesScope?: boolean;
  tests: CandidateTest[];
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
export type ParseContext = {
  pseudos?: Record<string, CustomPseudoPredicate>;
};

export function parseSelectorList(input: string, ctx: ParseContext): SelectorList {
  const c = new Cursor(input);
  return parseSelectorListFrom(c, ctx);
}

function parseSelectorListFrom(c: Cursor, ctx: ParseContext): SelectorList {
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
    assertCompoundBoundary(c.peek());
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

function assertCompoundBoundary(ch: string): void {
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

type AttrOperator = '=' | '~=' | '|=' | '^=' | '$=' | '*=';

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

type RelativeComplexSelector = {
  steps: RelativeStep[];
  usesScope?: boolean;
};

type RelativeStep = {
  combinator: Combinator;
  compound: RelativeCompoundSelector;
};

type RelativeCompoundSelector = {
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
