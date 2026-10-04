import type { DOMOperations, DOMElement as Element, DOMShadowRoot as ShadowRoot } from '../../infra/index';
import { assertNever } from '../../infra/util';
import type { Combinator } from '../syntax/selector';
import {
  asSubjectPredicate, SubjectKind, triAnd, triOr,
  type CandidateElementPredicate, type CandidateSubjectPredicate,
  type CompiledMatcher, type TriMatch,
} from './candidate';
import { nextDescendant } from './runtime';
import type { RuntimeCache } from './runtimeCache';
import { InternalError } from '../../infra/internal-error';

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
  cost: number, dom: DOMOperations,
): CompiledMatcher {
  if (parts.length === 0) {
    throw new InternalError('Cannot build matcher for empty complex selector');
  }

  if (parts.length === 1) {
    const matcher = parts[0]!.matcher;
    return matcher.cost === cost ? matcher : { ...matcher, cost };
  }

  const usesCache = parts.some((part) => part.matcher.usesCache);
  const usesTriMatch = parts.some((part) => part.matcher.usesTriMatch);

  return {
    element: buildComplexElementProof(parts, dom),
    subject: usesTriMatch ? buildComplexSubjectProof(parts, dom) : undefined,
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
  cost: number, dom: DOMOperations,
): CompiledMatcher {
  if (arms.length === 0) return FALSE_MATCHER;

  const predicates = arms.map((steps): CandidateElementPredicate =>
    (element, runtimeCache) =>
      matchRelativeFrom(steps, 0, element, runtimeCache, dom));

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
  parts: CompiledPart[], dom: DOMOperations,
): CandidateElementPredicate {
  let proof = parts[0]!.matcher.element;

  for (let index = 1; index < parts.length; index++) {
    const part = parts[index]!;
    const step = part.matcher.element;
    const connect = extendElementProof(part.combinator, proof, dom);

    proof = (candidate, runtimeCache) =>
      step(candidate, runtimeCache) && connect(candidate, runtimeCache);
  }

  return proof;
}

function buildComplexSubjectProof(
  parts: CompiledPart[], dom: DOMOperations,
): CandidateSubjectPredicate {
  let proof = asSubjectPredicate(parts[0]!.matcher);

  for (let index = 1; index < parts.length; index++) {
    const part = parts[index]!;
    const step = asSubjectPredicate(part.matcher);
    const connect = extendSubjectProof(part.combinator, proof, dom);

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
  previous: CandidateElementPredicate, dom: DOMOperations,
): CandidateElementPredicate {
  switch (combinator) {
    case ' ': return buildAncestorElementProof(previous, dom);
    case '>': return buildParentElementProof(previous, dom);
    case '+': return buildPreviousElementProof(previous, dom);
    case '~': return buildAnyPreviousElementProof(previous, dom);
    case '||': return () => false;
    case null:
      throw new InternalError('Cannot extend proof from first selector part');
    default:
      return assertNever(combinator);
  }
}

function extendSubjectProof(
  combinator: Combinator | null,
  previous: CandidateSubjectPredicate, dom: DOMOperations,
): CandidateSubjectPredicate {
  switch (combinator) {
    case ' ': return buildAncestorSubjectProof(previous, dom);
    case '>': return buildParentSubjectProof(previous, dom);
    case '+': return buildPreviousSubjectProof(previous, dom);
    case '~': return buildAnyPreviousSubjectProof(previous, dom);
    case '||': return () => false;
    case null:
      throw new InternalError('Cannot extend proof from first selector part');
    default:
      return assertNever(combinator);
  }
}

function buildAncestorElementProof(
  previous: CandidateElementPredicate, dom: DOMOperations,
): CandidateElementPredicate {
  return function ancestorElementProof(candidate, runtimeCache) {
    for (
      let parent = dom.parentElement(candidate);
      parent !== null;
      parent = dom.parentElement(parent)
    ) {
      if (previous(parent, runtimeCache)) return true;
    }
    return false;
  };
}

function buildAncestorSubjectProof(
  previous: CandidateSubjectPredicate, dom: DOMOperations,
): CandidateSubjectPredicate {
  return function ancestorSubjectProof(candidate, runtimeCache, subject) {
    if (subject !== SubjectKind.Element) return false;

    let result: TriMatch | undefined;

    for (
      let parent = dom.parentElement(candidate);
      parent !== null;
      parent = dom.parentElement(parent)
    ) {
      const match = previous(parent, runtimeCache, SubjectKind.Element);
      if (match === true) return true;
      result = result === undefined ? match : triOr(result, match);
    }

    const root = shadowRoot(candidate, dom);
    if (root !== null) {
      const match = previous(dom.shadowHost(root), runtimeCache, SubjectKind.HostElement);
      if (match === true) return true;
      result = result === undefined ? match : triOr(result, match);
    }

    return result === undefined ? false : result;
  };
}

function buildParentElementProof(
  previous: CandidateElementPredicate, dom: DOMOperations,
): CandidateElementPredicate {
  return function parentElementProof(candidate, runtimeCache) {
    const parent = dom.parentElement(candidate);
    return parent !== null && previous(parent, runtimeCache);
  };
}

function buildParentSubjectProof(
  previous: CandidateSubjectPredicate, dom: DOMOperations,
): CandidateSubjectPredicate {
  return function parentSubjectProof(candidate, runtimeCache, subject) {
    if (subject !== SubjectKind.Element) return false;

    let result: TriMatch | undefined;
    const parent = dom.parentElement(candidate);

    if (parent !== null) {
      const match = previous(parent, runtimeCache, SubjectKind.Element);
      if (match === true) return true;
      result = match;
    }

    const root = shadowRoot(candidate, dom);
    if (root !== null && dom.parentNode(candidate) === root) {
      const match = previous(dom.shadowHost(root), runtimeCache, SubjectKind.HostElement);
      if (match === true) return true;
      result = result === undefined ? match : triOr(result, match);
    }

    return result === undefined ? false : result;
  };
}

function buildPreviousElementProof(
  previous: CandidateElementPredicate, dom: DOMOperations,
): CandidateElementPredicate {
  return function previousElementProof(candidate, runtimeCache) {
    const sibling = dom.previousElementSibling(candidate);
    return sibling !== null && previous(sibling, runtimeCache);
  };
}

function buildPreviousSubjectProof(
  previous: CandidateSubjectPredicate, dom: DOMOperations,
): CandidateSubjectPredicate {
  return function previousSubjectProof(candidate, runtimeCache, subject) {
    if (subject !== SubjectKind.Element) return false;
    const sibling = dom.previousElementSibling(candidate);
    return sibling === null
      ? false
      : previous(sibling, runtimeCache, SubjectKind.Element);
  };
}

function buildAnyPreviousElementProof(
  previous: CandidateElementPredicate, dom: DOMOperations,
): CandidateElementPredicate {
  return function anyPreviousElementProof(candidate, runtimeCache) {
    for (
      let sibling = dom.previousElementSibling(candidate);
      sibling !== null;
      sibling = dom.previousElementSibling(sibling)
    ) {
      if (previous(sibling, runtimeCache)) return true;
    }
    return false;
  };
}

function buildAnyPreviousSubjectProof(
  previous: CandidateSubjectPredicate, dom: DOMOperations,
): CandidateSubjectPredicate {
  return function anyPreviousSubjectProof(candidate, runtimeCache, subject) {
    if (subject !== SubjectKind.Element) return false;

    let result: TriMatch | undefined;

    for (
      let sibling = dom.previousElementSibling(candidate);
      sibling !== null;
      sibling = dom.previousElementSibling(sibling)
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
  runtimeCache: RuntimeCache | null, dom: DOMOperations,
): boolean {
  if (index >= steps.length) return true;

  const step = steps[index]!;
  const next = index + 1;
  const matches = step.matcher.element;

  switch (step.combinator) {
    case ' ':
      for (
        let node = dom.firstElementChild(base);
        node !== null;
        node = nextDescendant(base, node, dom)
      ) {
        if (matches(node, runtimeCache) &&
          matchRelativeFrom(steps, next, node, runtimeCache, dom)) {
          return true;
        }
      }
      return false;
    case '>':
      for (
        let node = dom.firstElementChild(base);
        node !== null;
        node = dom.nextElementSibling(node)
      ) {
        if (matches(node, runtimeCache) &&
          matchRelativeFrom(steps, next, node, runtimeCache, dom)) {
          return true;
        }
      }
      return false;
    case '+': {
      const node = dom.nextElementSibling(base);
      return node !== null && matches(node, runtimeCache) &&
        matchRelativeFrom(steps, next, node, runtimeCache, dom);
    }
    case '~':
      for (
        let node = dom.nextElementSibling(base);
        node !== null;
        node = dom.nextElementSibling(node)
      ) {
        if (matches(node, runtimeCache) &&
          matchRelativeFrom(steps, next, node, runtimeCache, dom)) {
          return true;
        }
      }
      return false;
  }
}

function shadowRoot(node: Element, dom: DOMOperations): ShadowRoot | null {
  const root = dom.root(node);
  return dom.isShadowRoot(root) ? root : null;
}
