import type { CustomPseudoPredicate } from '../selectlet';
import { cssIdentUnescape } from '../../utils/css';
import { Cursor, SelectorSyntaxError } from './cursor';
import {
  emitActivePseudoTest, emitAnyLinkPseudoTest, emitAttributeTest, emitBufferingPseudoTest,
  emitCheckedPseudoTest, emitDefaultPseudoTest, emitDefinedPseudoTest, emitDirPseudoTest,
  emitDisabledPseudoTest, emitEmptyPseudoTest, emitEnabledPseudoTest, emitFirstChildPseudoTest,
  emitFirstOfTypePseudoTest, emitFocusPseudoTest, emitFocusVisiblePseudoTest, emitFocusWithinPseudoTest,
  emitHasPseudoTest, emitHostContextPseudoTest, emitHostPseudoTest, emitHoverPseudoTest, emitIndeterminatePseudoTest, emitInRangePseudoTest,
  emitInvalidPseudoTest, emitIsPseudoTest, emitLangPseudoTest, emitLastChildPseudoTest,
  emitLastOfTypePseudoTest, emitLinkPseudoTest, emitMutedPseudoTest, emitNoMatchPseudoElementTest,
  emitNoMatchPseudoTest, emitNotPseudoTest, emitNthPseudoTest, emitOnlyChildPseudoTest,
  emitOnlyOfTypePseudoTest, emitOptionalPseudoTest, emitOutOfRangePseudoTest, emitPartPseudoElementTest, emitPausedPseudoTest,
  emitPlaceholderShownPseudoTest, emitPlayingPseudoTest, emitReadOnlyPseudoTest, emitReadWritePseudoTest,
  emitRegisteredPseudoTest,
  emitRequiredPseudoTest, emitRootPseudoTest, emitScopePseudoTest, emitSeekingPseudoTest,
  emitSlottedPseudoElementTest,
  emitStalledPseudoTest, emitStatePseudoTest, emitTargetPseudoTest, emitValidPseudoTest, emitVisitedPseudoTest,
  emitVolumeLockedPseudoTest, emitWherePseudoTest,
} from '../compile/emit';
import {
  canStartIdent, canStartSimpleSelector, consumeIdent, consumeStringValue, consumeTrivia,
  isCombinator, isCssWhitespace,
} from './lex';
import { parseNthArgs } from './nth';
import { combinatorCost } from '../planner/cost';
import { emitIdTest } from '../compile/emit-seedable';
import type { RuntimeCache } from '../compile/runtimeCache';
import type { SubjectKind } from '../constants';

export type SelectorList = {
  arms: ComplexSelector[];
  usesScope: boolean;
  usesCache: boolean;
  usesHost: boolean;
  cost: number;
};

export type Combinator = ' ' | '>' | '+' | '~';

export type ComplexSelector = {
  parts: ComplexPart[];
  usesScope: boolean;
  usesCache: boolean;
  usesHost: boolean;
  cost: number;

  // Whether a contained compound's ID/class/tag was used as a seed
  // Source-keyed lambda caching is unsafe because the matcher skips seeded tests.
  hasSeed?: boolean;
};

export type ComplexPart = {
  // null for the first compound in the complex selector
  combinator: Combinator | null;
  compound: CompoundSelector;
  cost: number;
};

export type CompoundSelector = {
  id?: IdSelector;
  classes?: ClassSelector[];
  tag?: TagSelector;
  usesScope: boolean;
  usesCache: boolean;
  usesHost: boolean;
  cost: number;
  tests: CandidateTest[];
};

export type IdSelector = {
  // Raw CSS identifier payload, without "#", before CSS unescaping.
  raw: string;
  cost: number;

  // Whether this simple selector is used as a seed and thus should be skipped from compiled tests.
  seed?: boolean;
};

export type ClassSelector = {
  // Raw CSS identifier payload, without ".", before CSS unescaping.
  raw: string;
  cost: number;
  seed?: boolean;
};

export type TagSelector = {
  prefixRaw?: '' | '*';
  localRaw: string;
  cost: number;
  seed?: boolean;
};

export type BuildElementPredicate = (snap: Snapshot) => CandidateElementPredicate;
export type BuildSubjectPredicate = (snap: Snapshot) => CandidateSubjectPredicate;

export type CandidateTest = {
  buildElement: BuildElementPredicate;
  buildSubject?: BuildSubjectPredicate;

  unique?: boolean;
  usesScope?: boolean;
  usesCache?: boolean;
  usesHost?: boolean;
  cost: number;
  debug?: CandidateTestDebug;
};

export type CandidateElementPredicate =
  (e: Element, rc: RuntimeCache | null) => boolean;

export type CandidateSubjectPredicate =
  (e: Element, rc: RuntimeCache | null, kind: SubjectKind) => true | false | null;

export type TriMatch = true | false | null;

type CandidateTestDebug =
  | { kind: 'static'; value: boolean; }
  | { kind: 'attr'; attr: AttributeSelector; }
  | { kind: 'pseudo'; name: string; }
  | { kind: 'host'; arg?: CompoundSelector; }
  | { kind: 'host-context'; arg: CompoundSelector; }
  | { kind: 'pseudo-element'; name: string; }
  | { kind: 'registered-pseudo'; name: string; }
  | { kind: 'is'; list: SelectorList; }
  | { kind: 'where'; list: SelectorList; }
  | { kind: 'not'; list: SelectorList; }
  | { kind: 'has'; list: RelativeSelectorList; }
  | { kind: 'parts'; parts: string[]; }

export type ParseContext = {
  pseudos?: Record<string, CustomPseudoPredicate>;

  // Scoped grammar context: do not mutate/reset on shared ctx.
  inHas?: boolean;
  inHost?: boolean;
  forbidEls?: boolean;

  // Linear parser state: mutated while parsing one selector arm.
  afterPart?: boolean;
  afterSlotted?: boolean;
  afterNonPartEl?: boolean; // ::pseudo (mod ::part)
};

function resetSelectorArmState(ctx: ParseContext): void {
  if (ctx.afterPart) ctx.afterPart = false;
  if (ctx.afterSlotted) ctx.afterSlotted = false;
  if (ctx.afterNonPartEl) ctx.afterNonPartEl = false;
}

export function parseSelectorList(input: string, ctx: ParseContext): SelectorList {
  const c = new Cursor(input);
  return parseSelectorListFrom(c, ctx);
}

function parseSelectorListFrom(c: Cursor, ctx: ParseContext): SelectorList {
  const selectors: ComplexSelector[] = [];
  let usesScope = false;
  let usesCache = false;
  let usesHost = false;
  let cost = 0;

  consumeTrivia(c);

  let ch = c.peek();

  if (ch === '') {
    c.error('Expected selector, got <eof>');
  }

  while (ch !== '') {
    resetSelectorArmState(ctx);
    const complex = parseComplexSelector(c, ctx);

    if (complex.usesScope) usesScope = true;
    if (complex.usesCache) usesCache = true;
    if (complex.usesHost) usesHost = true;
    cost += complex.cost;
    selectors.push(complex);

    consumeTrivia(c);
    ch = c.peek();

    if (ch !== ',') break;

    c.advance();
    consumeTrivia(c);
    ch = c.peek();

    if (ch === '') {
      c.error('Expected selector after comma, got <eof>');
    }
  }

  consumeTrivia(c);
  ch = c.peek();

  if (ch !== '') {
    c.error(`Unexpected character ${ch}`);
  }

  return { arms: selectors, usesScope, usesCache, usesHost, cost };
}

export function parseComplexSelector(c: Cursor, ctx: ParseContext): ComplexSelector {
  // const start = c.pos();
  const parts: ComplexPart[] = [];

  const first = parseCompoundSelector(c, ctx);
  const firstPart: ComplexPart = {
    combinator: null,
    compound: first,
    cost: first.cost,
  };

  parts.push(firstPart);

  let usesScope = first.usesScope;
  let usesCache = first.usesCache;
  let usesHost = first.usesHost;
  let cost = firstPart.cost;

  while (true) {
    const sawWs = consumeTrivia(c);
    let ch = c.peek();

    if (!ch || ch === ',' || ch === ')') break;
    if (ctx.afterPart) c.error('Combinators are not allowed after ::part()');

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
    const partCost = combinatorCost(combinator) + compound.cost;
    if (compound.usesScope) usesScope = true;
    if (compound.usesCache) usesCache = true;
    if (compound.usesHost) usesHost = true;
    cost += partCost;

    parts.push({
      combinator, compound,
      cost: partCost,
    });
  }

  return {
    parts, usesScope, usesCache, usesHost, cost,
    // source: c.slice(start, end),
  };
}

export function parseCompoundSelector(c: Cursor, ctx: ParseContext): CompoundSelector {
  const compound: CompoundSelector = {
    usesScope: false,
    usesCache: false,
    usesHost: false,
    cost: 0,
    tests: [],
  };

  let count = 0;

  while (true) {
    const ch = c.peek();
    if (!ch || ch === ',' || ch === ')' || !canStartSimpleSelector(ch)) break;

    parseSimpleSelectorInto(c, compound, count === 0, ctx);
    count++;

    const next = c.peek();
    if (!next || next === ',' || next === ')') break;

    assertCompoundBoundary(next);
  }

  if (count === 0) {
    c.error(`Expected compound selectors but did not find any simple selector, got ${c.peek() || '<eof>'}`);
  }

  return compound;
}

function parseSimpleSelectorInto(c: Cursor, compound: CompoundSelector, isFirstInCompound: boolean, ctx: ParseContext): void {
  if (ctx.afterSlotted) c.error('No selectors are allowed after ::slotted()');
  const ch = c.peek();

  if (ch === '#') {
    const id = parseIdSelector(c);

    if (!compound.id) {
      compound.id = id;
      compound.cost += id.cost;
      return;
    }

    const test = emitIdTest(id);
    compound.tests.push(test);
    compound.cost += test.cost;
    return;
  }

  if (ch === '.') {
    const cls = parseClassSelector(c);
    (compound.classes ??= []).push(cls);
    compound.cost += cls.cost;
    return;
  }

  if (ch === '[') {
    const test = emitAttributeTest(parseAttributeSelector(c));
    compound.tests.push(test);
    compound.cost += test.cost;
    return;
  }

  if (ch === ':') {
    const name = parsePseudoIdent(c);
    const pseudoTest = parsePseudoTestSource(c, ctx, name);
    if (pseudoTest.usesScope) compound.usesScope = true;
    if (pseudoTest.usesCache) compound.usesCache = true;
    if (pseudoTest.usesHost) compound.usesHost = true;
    compound.tests.push(pseudoTest);
    compound.cost += pseudoTest.cost;
    return;
  }

  if (ch === '&') {
    c.advance();
    compound.usesScope = true;

    const scopeTest = emitScopePseudoTest();
    compound.tests.push(scopeTest);
    compound.cost += scopeTest.cost;
    return;
  }

  if ((ch === '*' || ch === '|' || canStartIdent(ch)) && isFirstInCompound) {
    if (compound.tag) c.error(`Duplicate tag selector in compound, already have ${compound.tag.prefixRaw ? compound.tag.prefixRaw + '|' : ''}${compound.tag.localRaw}`);
    compound.tag = parseTagSelector(c);
    compound.cost += compound.tag.cost;
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

  throw new SelectorSyntaxError(`Expected simple selector boundary, got ${ch || '<eof>'}`);
}

function parseIdSelector(c: Cursor): IdSelector {
  c.expect('#');

  return {
    raw: consumeIdent(c),
    cost: 3,
  };
}

function parseClassSelector(c: Cursor): ClassSelector {
  c.expect('.');

  return {
    raw: consumeIdent(c),
    cost: 4,
  };
}

function parseTagSelector(c: Cursor): TagSelector {
  const ch = c.peek();

  if (ch === '*') {
    c.advance();

    if (c.match('|')) {
      const localRaw = parseLocalTagName(c);
      return {
        prefixRaw: '*',
        localRaw,
        cost: localRaw === '*' ? 0 : 4,
      };
    }

    return { localRaw: '*', cost: 0 };
  }

  if (ch === '|') {
    c.advance();
    return { prefixRaw: '', localRaw: parseLocalTagName(c), cost: 4 };
  }

  const first = consumeIdent(c);

  if (c.match('|')) {
    c.error(`Unsupported namespace prefix ${first}`);
  }

  return { localRaw: first, cost: 4 };
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

function parseHostPseudoArg(c: Cursor, ctx: ParseContext): CompoundSelector | undefined {
  if (c.peek() !== '(') return undefined;

  const x: ParseContext = { ...ctx, forbidEls: true, inHost: true };
  return parseCompoundPseudoArg(c, x, ':host()');
}

function parseHostContextPseudoArg(c: Cursor, ctx: ParseContext): CompoundSelector {
  const x: ParseContext = { ...ctx, forbidEls: true, inHost: true };
  return parseCompoundPseudoArg(c, x, ':host-context()');
}

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

function parsePseudoIdent(c: Cursor): string {
  c.expect(':');

  const isElement = c.match(':');
  const rawName = consumeIdent(c);
  const lowerName = rawName.toLowerCase();

  return isElement ? `:${lowerName}` : lowerName;
}

function parsePseudoTestSource(c: Cursor, ctx: ParseContext, name: string): CandidateTest {
  const isElement = name.startsWith(':');
  const lowerName = isElement ? name.slice(1) : name;

  if (isElement && ctx.forbidEls) {
    c.error(`Pseudo-element ::${lowerName} is not allowed here`);
  }

  switch (name) {
    // tree-structural pseudo-classes
    case 'scope': return emitScopePseudoTest();
    case 'root': return emitRootPseudoTest();
    case 'host': {
      return emitHostPseudoTest(parseHostPseudoArg(c, ctx));
    }

    case 'host-context': {
      return emitHostContextPseudoTest(parseHostContextPseudoArg(c, ctx));
    }
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
    case 'is': {
      const x: ParseContext = { ...ctx, forbidEls: true };
      const pseudoList = x.inHost
        ? keepCompoundArms(parseForgivingSelectorList(c, x))
        : parseForgivingSelectorList(c, x);

      if (pseudoList.arms.length === 0) return emitNoMatchPseudoTest('is');
      return emitIsPseudoTest(pseudoList);
    }

    case 'where': {
      const x: ParseContext = { ...ctx, forbidEls: true };
      const pseudoList = x.inHost
        ? keepCompoundArms(parseForgivingSelectorList(c, x))
        : parseForgivingSelectorList(c, x);

      if (pseudoList.arms.length === 0) return emitNoMatchPseudoTest('where');
      return emitWherePseudoTest(pseudoList);
    }

    case 'not': {
      const x: ParseContext = { ...ctx, forbidEls: true };

      if (x.inHost) {
        return emitNotPseudoTest(
          selectorListFromCompound(parseCompoundPseudoArg(c, x, ':not()')),
        );
      }

      return emitNotPseudoTest(parseStrictSelectorList(c, x));
    }
    case 'has': {
      if (ctx.afterPart) c.error(':has() is not allowed after ::part()');
      const x: ParseContext = { ...ctx, forbidEls: true, inHas: true };
      if (ctx.inHas) c.error('Nested :has() is not allowed');
      const relativeList = parseRelativeSelectorList(c, x);
      if (relativeList.arms.length === 0) c.error('Expected selector in :has() body');
      return emitHasPseudoTest(relativeList);
    }
    case 'matches': return c.error('Unsupported pseudo-class :matches(); use :is()');

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

    case 'state': {
      if (ctx.afterNonPartEl) {
        c.error(':state() is not allowed after this pseudo-element');
      }

      return emitStatePseudoTest(parseIdentPseudoArg(c, ':state() argument'));
    }

    // parse-valid no-op pseudo-classes
    case 'autofill': return emitNoMatchPseudoTest('autofill');
    case '-webkit-autofill': return emitNoMatchPseudoTest('-webkit-autofill');

    // parse-valid legacy single-colon pseudo-elements; match no DOM elements
    case 'after': return emitNoMatchPseudoElementTest('after');
    case 'before': return emitNoMatchPseudoElementTest('before');
    case 'first-letter': return emitNoMatchPseudoElementTest('first-letter');
    case 'first-line': return emitNoMatchPseudoElementTest('first-line');

    case ':after': {
      ctx.afterNonPartEl = true;
      ctx.afterPart = false;
      return emitNoMatchPseudoElementTest('after');
    }
    case ':before': {
      ctx.afterNonPartEl = true;
      ctx.afterPart = false;
      return emitNoMatchPseudoElementTest('before');
    }
    case ':first-letter': {
      ctx.afterNonPartEl = true;
      ctx.afterPart = false;
      return emitNoMatchPseudoElementTest('first-letter');
    }
    case ':first-line': {
      ctx.afterNonPartEl = true;
      ctx.afterPart = false;
      return emitNoMatchPseudoElementTest('first-line');
    }
    case ':selection': {
      ctx.afterNonPartEl = true;
      ctx.afterPart = false;
      return emitNoMatchPseudoElementTest('selection');
    }
    case ':placeholder': {
      ctx.afterNonPartEl = true;
      ctx.afterPart = false;
      return emitNoMatchPseudoElementTest('placeholder');
    }
    case ':file-selector-button': {
      ctx.afterNonPartEl = true;
      ctx.afterPart = false;
      return emitNoMatchPseudoElementTest('file-selector-button');
    }
    case ':part': {
      ctx.afterNonPartEl = false;
      ctx.afterPart = true;
      return emitPartPseudoElementTest(parsePartNameListArg(c));
    }
    case ':slotted': {
      const compound = parseCompoundPseudoArg(c, ctx, '::slotted()');
      ctx.afterSlotted = true;
      ctx.afterNonPartEl = true;
      ctx.afterPart = false;
      return emitSlottedPseudoElementTest(compound);
    }

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
  let usesCache = false;
  let usesHost = false;
  let cost = 0;

  while (ch !== ')' && ch !== '') {
    const complex = parseComplexSelector(c, ctx);

    if (complex.usesScope) usesScope = true;
    if (complex.usesCache) usesCache = true;
    if (complex.usesHost) usesHost = true;
    cost += complex.cost;
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

  return { arms: selectors, usesScope, usesCache, usesHost, cost };
}

export function parseForgivingSelectorList(c: Cursor, ctx: ParseContext): SelectorList {
  c.expect('(');

  const selectors: ComplexSelector[] = [];
  let usesScope = false;
  let usesCache = false;
  let usesHost = false;
  let cost = 0;

  while (true) {
    consumeTrivia(c);
    let ch = c.peek();

    if (ch === ')') {
      c.advance();
      break;
    }

    if (ch === '') {
      break;
    }

    if (ch === ',') {
      c.advance();
      continue;
    }

    const armStart = c.pos();

    try {
      const complex = parseComplexSelector(c, ctx);

      if (complex.usesScope) usesScope = true;
      if (complex.usesCache) usesCache = true;
      if (complex.usesHost) usesHost = true;
      cost += complex.cost;
      selectors.push(complex);
    } catch {
      c.restore(armStart);
      consumeForgivingSelectorArm(c);
    }

    consumeTrivia(c);
    ch = c.peek();

    if (ch === ',') {
      c.advance();
      continue;
    }

    if (ch === ')') {
      c.advance();
      break;
    }

    if (ch === '') {
      break;
    }

    c.error(`Expected "," or ")" in pseudo-class body, got ${ch}`);
  }

  return { arms: selectors, usesScope, usesCache, usesHost, cost };
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
  usesScope: boolean;
  usesCache: boolean;
  usesHost: boolean;
  cost: number;
};

export type RelativeComplexSelector = {
  steps: RelativeStep[];
  usesScope: boolean;
  usesCache: boolean;
  usesHost: boolean;
  cost: number;
};

type RelativeStep = {
  combinator: Combinator;
  compound: RelativeCompoundSelector;
  cost: number;
};

export type RelativeCompoundSelector = {
  compound: CompoundSelector;
  usesScope: boolean;
  usesCache: boolean;
  usesHost: boolean;
  cost: number;
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
  let usesCache = false;
  let usesHost = false;
  let cost = 0;

  while (ch !== ')' && ch !== '') {
    const arm = parseRelativeComplexSelector(c, ctx);
    if (arm.usesScope) usesScope = true;
    if (arm.usesCache) usesCache = true;
    if (arm.usesHost) usesHost = true;
    cost += arm.cost;
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

  return { arms, usesScope, usesCache, usesHost, cost };
}

function parseRelativeComplexSelector(c: Cursor, ctx: ParseContext): RelativeComplexSelector {
  const steps: RelativeStep[] = [];
  let usesScope = false;
  let usesCache = false;
  let usesHost = false;
  let cost = 0;

  consumeTrivia(c);

  let combinator = parseOptionalRelativeCombinator(c) ?? ' ';
  consumeTrivia(c);

  while (true) {
    let ch = c.peek();

    if (ch === '' || ch === ')' || ch === ',' || isCombinator(ch)) {
      c.error(`Expected compound selector after combinator in relative selector, got ${ch || '<eof>'}`);
    }

    const compound = parseCompoundSelector(c, ctx);

    if (compound.usesScope) usesScope = true;
    if (compound.usesCache) usesCache = true;
    if (compound.usesHost) usesHost = true;

    const stepCost = combinatorCost(combinator) + compound.cost;
    cost += stepCost;

    steps.push({
      combinator,
      cost: stepCost,
      compound: {
        compound,
        usesScope: compound.usesScope === true,
        usesCache: compound.usesCache === true,
        usesHost: compound.usesHost === true,
        cost: compound.cost,
      },
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

  return { steps, usesScope, usesCache, usesHost, cost };
}

function parseOptionalRelativeCombinator(c: Cursor): Combinator | null {
  const ch = c.peek();

  if (ch === '>' || ch === '+' || ch === '~') {
    c.advance();
    return ch;
  }

  return null;
}

function parseDirPseudoArg(c: Cursor): string { // 'ltr' | 'rtl'
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

function parseCompoundPseudoArg(c: Cursor, ctx: ParseContext, label = 'pseudo'): CompoundSelector {
  c.expect('(');
  consumeTrivia(c);

  let ch = c.peek();

  if (ch === ')' || ch === '') {
    c.error(`Expected selector in ${label} body, got ${ch || '<eof>'}`);
  }

  const compound = parseCompoundSelector(c, ctx);

  consumeTrivia(c);
  ch = c.peek();

  if (ch === ')') {
    c.advance();
    return compound;
  }

  if (ch !== '') {
    c.error(`Expected ")" after ${label} argument, got ${ch}`);
  }

  return compound;
}

function parsePartNameListArg(c: Cursor): string[] {
  c.expect('(');
  consumeTrivia(c);

  const idents: string[] = [];

  while (true) {
    const ch = c.peek();

    if (ch === ')' || ch === '') {
      break;
    }

    idents.push(consumeIdent(c));
    consumeTrivia(c);
  }

  if (idents.length === 0) {
    c.error(`Expected part name in ::part() body, got ${c.peek() || '<eof>'}`);
  }

  const ch = c.peek();

  if (ch === ')') {
    c.advance();
    return idents;
  }

  if (ch !== '') {
    c.error(`Expected ")" after ::part() argument, got ${ch}`);
  }

  return idents;
}

function parseIdentPseudoArg(c: Cursor, label: string): string {
  c.expect('(');
  consumeTrivia(c);

  let ch = c.peek();

  if (ch === ')' || ch === '') {
    c.error(`Expected ${label} in pseudo-class body, got ${ch || '<eof>'}`);
  }

  const raw = consumeIdent(c);

  consumeTrivia(c);
  ch = c.peek();

  if (ch !== ')') {
    c.error(`Expected ")" after ${label}, got ${ch || '<eof>'}`);
  }

  c.advance();
  return raw;
}

function selectorListFromCompound(compound: CompoundSelector): SelectorList {
  return {
    arms: [{
      parts: [{ combinator: null, compound, cost: compound.cost }],
      usesScope: compound.usesScope,
      usesCache: compound.usesCache,
      usesHost: compound.usesHost,
      cost: compound.cost,
    }],
    usesScope: compound.usesScope,
    usesCache: compound.usesCache,
    usesHost: compound.usesHost,
    cost: compound.cost,
  };
}

function keepCompoundArms(list: SelectorList): SelectorList {
  const arms: ComplexSelector[] = [];
  let cost = 0;
  let usesScope = false;
  let usesCache = false;
  let usesHost = false;

  for (let i = 0; i < list.arms.length; i++) {
    const arm = list.arms[i]!;

    if (arm.parts.length !== 1) continue;

    arms.push(arm);
    cost += arm.cost;
    usesScope = usesScope || arm.usesScope;
    usesCache = usesCache || arm.usesCache;
    usesHost = usesHost || arm.usesHost;
  }

  return {
    arms,
    cost,
    usesScope,
    usesCache,
    usesHost,
  };
}
