import { collectCompoundTests } from '../compile/emit-seedable';
import { nextDescendant } from '../compile/runtime';
import type { RuntimeCache } from '../compile/runtimeCache';
import type {
  CandidateElementPredicate, CandidateTest, CandidateSubjectPredicate, Combinator, ComplexPart, ComplexSelector, CompoundSelector, RelativeSelectorList, SelectorList,
  TriMatch,
} from '../parser/parser';
import { assertNever } from '../../shared/util';
import { SubjectKind } from '../constants';
import { getShadowTreeRoot } from '../../shared/dom';
import type { Snapshot } from '../snapshot';

export type Chain = ChainRelation[];

type ChainRelation = {
  combinator: ChainCombinator | null;
  left: ComplexPart;
  right: ComplexPart;
};

type ChainCombinator = Combinator;

export function buildChain(complex: ComplexSelector): Chain {
  const { parts } = complex;

  if (parts.length === 0) {
    throw new Error('Cannot build chain for empty complex selector');
  }

  const chain: Chain = [];
  const first = parts[0]!;
  chain[0] = {
    combinator: null,
    left: first,
    right: first,
  };

  for (let i = 1; i < parts.length; i++) {
    const left = parts[i - 1]!;
    const right = parts[i]!;
    const combinator = right.combinator;
    if (combinator === null) {
      throw new Error(`Missing combinator at part ${i}`);
    }

    chain[i] = {
      combinator,
      left,
      right,
    };
  }

  return chain;
}

export function buildStrictSelectorListTest(list: SelectorList, snap: Snapshot): CandidateElementPredicate {
  if (list.usesHost) {
    const test = buildStrictSelectorListSubjectTest(list, snap);
    return (candidate, rc) =>
      test(candidate, rc, SubjectKind.Element) === true;
  }
  return buildStrictSelectorListElementTest(list, snap);
}

export function buildStrictSelectorListElementTest(list: SelectorList, snap: Snapshot): CandidateElementPredicate {
  const proof = buildSelectorListElementProof(list, snap);
  return (candidate, rc) => proof(candidate, null, rc);
}

export function buildStrictSelectorListSubjectTest(list: SelectorList, snap: Snapshot): CandidateSubjectPredicate {
  const proof = buildSelectorListSubjectProof(list, snap);
  return (candidate, rc, kind) => proof(candidate, null, rc, kind);
}

export function buildForgivingSelectorListElementTest(list: SelectorList, snap: Snapshot): CandidateElementPredicate {
  if (list.arms.length === 0) return () => false;
  return buildStrictSelectorListElementTest(list, snap);
}

export function buildForgivingSelectorListSubjectTest(list: SelectorList, snap: Snapshot): CandidateSubjectPredicate {
  if (list.arms.length === 0) return () => false;
  return buildStrictSelectorListSubjectTest(list, snap);
}

export function buildRelativeSelectorListElementTest(list: RelativeSelectorList, snap: Snapshot): CandidateElementPredicate {
  if (list.arms.length === 0) return () => false;

  const arms: CandidateElementPredicate[] = list.arms.map((arm) => {
    const steps: HasStep[] = arm.steps.map((step) => {
      const test = buildCompoundElementTest(step.compound.compound, snap);
      return [step.combinator, test];
    });

    return (e, rc) => matchHasFrom(steps, 0, e, snap, rc);
  });

  if (arms.length === 1) return arms[0]!;

  return function relativeSelectorListElementTest(e, rc) {
    for (let i = 0; i < arms.length; i++) {
      const arm = arms[i]!;
      if (arm(e, rc)) return true;
    }

    return false;
  };
}

function buildStepElementTest(rel: ChainRelation, snap: Snapshot): CandidateElementPredicate {
  return buildCompoundElementTest(rel.right.compound, snap);
}

function buildStepSubjectTest(rel: ChainRelation, snap: Snapshot): CandidateSubjectPredicate {
  return buildCompoundSubjectTest(rel.right.compound, snap);
}

function buildCompoundElementTest(compound: CompoundSelector, snap: Snapshot): CandidateElementPredicate {
  const tests = collectCompoundTests(compound);

  const n = tests.length;
  if (n === 0) return () => true;
  if (n === 1) {
    const test = tests[0]!;
    return test.buildElement(snap);
  }

  tests.sort((a, b) => a.cost - b.cost);

  const predicates: CandidateElementPredicate[] = [];
  for (let i = 0; i < n; i++) {
    const test = tests[i]!;
    predicates[i] = test.buildElement(snap);
  }

  return function compoundTest(e, rc) {
    for (let i = 0; i < n; i++) {
      const predicate = predicates[i]!;
      if (!predicate(e, rc)) return false;
    }

    return true;
  };
}

export function buildCompoundSubjectTest(compound: CompoundSelector, snap: Snapshot): CandidateSubjectPredicate {
  const tests = collectCompoundTests(compound);

  const n = tests.length;
  if (n === 0) return () => true;
  if (n === 1) {
    const test = tests[0]!;
    return buildCandidateSubjectTest(test, snap);
  }

  tests.sort((a, b) => a.cost - b.cost);

  const predicates: CandidateSubjectPredicate[] = [];
  for (let i = 0; i < n; i++) {
    const test = tests[i]!;
    predicates[i] = buildCandidateSubjectTest(test, snap);
  }

  return function compoundSubjectTest(e, rc, kind) {
    let result: TriMatch = true;

    for (let i = 0; i < n; i++) {
      const predicate = predicates[i]!;
      result = subjectAnd(result, predicate(e, rc, kind));
      if (result === null) return null;
    }

    return result;
  };
}

function buildCandidateSubjectTest(test: CandidateTest, snap: Snapshot): CandidateSubjectPredicate {
  if (test.buildSubject) return test.buildSubject(snap);

  const pred = test.buildElement(snap);

  return (e, rc, kind) => {
    if (kind !== SubjectKind.Element) return null;
    return pred(e, rc);
  };
}

// -------------- PROOF -----------------

export type ElementProofFn =
  (candidate: Element, frontier: Element[] | null, rc: RuntimeCache | null) => boolean;

type SubjectProofFn =
  (candidate: Element, frontier: Element[] | null, rc: RuntimeCache | null, kind: SubjectKind) => TriMatch;

function buildStepElementProof(rel: ChainRelation, snap: Snapshot): ElementProofFn {
  const test = buildStepElementTest(rel, snap);

  return function proof(candidate, _frontier, rc) {
    return test(candidate, rc);
  };
}

function buildStepSubjectProof(rel: ChainRelation, snap: Snapshot): SubjectProofFn {
  const test = buildStepSubjectTest(rel, snap);

  return function proof(candidate, _frontier, rc, kind) {
    return test(candidate, rc, kind);
  };
}

export function buildChainProof(chain: Chain, from: number, to: number, snap: Snapshot): ElementProofFn {
  if (!chainRangeNeedsSubjectProof(chain, from, to)) {
    return buildElementProof(chain, from, to, snap);
  }

  const proof = buildSubjectProof(chain, from, to, snap);

  return (candidate, frontier, rc) =>
    proof(candidate, frontier, rc, SubjectKind.Element) === true;
}

function chainRangeNeedsSubjectProof(chain: Chain, from: number, to: number): boolean {
  for (let i = from + 1; i <= to; i++) {
    const relation = chain[i]!;
    if (relation.right.compound.usesHost) return true;
  }
  return false;
}

function buildElementProof(chain: Chain, from: number, to: number, snap: Snapshot): ElementProofFn {
  if (from < -1 || to < 0 || to >= chain.length || to <= from) {
    throw new Error(`Invalid proof range: ${from} ➝ ${to}`);
  }

  const start = from + 1;
  const startRelation = chain[start]!;
  let proof: ElementProofFn = buildStepElementProof(startRelation, snap);

  if (from >= 0) {
    const prev = proof;
    const connect = buildElementConnectionToFrontier(startRelation);

    proof = function proof(candidate, frontier, rc) {
      return prev(candidate, frontier, rc) && connect(candidate, frontier, rc);
    };
  }

  for (let i = start + 1; i <= to; i++) {
    const relation = chain[i]!;
    const step = buildStepElementTest(relation, snap);
    const prev = proof;
    const connect = extendElementProof(relation, prev, snap);

    proof = function proof(candidate, frontier, rc) {
      return step(candidate, rc) && connect(candidate, frontier, rc);
    };
  }

  return proof;
}

function buildSubjectProof(chain: Chain, from: number, to: number, snap: Snapshot): SubjectProofFn {
  if (from < -1 || to < 0 || to >= chain.length || to <= from) {
    throw new Error(`Invalid proof range: ${from} ➝ ${to}`);
  }

  const start = from + 1;
  const startRelation = chain[start]!;
  let proof: SubjectProofFn = buildStepSubjectProof(startRelation, snap);

  if (from >= 0) {
    const prev = proof;
    const connect = buildSubjectConnectionToFrontier(startRelation);

    proof = function proof(candidate, frontier, rc, kind) {
      return subjectAnd(
        prev(candidate, frontier, rc, kind),
        connect(candidate, frontier, rc, kind),
      );
    };
  }

  for (let i = start + 1; i <= to; i++) {
    const relation = chain[i]!;
    const step = buildStepSubjectTest(relation, snap);
    const prev = proof;
    const connect = extendSubjectProof(relation, prev);

    proof = function proof(candidate, frontier, rc, kind) {
      return subjectAnd(
        step(candidate, rc, kind),
        connect(candidate, frontier, rc, kind),
      );
    };
  }

  return proof;
}

function buildFullElementProof(chain: Chain, snap: Snapshot): ElementProofFn {
  return buildElementProof(chain, -1, chain.length - 1, snap);
}

function buildFullSubjectProof(chain: Chain, snap: Snapshot): SubjectProofFn {
  return buildSubjectProof(chain, -1, chain.length - 1, snap);
}

export function buildMultiChainProof(chains: Chain[], snap: Snapshot): ElementProofFn {
  if (!multiChainNeedsSubject(chains)) {
    return buildMultiChainElementProof(chains, snap);
  }

  const proof = buildMultiChainSubjectProof(chains, snap);

  return (candidate, frontier, rc) =>
    proof(candidate, frontier, rc, SubjectKind.Element) === true;
}

function multiChainNeedsSubject(chains: Chain[]): boolean {
  for (let i = 0; i < chains.length; i++) {
    const chain = chains[i]!;
    for (let j = 0; j < chain.length; j++) {
      const relation = chain[j]!;
      if (relation.right.compound.usesHost) return true;
    }
  }
  return false;
}

function buildMultiChainElementProof(chains: Chain[], snap: Snapshot): ElementProofFn {
  if (chains.length === 0) {
    throw new Error('Cannot build multi-chain proof for empty chain list');
  }

  if (chains.length === 1) {
    const chain = chains[0]!;
    return buildFullElementProof(chain, snap);
  }

  const proofs: ElementProofFn[] = [];
  for (let i = 0; i < chains.length; i++) {
    const chain = chains[i]!;
    proofs[i] = buildFullElementProof(chain, snap);
  }

  return function proof(candidate, frontier, rc) {
    for (let i = 0; i < proofs.length; i++) {
      const proof = proofs[i]!;
      if (proof(candidate, frontier, rc)) return true;
    }

    return false;
  };
}

function buildMultiChainSubjectProof(chains: Chain[], snap: Snapshot): SubjectProofFn {
  if (chains.length === 0) {
    throw new Error('Cannot build multi-chain proof for empty chain list');
  }

  if (chains.length === 1) {
    const chain = chains[0]!;
    return buildFullSubjectProof(chain, snap);
  }

  const proofs: SubjectProofFn[] = [];
  for (let i = 0; i < chains.length; i++) {
    const chain = chains[i]!;
    proofs[i] = buildFullSubjectProof(chain, snap);
  }

  return function proof(candidate, frontier, rc, kind) {
    let result: TriMatch = null;

    for (let i = 0; i < proofs.length; i++) {
      const proof = proofs[i]!;
      const r = proof(candidate, frontier, rc, kind);
      if (r === true) return true;
      result = subjectOr(result, r);
    }

    return result;
  };
}

function buildSelectorListElementProof(list: SelectorList, snap: Snapshot): ElementProofFn {
  const arms = list.arms;

  if (arms.length === 0) {
    throw new Error('Cannot build selector list proof for empty selector list');
  }

  if (arms.length === 1) {
    const arm = arms[0]!;
    return buildFullElementProof(buildChain(arm), snap);
  }

  arms.sort((a, b) => a.cost - b.cost);

  const chains: Chain[] = [];
  for (let i = 0; i < arms.length; i++) {
    const arm = arms[i]!;
    chains[i] = buildChain(arm);
  }

  return buildMultiChainElementProof(chains, snap);
}

function buildSelectorListSubjectProof(list: SelectorList, snap: Snapshot): SubjectProofFn {
  const arms = list.arms;

  if (arms.length === 0) {
    throw new Error('Cannot build selector list proof for empty selector list');
  }

  if (arms.length === 1) {
    const arm = arms[0]!;
    return buildFullSubjectProof(buildChain(arm), snap);
  }

  arms.sort((a, b) => a.cost - b.cost);

  const proofs: SubjectProofFn[] = [];
  for (let i = 0; i < arms.length; i++) {
    const arm = arms[i]!;
    proofs[i] = buildFullSubjectProof(buildChain(arm), snap);
  }

  return function selectorListSubjectProof(candidate, frontier, rc, kind) {
    let result: TriMatch = null;

    for (let i = 0; i < proofs.length; i++) {
      const proof = proofs[i]!;
      const r = proof(candidate, frontier, rc, kind);
      if (r === true) return true;
      result = subjectOr(result, r);
    }

    return result;
  };
}

function buildElementConnectionToFrontier(rel: ChainRelation): ElementProofFn {
  switch (rel.combinator) {
    case ' ': return buildAncestorInFrontierElementProof();
    case '>': return buildParentInFrontierElementProof();
    case '+': return buildPrevInFrontierElementProof();
    case '~': return buildPrevAnyInFrontierElementProof();

    case null:
      throw new Error('Cannot connect chain start relation to frontier.');

    default:
      return assertNever(rel.combinator);
  }
}

function buildSubjectConnectionToFrontier(rel: ChainRelation): SubjectProofFn {
  switch (rel.combinator) {
    case ' ': return buildAncestorInFrontierSubjectProof();
    case '>': return buildParentInFrontierSubjectProof();
    case '+': return buildPrevInFrontierSubjectProof();
    case '~': return buildPrevAnyInFrontierSubjectProof();

    case null:
      throw new Error('Cannot connect chain start relation to frontier.');

    default:
      return assertNever(rel.combinator);
  }
}

function buildAncestorInFrontierElementProof(): ElementProofFn {
  return function proof(candidate, frontier) {
    for (let p = candidate.parentElement; p; p = p.parentElement) {
      if (inFrontier(p, frontier)) return true;
    }

    return false;
  };
}

function buildAncestorInFrontierSubjectProof(): SubjectProofFn {
  return function proof(candidate, frontier, _rc, kind) {
    if (kind !== SubjectKind.Element) return false;

    for (let p = candidate.parentElement; p; p = p.parentElement) {
      if (inFrontier(p, frontier)) return true;
    }

    return false;
  };
}

function buildParentInFrontierElementProof(): ElementProofFn {
  return function proof(candidate, frontier) {
    const p = candidate.parentElement;
    return p !== null && inFrontier(p, frontier);
  };
}

function buildParentInFrontierSubjectProof(): SubjectProofFn {
  return function proof(candidate, frontier, _rc, kind) {
    if (kind !== SubjectKind.Element) return false;

    const p = candidate.parentElement;
    return p !== null && inFrontier(p, frontier);
  };
}

function buildPrevInFrontierElementProof(): ElementProofFn {
  return function proof(candidate, frontier) {
    const p = candidate.previousElementSibling;
    return p !== null && inFrontier(p, frontier);
  };
}

function buildPrevInFrontierSubjectProof(): SubjectProofFn {
  return function proof(candidate, frontier, _rc, kind) {
    if (kind !== SubjectKind.Element) return false;

    const p = candidate.previousElementSibling;
    return p !== null && inFrontier(p, frontier);
  };
}

function buildPrevAnyInFrontierElementProof(): ElementProofFn {
  return function proof(candidate, frontier) {
    for (let p = candidate.previousElementSibling; p; p = p.previousElementSibling) {
      if (inFrontier(p, frontier)) return true;
    }

    return false;
  };
}

function buildPrevAnyInFrontierSubjectProof(): SubjectProofFn {
  return function proof(candidate, frontier, _rc, kind) {
    if (kind !== SubjectKind.Element) return false;

    for (let p = candidate.previousElementSibling; p; p = p.previousElementSibling) {
      if (inFrontier(p, frontier)) return true;
    }

    return false;
  };
}

function inFrontier(e: Element, frontier: Element[] | null): boolean {
  if (!frontier) return false;

  for (let i = 0; i < frontier.length; i++) {
    if (frontier[i] === e) return true;
  }

  return false;
}

function extendElementProof(rel: ChainRelation, prev: ElementProofFn, _snap: Snapshot): ElementProofFn {
  switch (rel.combinator) {
    case ' ': return buildAncestorElementProof(prev);
    case '>': return buildParentElementProof(prev);
    case '+': return buildPrevElementProof(prev);
    case '~': return buildPrevAnyElementProof(prev);

    case null:
      throw new Error('Cannot extend proof from chain start relation.');

    default:
      return assertNever(rel.combinator);
  }
}

function extendSubjectProof(rel: ChainRelation, prev: SubjectProofFn): SubjectProofFn {
  switch (rel.combinator) {
    case ' ': return buildAncestorSubjectProof(prev);
    case '>': return buildParentSubjectProof(prev);
    case '+': return buildPrevSubjectProof(prev);
    case '~': return buildPrevAnySubjectProof(prev);

    case null:
      throw new Error('Cannot extend proof from chain start relation.');

    default:
      return assertNever(rel.combinator);
  }
}

function buildAncestorElementProof(prev: ElementProofFn): ElementProofFn {
  return function proof(candidate, frontier, rc) {
    for (let p = candidate.parentElement; p; p = p.parentElement) {
      if (prev(p, frontier, rc)) return true;
    }

    return false;
  };
}

function buildAncestorSubjectProof(prev: SubjectProofFn): SubjectProofFn {
  return function proof(candidate, frontier, rc, kind) {
    if (kind !== SubjectKind.Element) return false;

    let result: TriMatch | undefined;

    for (let p = candidate.parentElement; p; p = p.parentElement) {
      const r = prev(p, frontier, rc, SubjectKind.Element);
      if (r === true) return true;
      result = result === undefined ? r : subjectOr(result, r);
    }

    const root = getShadowTreeRoot(candidate);
    if (root) {
      const r = prev(root.host, frontier, rc, SubjectKind.HostElement);
      if (r === true) return true;
      result = result === undefined ? r : subjectOr(result, r);
    }

    return result === undefined ? false : result;
  };
}

function buildParentElementProof(prev: ElementProofFn): ElementProofFn {
  return function proof(candidate, frontier, rc) {
    const p = candidate.parentElement;
    return p !== null && prev(p, frontier, rc);
  };
}

function buildParentSubjectProof(prev: SubjectProofFn): SubjectProofFn {
  return function proof(candidate, frontier, rc, kind) {
    if (kind !== SubjectKind.Element) return false;

    let result: TriMatch | undefined;

    const p = candidate.parentElement;
    if (p) {
      const r = prev(p, frontier, rc, SubjectKind.Element);
      if (r === true) return true;
      result = r;
    }

    const root = getShadowTreeRoot(candidate);
    if (root && candidate.parentNode === root) {
      const r = prev(root.host, frontier, rc, SubjectKind.HostElement);
      if (r === true) return true;
      result = result === undefined ? r : subjectOr(result, r);
    }

    return result === undefined ? false : result;
  };
}

function buildPrevElementProof(prev: ElementProofFn): ElementProofFn {
  return function proof(candidate, frontier, rc) {
    const p = candidate.previousElementSibling;
    return p !== null && prev(p, frontier, rc);
  };
}

function buildPrevSubjectProof(prev: SubjectProofFn): SubjectProofFn {
  return function proof(candidate, frontier, rc, kind) {
    if (kind !== SubjectKind.Element) return false;

    const p = candidate.previousElementSibling;
    if (!p) return false;

    return prev(p, frontier, rc, SubjectKind.Element);
  };
}

function buildPrevAnyElementProof(prev: ElementProofFn): ElementProofFn {
  return function proof(candidate, frontier, rc) {
    for (let p = candidate.previousElementSibling; p; p = p.previousElementSibling) {
      if (prev(p, frontier, rc)) return true;
    }

    return false;
  };
}

function buildPrevAnySubjectProof(prev: SubjectProofFn): SubjectProofFn {
  return function proof(candidate, frontier, rc, kind) {
    if (kind !== SubjectKind.Element) return false;

    let result: TriMatch | undefined;
    for (let p = candidate.previousElementSibling; p; p = p.previousElementSibling) {
      const r = prev(p, frontier, rc, SubjectKind.Element);
      if (r === true) return true;
      result = result === undefined ? r : subjectOr(result, r);
    }

    return result === undefined ? false : result;
  };
}

function subjectAnd(a: TriMatch, b: TriMatch): TriMatch {
  if (a === null || b === null) return null;
  if (a === false || b === false) return false;
  return true;
}

function subjectOr(a: TriMatch, b: TriMatch): TriMatch {
  if (a === true || b === true) return true;
  if (a === false || b === false) return false;
  return null;
}

// -------------- ADVANCE MOVES -----------------

export type AdvanceMove = {
  combinator: AdvanceCombinator;
  from: number;
  to: number;
  run: AdvanceFn;
  test: CandidateElementPredicate;
  first?: AdvanceFirstFn;
  debug?: string;
};

type AdvanceCombinator = '>' | '+' | '~';

type AdvanceFn = (frontier: Element[], rc: RuntimeCache | null) => Element[];
type AdvanceFirstFn = (frontier: Element[], rc: RuntimeCache | null) => Element | null;

export function buildAdvanceMove(chain: Chain, from: number, snap: Snapshot): AdvanceMove | null {
  const to = from + 1;
  if (to >= chain.length) return null;
  const fromRelation = chain[from]!;
  if (fromRelation.right.compound.usesHost) return null;

  const rel = chain[to]!;
  const { combinator } = rel;

  if (combinator === null) {
    throw new Error(`Missing combinator at chain relation ${to} in frontier advance move`);
  }

  if (combinator !== '>' && combinator !== '+' && combinator !== '~') {
    return null;
  }

  const test = buildStepElementTest(rel, snap);
  const run = buildAdvanceFn(combinator, test);

  const move: AdvanceMove = { from, to, run, combinator, test };

  return move;
}

function buildAdvanceFn(combinator: AdvanceCombinator, test: CandidateElementPredicate): AdvanceFn {
  switch (combinator) {
    case '>': return (frontier, rc) => advanceChildren(frontier, test, rc);
    case '+': return (frontier, rc) => advanceNextSibling(frontier, test, rc);
    case '~': return (frontier, rc) => advanceFollowingSiblings(frontier, test, rc);
  }
}

function advanceNextSibling(frontier: Element[], test: CandidateElementPredicate, rc: RuntimeCache | null): Element[] {
  const out: Element[] = [];
  let j = -1;

  for (let i = 0; i < frontier.length; i++) {
    const base = frontier[i]!;
    const candidate = base.nextElementSibling;
    if (candidate && test(candidate, rc)) out[++j] = candidate;
  }

  return out;
}

function advanceFollowingSiblings(frontier: Element[], test: CandidateElementPredicate, rc: RuntimeCache | null): Element[] {
  const out: Element[] = [];
  const seen = new Set<Element>();

  for (let i = 0; i < frontier.length; i++) {
    const base = frontier[i]!;
    for (let candidate = base.nextElementSibling; candidate; candidate = candidate.nextElementSibling) {
      if (!seen.has(candidate) && test(candidate, rc)) {
        seen.add(candidate);
        out[out.length] = candidate;
      }
    }
  }

  return out;
}

function advanceChildren(frontier: Element[], test: CandidateElementPredicate, rc: RuntimeCache | null): Element[] {
  const out: Element[] = [];
  let j = -1;

  for (let i = 0; i < frontier.length; i++) {
    const base = frontier[i]!;
    for (let candidate = base.firstElementChild; candidate; candidate = candidate.nextElementSibling) {
      if (test(candidate, rc)) out[++j] = candidate;
    }
  }

  return out;
}

export function buildAdvanceFirstFn(combinator: AdvanceCombinator, test: CandidateElementPredicate): AdvanceFirstFn {
  switch (combinator) {
    case '>': return (frontier, rc) => firstChild(frontier, test, rc);
    case '+': return (frontier, rc) => firstNextSibling(frontier, test, rc);
    case '~': return (frontier, rc) => firstFollowingSibling(frontier, test, rc);
  }
}

function firstNextSibling(frontier: Element[], test: CandidateElementPredicate, rc: RuntimeCache | null): Element | null {
  for (let i = 0; i < frontier.length; i++) {
    const base = frontier[i]!;
    const candidate = base.nextElementSibling;
    if (candidate && test(candidate, rc)) return candidate;
  }

  return null;
}

function firstFollowingSibling(frontier: Element[], test: CandidateElementPredicate, rc: RuntimeCache | null): Element | null {
  for (let i = 0; i < frontier.length; i++) {
    const base = frontier[i]!;
    for (let candidate = base.nextElementSibling; candidate; candidate = candidate.nextElementSibling) {
      if (test(candidate, rc)) return candidate;
    }
  }

  return null;
}

function firstChild(frontier: Element[], test: CandidateElementPredicate, rc: RuntimeCache | null): Element | null {
  for (let i = 0; i < frontier.length; i++) {
    const base = frontier[i]!;
    for (let candidate = base.firstElementChild; candidate; candidate = candidate.nextElementSibling) {
      if (test(candidate, rc)) return candidate;
    }
  }

  return null;
}

type SelectorCombinator = ' ' | '>' | '+' | '~';
type HasStep = [SelectorCombinator, (e: Element, rc: RuntimeCache | null) => boolean];
function matchHasFrom(
  steps: HasStep[],
  index: number,
  base: Element,
  snap: Snapshot,
  rc: RuntimeCache | null,
): boolean {
  if (index >= steps.length) return true;

  const step = steps[index]!;
  const [combinator, test] = step;
  const next = index + 1;

  switch (combinator) {
    case ' ':
      for (let node = base.firstElementChild; node; node = nextDescendant(base, node)) {
        if (test(node, rc) && matchHasFrom(steps, next, node, snap, rc)) return true;
      }
      return false;

    case '>':
      for (let node = base.firstElementChild; node; node = node.nextElementSibling) {
        if (test(node, rc) && matchHasFrom(steps, next, node, snap, rc)) return true;
      }
      return false;

    case '+': {
      const node = base.nextElementSibling;
      return !!node && test(node, rc) && matchHasFrom(steps, next, node, snap, rc);
    }

    case '~':
      for (let node = base.nextElementSibling; node; node = node.nextElementSibling) {
        if (test(node, rc) && matchHasFrom(steps, next, node, snap, rc)) return true;
      }
      return false;
  }
}
