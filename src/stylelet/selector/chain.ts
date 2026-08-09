import { getShadowTreeRoot } from '../../shared/dom';
import { assertNever } from '../../shared/util';
import type { Combinator } from '../syntax/selector';
import {
  asSubjectPredicate, SubjectKind, triAnd, triOr,
  type CandidateElementPredicate, type CandidateSubjectPredicate,
  type CompiledMatcher, type TriMatch,
} from './candidate';
import { nextDescendant } from './runtime';
import type { RuntimeCache } from './runtimeCache';

export type CompiledPart = {
  combinator: Combinator | null;
  matcher: CompiledMatcher;
};

export type CompiledRelativeArm = CompiledRelativeStep[];

type CompiledRelativeStep = {
  combinator: SelectorCombinator;
  matcher: CompiledMatcher;
};

type SelectorCombinator = ' ' | '>' | '+' | '~';

export function buildComplexMatcher(
  parts: CompiledPart[],
  cost: number,
): CompiledMatcher {
  if (parts.length === 0) {
    throw new Error('Cannot build matcher for empty complex selector');
  }

  if (parts.length === 1) {
    const matcher = parts[0]!.matcher;
    return matcher.cost === cost ? matcher : { ...matcher, cost };
  }

  const usesCache = parts.some((part) => part.matcher.usesCache);
  const usesTriMatch = parts.some((part) => part.matcher.usesTriMatch);

  return {
    element: buildComplexElementProof(parts),
    subject: usesTriMatch ? buildComplexSubjectProof(parts) : undefined,
    cost,
    usesCache,
    usesTriMatch,
  };
}

export function buildSelectorListMatcher(
  arms: CompiledMatcher[],
): CompiledMatcher {
  if (arms.length === 0) return FALSE_MATCHER;
  if (arms.length === 1) return arms[0]!;

  const ordered = [...arms].sort((left, right) => left.cost - right.cost);
  const usesCache = ordered.some((arm) => arm.usesCache);
  const usesTriMatch = ordered.some((arm) => arm.usesTriMatch);

  return {
    element: buildElementDisjunction(ordered),
    subject: usesTriMatch ? buildSubjectDisjunction(ordered) : undefined,
    cost: ordered.reduce((total, arm) => total + arm.cost, 0),
    usesCache,
    usesTriMatch,
  };
}

export function buildRelativeSelectorMatcher(
  arms: CompiledRelativeArm[],
  cost: number,
): CompiledMatcher {
  if (arms.length === 0) return FALSE_MATCHER;

  const predicates = arms.map((steps): CandidateElementPredicate =>
    (element, runtimeCache) =>
      matchRelativeFrom(steps, 0, element, runtimeCache));

  const element: CandidateElementPredicate = predicates.length === 1
    ? predicates[0]!
    : function relativeSelectorListMatcher(candidate, runtimeCache) {
      for (const predicate of predicates) {
        if (predicate(candidate, runtimeCache)) return true;
      }
      return false;
    };

  return {
    element,
    cost,
    usesCache: arms.some((steps) =>
      steps.some((step) => step.matcher.usesCache)),
    usesTriMatch: arms.some((steps) =>
      steps.some((step) => step.matcher.usesTriMatch)),
  };
}

const FALSE_MATCHER: CompiledMatcher = {
  element: () => false,
  cost: 0,
  usesCache: false,
  usesTriMatch: false,
};

function buildComplexElementProof(
  parts: CompiledPart[],
): CandidateElementPredicate {
  let proof = parts[0]!.matcher.element;

  for (let index = 1; index < parts.length; index++) {
    const part = parts[index]!;
    const step = part.matcher.element;
    const connect = extendElementProof(part.combinator, proof);

    proof = (candidate, runtimeCache) =>
      step(candidate, runtimeCache) && connect(candidate, runtimeCache);
  }

  return proof;
}

function buildComplexSubjectProof(
  parts: CompiledPart[],
): CandidateSubjectPredicate {
  let proof = asSubjectPredicate(parts[0]!.matcher);

  for (let index = 1; index < parts.length; index++) {
    const part = parts[index]!;
    const step = asSubjectPredicate(part.matcher);
    const connect = extendSubjectProof(part.combinator, proof);

    proof = (candidate, runtimeCache, subject) => triAnd(
      step(candidate, runtimeCache, subject),
      connect(candidate, runtimeCache, subject),
    );
  }

  return proof;
}

function buildElementDisjunction(
  matchers: CompiledMatcher[],
): CandidateElementPredicate {
  return function elementDisjunction(candidate, runtimeCache) {
    for (const matcher of matchers) {
      if (matcher.element(candidate, runtimeCache)) return true;
    }
    return false;
  };
}

function buildSubjectDisjunction(
  matchers: CompiledMatcher[],
): CandidateSubjectPredicate {
  const predicates = matchers.map(asSubjectPredicate);

  return function subjectDisjunction(candidate, runtimeCache, subject) {
    let result: TriMatch = null;

    for (const predicate of predicates) {
      const match = predicate(candidate, runtimeCache, subject);
      if (match === true) return true;
      result = triOr(result, match);
    }

    return result;
  };
}

function extendElementProof(
  combinator: Combinator | null,
  previous: CandidateElementPredicate,
): CandidateElementPredicate {
  switch (combinator) {
    case ' ': return buildAncestorElementProof(previous);
    case '>': return buildParentElementProof(previous);
    case '+': return buildPreviousElementProof(previous);
    case '~': return buildAnyPreviousElementProof(previous);
    case '||': return () => false;
    case null:
      throw new Error('Cannot extend proof from first selector part');
    default:
      return assertNever(combinator);
  }
}

function extendSubjectProof(
  combinator: Combinator | null,
  previous: CandidateSubjectPredicate,
): CandidateSubjectPredicate {
  switch (combinator) {
    case ' ': return buildAncestorSubjectProof(previous);
    case '>': return buildParentSubjectProof(previous);
    case '+': return buildPreviousSubjectProof(previous);
    case '~': return buildAnyPreviousSubjectProof(previous);
    case '||': return () => false;
    case null:
      throw new Error('Cannot extend proof from first selector part');
    default:
      return assertNever(combinator);
  }
}

function buildAncestorElementProof(
  previous: CandidateElementPredicate,
): CandidateElementPredicate {
  return function ancestorElementProof(candidate, runtimeCache) {
    for (
      let parent = candidate.parentElement;
      parent !== null;
      parent = parent.parentElement
    ) {
      if (previous(parent, runtimeCache)) return true;
    }
    return false;
  };
}

function buildAncestorSubjectProof(
  previous: CandidateSubjectPredicate,
): CandidateSubjectPredicate {
  return function ancestorSubjectProof(candidate, runtimeCache, subject) {
    if (subject !== SubjectKind.Element) return false;

    let result: TriMatch | undefined;

    for (
      let parent = candidate.parentElement;
      parent !== null;
      parent = parent.parentElement
    ) {
      const match = previous(parent, runtimeCache, SubjectKind.Element);
      if (match === true) return true;
      result = result === undefined ? match : triOr(result, match);
    }

    const root = getShadowTreeRoot(candidate);
    if (root !== null) {
      const match = previous(root.host, runtimeCache, SubjectKind.HostElement);
      if (match === true) return true;
      result = result === undefined ? match : triOr(result, match);
    }

    return result === undefined ? false : result;
  };
}

function buildParentElementProof(
  previous: CandidateElementPredicate,
): CandidateElementPredicate {
  return function parentElementProof(candidate, runtimeCache) {
    const parent = candidate.parentElement;
    return parent !== null && previous(parent, runtimeCache);
  };
}

function buildParentSubjectProof(
  previous: CandidateSubjectPredicate,
): CandidateSubjectPredicate {
  return function parentSubjectProof(candidate, runtimeCache, subject) {
    if (subject !== SubjectKind.Element) return false;

    let result: TriMatch | undefined;
    const parent = candidate.parentElement;

    if (parent !== null) {
      const match = previous(parent, runtimeCache, SubjectKind.Element);
      if (match === true) return true;
      result = match;
    }

    const root = getShadowTreeRoot(candidate);
    if (root !== null && candidate.parentNode === root) {
      const match = previous(root.host, runtimeCache, SubjectKind.HostElement);
      if (match === true) return true;
      result = result === undefined ? match : triOr(result, match);
    }

    return result === undefined ? false : result;
  };
}

function buildPreviousElementProof(
  previous: CandidateElementPredicate,
): CandidateElementPredicate {
  return function previousElementProof(candidate, runtimeCache) {
    const sibling = candidate.previousElementSibling;
    return sibling !== null && previous(sibling, runtimeCache);
  };
}

function buildPreviousSubjectProof(
  previous: CandidateSubjectPredicate,
): CandidateSubjectPredicate {
  return function previousSubjectProof(candidate, runtimeCache, subject) {
    if (subject !== SubjectKind.Element) return false;
    const sibling = candidate.previousElementSibling;
    return sibling === null
      ? false
      : previous(sibling, runtimeCache, SubjectKind.Element);
  };
}

function buildAnyPreviousElementProof(
  previous: CandidateElementPredicate,
): CandidateElementPredicate {
  return function anyPreviousElementProof(candidate, runtimeCache) {
    for (
      let sibling = candidate.previousElementSibling;
      sibling !== null;
      sibling = sibling.previousElementSibling
    ) {
      if (previous(sibling, runtimeCache)) return true;
    }
    return false;
  };
}

function buildAnyPreviousSubjectProof(
  previous: CandidateSubjectPredicate,
): CandidateSubjectPredicate {
  return function anyPreviousSubjectProof(candidate, runtimeCache, subject) {
    if (subject !== SubjectKind.Element) return false;

    let result: TriMatch | undefined;

    for (
      let sibling = candidate.previousElementSibling;
      sibling !== null;
      sibling = sibling.previousElementSibling
    ) {
      const match = previous(sibling, runtimeCache, SubjectKind.Element);
      if (match === true) return true;
      result = result === undefined ? match : triOr(result, match);
    }

    return result === undefined ? false : result;
  };
}

function matchRelativeFrom(
  steps: CompiledRelativeArm,
  index: number,
  base: Element,
  runtimeCache: RuntimeCache | null,
): boolean {
  if (index >= steps.length) return true;

  const step = steps[index]!;
  const next = index + 1;
  const matches = step.matcher.element;

  switch (step.combinator) {
    case ' ':
      for (
        let node = base.firstElementChild;
        node !== null;
        node = nextDescendant(base, node)
      ) {
        if (matches(node, runtimeCache) &&
          matchRelativeFrom(steps, next, node, runtimeCache)) {
          return true;
        }
      }
      return false;
    case '>':
      for (
        let node = base.firstElementChild;
        node !== null;
        node = node.nextElementSibling
      ) {
        if (matches(node, runtimeCache) &&
          matchRelativeFrom(steps, next, node, runtimeCache)) {
          return true;
        }
      }
      return false;
    case '+': {
      const node = base.nextElementSibling;
      return node !== null && matches(node, runtimeCache) &&
        matchRelativeFrom(steps, next, node, runtimeCache);
    }
    case '~':
      for (
        let node = base.nextElementSibling;
        node !== null;
        node = node.nextElementSibling
      ) {
        if (matches(node, runtimeCache) &&
          matchRelativeFrom(steps, next, node, runtimeCache)) {
          return true;
        }
      }
      return false;
  }
}
