import { Snapshot } from '../snapshot';
import { assertNever } from '../../shared/util';
import {
  PseudoArgumentKind, SelectorKind,
  type Combinator, type ComplexRealSelector, type ComplexRealSelectorList,
  type ComplexSelector, type ComplexSelectorList, type ComplexSelectorUnit,
  type CompoundSelector, type PseudoClassSelector, type RelativeSelectorList,
  type SelectorList, type Specificity,
} from '../syntax/selector';
import {
  buildComplexMatcher, buildRelativeSelectorMatcher,
  buildSelectorListMatcher,
  type CompiledPart, type CompiledRelativeArm,
} from './chain';
import {
  asSubjectPredicate, SubjectKind, triAnd,
  type CandidateElementPredicate, type CandidateSubjectPredicate,
  type CompiledMatcher, type TriMatch,
} from './candidate';
import { emitMatcher } from './emit';

type MatchSelectorList = ComplexSelectorList | ComplexRealSelectorList;
type MatchSelector = ComplexSelector | ComplexRealSelector;

export function matchSelectorList(
  selectors: SelectorList,
  element: Element,
  snapshot: Snapshot = new Snapshot(element.ownerDocument),
): Specificity | null {
  const compiled = compileSelectorList(selectors, snapshot);
  const runtimeCache = compiled.usesCache
    ? snapshot.syncRuntimeCache(snapshot.document)
    : null;
  let result: Specificity | null = null;

  for (const arm of compiled.arms) {
    if (!arm.match(element, runtimeCache)) continue;

    if (result === null || compareSpecificity(arm.specificity, result) > 0) {
      result = arm.specificity;
    }
  }

  return result;
}

export function compileSelectorList(
  selectors: SelectorList,
  snapshot: Snapshot,
): CompiledSelectorList {
  const cached = snapshot.getCompiledSelector<CompiledSelectorList>(selectors);
  if (cached !== undefined) return cached;

  const arms = selectors.arms.map((selector): CompiledSelectorArm => {
    const matcher = compileComplexSelector(selector, snapshot);

    return {
      match: matcher.usesTriMatch
        ? matchElementSubject(matcher)
        : matcher.element,
      specificity: selector.specificity,
      cost: matcher.cost,
      usesCache: matcher.usesCache,
      usesTriMatch: matcher.usesTriMatch,
    };
  });

  const compiled: CompiledSelectorList = {
    arms,
    usesCache: arms.some((arm) => arm.usesCache),
    usesTriMatch: arms.some((arm) => arm.usesTriMatch),
  };

  return snapshot.setCompiledSelector(selectors, compiled);
}

type CompiledSelectorList = {
  arms: CompiledSelectorArm[];
  usesCache: boolean;
  usesTriMatch: boolean;
};

type CompiledSelectorArm = {
  match: CandidateElementPredicate;
  specificity: Specificity;
  cost: number;
  usesCache: boolean;
  usesTriMatch: boolean;
};

function compareSpecificity(left: Specificity, right: Specificity): number {
  return left.a - right.a || left.b - right.b || left.c - right.c;
}

function compileSelectorListMatcher(
  selectors: MatchSelectorList,
  snapshot: Snapshot,
): CompiledMatcher {
  return buildSelectorListMatcher(
    selectors.arms.map((selector) =>
      compileComplexSelector(selector, snapshot)),
  );
}

function compileComplexSelector(
  selector: MatchSelector,
  snapshot: Snapshot,
): CompiledMatcher {
  const parts: CompiledPart[] = selector.parts.map((part) => ({
    combinator: part.combinator,
    matcher: 'unit' in part
      ? compileComplexUnit(part.unit, snapshot)
      : compileCompound(part.compound, snapshot),
  }));

  return buildComplexMatcher(parts, costComplex(selector.parts));
}

function compileComplexUnit(
  unit: ComplexSelectorUnit,
  snapshot: Snapshot,
): CompiledMatcher {
  const matchers: CompiledMatcher[] = [];

  if (unit.compound !== null) {
    matchers.push(compileCompound(unit.compound, snapshot));
  }

  if (unit.pseudoCompounds.length > 0) {
    matchers.push({ ...FALSE_MATCHER, usesTriMatch: true });
  }

  return buildConjunction(matchers, costCompound(unit.compound));
}

function compileCompound(
  compound: CompoundSelector,
  snapshot: Snapshot,
): CompiledMatcher {
  const matchers: CompiledMatcher[] = [];

  if (compound.typeSelector !== null) {
    matchers.push(emitMatcher(compound.typeSelector, snapshot));
  }

  for (const selector of compound.subclasses) {
    matchers.push(
      selector.kind === SelectorKind.PseudoClassSelector
        ? compilePseudoClass(selector, snapshot)
        : emitMatcher(selector, snapshot),
    );
  }

  return buildConjunction(matchers, costCompound(compound));
}

function compilePseudoClass(
  selector: PseudoClassSelector,
  snapshot: Snapshot,
): CompiledMatcher {
  const argument = selector.argument;
  let compiledArgument: CompiledMatcher | undefined;

  switch (selector.name) {
    case 'is':
    case 'where':
      compiledArgument = argument?.kind === PseudoArgumentKind.ForgivingSelectorList
        ? compileSelectorListMatcher(argument.selectors, snapshot)
        : undefined;
      break;
    case 'not':
      compiledArgument = argument?.kind === PseudoArgumentKind.ComplexRealSelectorList
        ? compileSelectorListMatcher(argument.selectors, snapshot)
        : undefined;
      break;
    case 'has':
      compiledArgument = argument?.kind === PseudoArgumentKind.RelativeSelectorList
        ? compileRelativeSelectorList(argument.selectors, snapshot)
        : undefined;
      break;
    case 'host':
      compiledArgument = argument?.kind === PseudoArgumentKind.CompoundSelector
        ? compileCompound(argument.selector, snapshot)
        : undefined;
      break;
    case 'host-context':
      compiledArgument = argument?.kind === PseudoArgumentKind.CompoundSelector
        ? compileCompound(argument.selector, snapshot)
        : undefined;
      break;
    default:
      compiledArgument = undefined;
  }

  return emitMatcher(selector, snapshot, compiledArgument);
}

function compileRelativeSelectorList(
  selectors: RelativeSelectorList,
  snapshot: Snapshot,
): CompiledMatcher {
  const arms: CompiledRelativeArm[] = selectors.arms.map((arm) =>
    arm.selector.parts.map((part, index) => {
      const combinator = index === 0
        ? arm.combinator ?? ' '
        : part.combinator;

      if (combinator === null || combinator === '||') {
        return {
          combinator: ' ',
          matcher: FALSE_MATCHER,
        };
      }

      return {
        combinator,
        matcher: compileComplexUnit(part.unit, snapshot),
      };
    }));

  return buildRelativeSelectorMatcher(
    arms,
    costRelativeSelectorList(selectors),
  );
}

function buildConjunction(
  matchers: CompiledMatcher[],
  cost: number,
): CompiledMatcher {
  if (matchers.length === 0) return { ...TRUE_MATCHER, cost };
  if (matchers.length === 1) {
    const matcher = matchers[0]!;
    return matcher.cost === cost ? matcher : { ...matcher, cost };
  }

  const ordered = [...matchers].sort(
    (left, right) => left.cost - right.cost,
  );
  const usesCache = ordered.some((matcher) => matcher.usesCache);
  const usesTriMatch = ordered.some((matcher) => matcher.usesTriMatch);

  const element: CandidateElementPredicate = (candidate, runtimeCache) => {
    for (const matcher of ordered) {
      if (!matcher.element(candidate, runtimeCache)) return false;
    }
    return true;
  };

  return {
    element,
    subject: usesTriMatch ? buildSubjectConjunction(ordered) : undefined,
    cost,
    usesCache,
    usesTriMatch,
  };
}

function buildSubjectConjunction(
  matchers: CompiledMatcher[],
): CandidateSubjectPredicate {
  const predicates = matchers.map(asSubjectPredicate);

  return function subjectConjunction(candidate, runtimeCache, subject) {
    let result: TriMatch = true;

    for (const predicate of predicates) {
      result = triAnd(
        result,
        predicate(candidate, runtimeCache, subject),
      );
      if (result === null) return null;
    }

    return result;
  };
}

function matchElementSubject(
  matcher: CompiledMatcher,
): CandidateElementPredicate {
  const subject = asSubjectPredicate(matcher);
  return (element, runtimeCache) =>
    subject(element, runtimeCache, SubjectKind.Element) === true;
}

const TRUE_MATCHER: CompiledMatcher = {
  element: () => true,
  cost: 0,
  usesCache: false,
  usesTriMatch: false,
};

const FALSE_MATCHER: CompiledMatcher = {
  element: () => false,
  cost: 0,
  usesCache: false,
  usesTriMatch: false,
};

// Selector cost

function costComplex(
  parts: ComplexSelector['parts'] | ComplexRealSelector['parts'],
): number {
  let cost = 0;

  for (const part of parts) {
    cost += combinatorCost(part.combinator);
    cost += 'unit' in part
      ? costCompound(part.unit.compound)
      : costCompound(part.compound);
  }

  return cost;
}

function costCompound(compound: CompoundSelector | null): number {
  if (compound === null) return 0;

  let cost = compound.typeSelector === null ? 0 : 2;

  for (const selector of compound.subclasses) {
    switch (selector.kind) {
      case SelectorKind.IdSelector: cost += 1; break;
      case SelectorKind.ClassSelector: cost += 2; break;
      case SelectorKind.AttributeSelector: cost += 4; break;
      case SelectorKind.PseudoClassSelector: cost += 8; break;
      default: assertNever(selector);
    }
  }

  return cost;
}

function costRelativeSelectorList(selectors: RelativeSelectorList): number {
  return selectors.arms.length * 8 + 1;
}

function combinatorCost(combinator: Combinator | null): number {
  switch (combinator) {
    case null: return 0;
    case '>': return 1;
    case '+': return 2;
    case ' ': return 8;
    case '~': return 12;
    case '||': return 16;
    default: return assertNever(combinator);
  }
}
