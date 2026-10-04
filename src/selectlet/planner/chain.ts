import type { DOMOperations, DOMElement as Element, DOMShadowRoot as ShadowRoot } from '../../infra/index';
import { collectCompoundTests } from '../compile/emit-seedable';
import { nextDescendant } from '../compile/runtime';
import type { RuntimeCache } from '../compile/runtimeCache';
import type {
  CandidateElementPredicate, CandidateTest, CandidateSubjectPredicate, Combinator, ComplexPart, ComplexSelector, CompoundSelector, RelativeSelectorList, SelectorList,
  TriMatch,
} from '../parser/parser';
import { assertNever } from '../../infra/util';
import { SubjectKind } from '../constants';
import type { SelectletContext } from '../context';

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

export function buildStrictSelectorListTest(list: SelectorList, ctx: SelectletContext): CandidateElementPredicate {
  if (list.usesHost) {
    const test = buildStrictSelectorListSubjectTest(list, ctx);
    return (candidate, rc) =>
      test(candidate, rc, SubjectKind.Element) === true;
  }
  return buildStrictSelectorListElementTest(list, ctx);
}

export function buildStrictSelectorListElementTest(list: SelectorList, ctx: SelectletContext): CandidateElementPredicate {
  const proof = buildSelectorListElementProof(list, ctx);
  return (candidate, rc) => proof(candidate, null, rc);
}

export function buildStrictSelectorListSubjectTest(list: SelectorList, ctx: SelectletContext): CandidateSubjectPredicate {
  const proof = buildSelectorListSubjectProof(list, ctx);
  return (candidate, rc, kind) => proof(candidate, null, rc, kind);
}

export function buildForgivingSelectorListElementTest(list: SelectorList, ctx: SelectletContext): CandidateElementPredicate {
  if (list.arms.length === 0) return () => false;
  return buildStrictSelectorListElementTest(list, ctx);
}

export function buildForgivingSelectorListSubjectTest(list: SelectorList, ctx: SelectletContext): CandidateSubjectPredicate {
  if (list.arms.length === 0) return () => false;
  return buildStrictSelectorListSubjectTest(list, ctx);
}

export function buildRelativeSelectorListElementTest(list: RelativeSelectorList, ctx: SelectletContext): CandidateElementPredicate {
  if (list.arms.length === 0) return () => false;

  const arms: CandidateElementPredicate[] = list.arms.map((arm) => {
    const steps: HasStep[] = arm.steps.map((step) => {
      const test = buildCompoundElementTest(step.compound.compound, ctx);
      return [step.combinator, test];
    });

    return (e, rc) => matchHasFrom(steps, 0, e, ctx, rc);
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

function buildStepElementTest(rel: ChainRelation, ctx: SelectletContext): CandidateElementPredicate {
  return buildCompoundElementTest(rel.right.compound, ctx);
}

function buildStepSubjectTest(rel: ChainRelation, ctx: SelectletContext): CandidateSubjectPredicate {
  return buildCompoundSubjectTest(rel.right.compound, ctx);
}

function buildCompoundElementTest(compound: CompoundSelector, ctx: SelectletContext): CandidateElementPredicate {
  const tests = collectCompoundTests(compound);

  const n = tests.length;
  if (n === 0) return () => true;
  if (n === 1) {
    const test = tests[0]!;
    return test.buildElement(ctx);
  }

  tests.sort((a, b) => a.cost - b.cost);

  const predicates: CandidateElementPredicate[] = [];
  for (let i = 0; i < n; i++) {
    const test = tests[i]!;
    predicates[i] = test.buildElement(ctx);
  }

  return function compoundTest(e, rc) {
    for (let i = 0; i < n; i++) {
      const predicate = predicates[i]!;
      if (!predicate(e, rc)) return false;
    }

    return true;
  };
}

export function buildCompoundSubjectTest(compound: CompoundSelector, ctx: SelectletContext): CandidateSubjectPredicate {
  const tests = collectCompoundTests(compound);

  const n = tests.length;
  if (n === 0) return () => true;
  if (n === 1) {
    const test = tests[0]!;
    return buildCandidateSubjectTest(test, ctx);
  }

  tests.sort((a, b) => a.cost - b.cost);

  const predicates: CandidateSubjectPredicate[] = [];
  for (let i = 0; i < n; i++) {
    const test = tests[i]!;
    predicates[i] = buildCandidateSubjectTest(test, ctx);
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

function buildCandidateSubjectTest(test: CandidateTest, ctx: SelectletContext): CandidateSubjectPredicate {
  if (test.buildSubject) return test.buildSubject(ctx);

  const pred = test.buildElement(ctx);

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

function buildStepElementProof(rel: ChainRelation, ctx: SelectletContext): ElementProofFn {
  const test = buildStepElementTest(rel, ctx);

  return function proof(candidate, _frontier, rc) {
    return test(candidate, rc);
  };
}

function buildStepSubjectProof(rel: ChainRelation, ctx: SelectletContext): SubjectProofFn {
  const test = buildStepSubjectTest(rel, ctx);

  return function proof(candidate, _frontier, rc, kind) {
    return test(candidate, rc, kind);
  };
}

export function buildChainProof(chain: Chain, from: number, to: number, ctx: SelectletContext): ElementProofFn {
  if (!chainRangeNeedsSubjectProof(chain, from, to)) {
    return buildElementProof(chain, from, to, ctx);
  }

  const proof = buildSubjectProof(chain, from, to, ctx);

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

function buildElementProof(chain: Chain, from: number, to: number, ctx: SelectletContext): ElementProofFn {
  if (from < -1 || to < 0 || to >= chain.length || to <= from) {
    throw new Error(`Invalid proof range: ${from} ➝ ${to}`);
  }

  const start = from + 1;
  const startRelation = chain[start]!;
  let proof: ElementProofFn = buildStepElementProof(startRelation, ctx);

  if (from >= 0) {
    const prev = proof;
    const connect = buildElementConnectionToFrontier(startRelation, ctx.dom);

    proof = function proof(candidate, frontier, rc) {
      return prev(candidate, frontier, rc) && connect(candidate, frontier, rc);
    };
  }

  for (let i = start + 1; i <= to; i++) {
    const relation = chain[i]!;
    const step = buildStepElementTest(relation, ctx);
    const prev = proof;
    const connect = extendElementProof(relation, prev, ctx);

    proof = function proof(candidate, frontier, rc) {
      return step(candidate, rc) && connect(candidate, frontier, rc);
    };
  }

  return proof;
}

function buildSubjectProof(chain: Chain, from: number, to: number, ctx: SelectletContext): SubjectProofFn {
  if (from < -1 || to < 0 || to >= chain.length || to <= from) {
    throw new Error(`Invalid proof range: ${from} ➝ ${to}`);
  }

  const start = from + 1;
  const startRelation = chain[start]!;
  let proof: SubjectProofFn = buildStepSubjectProof(startRelation, ctx);

  if (from >= 0) {
    const prev = proof;
    const connect = buildSubjectConnectionToFrontier(startRelation, ctx.dom);

    proof = function proof(candidate, frontier, rc, kind) {
      return subjectAnd(
        prev(candidate, frontier, rc, kind),
        connect(candidate, frontier, rc, kind),
      );
    };
  }

  for (let i = start + 1; i <= to; i++) {
    const relation = chain[i]!;
    const step = buildStepSubjectTest(relation, ctx);
    const prev = proof;
    const connect = extendSubjectProof(relation, prev, ctx.dom);

    proof = function proof(candidate, frontier, rc, kind) {
      return subjectAnd(
        step(candidate, rc, kind),
        connect(candidate, frontier, rc, kind),
      );
    };
  }

  return proof;
}

function buildFullElementProof(chain: Chain, ctx: SelectletContext): ElementProofFn {
  return buildElementProof(chain, -1, chain.length - 1, ctx);
}

function buildFullSubjectProof(chain: Chain, ctx: SelectletContext): SubjectProofFn {
  return buildSubjectProof(chain, -1, chain.length - 1, ctx);
}

export function buildMultiChainProof(chains: Chain[], ctx: SelectletContext): ElementProofFn {
  if (!multiChainNeedsSubject(chains)) {
    return buildMultiChainElementProof(chains, ctx);
  }

  const proof = buildMultiChainSubjectProof(chains, ctx);

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

function buildMultiChainElementProof(chains: Chain[], ctx: SelectletContext): ElementProofFn {
  if (chains.length === 0) {
    throw new Error('Cannot build multi-chain proof for empty chain list');
  }

  if (chains.length === 1) {
    const chain = chains[0]!;
    return buildFullElementProof(chain, ctx);
  }

  const proofs: ElementProofFn[] = [];
  for (let i = 0; i < chains.length; i++) {
    const chain = chains[i]!;
    proofs[i] = buildFullElementProof(chain, ctx);
  }

  return function proof(candidate, frontier, rc) {
    for (let i = 0; i < proofs.length; i++) {
      const proof = proofs[i]!;
      if (proof(candidate, frontier, rc)) return true;
    }

    return false;
  };
}

function buildMultiChainSubjectProof(chains: Chain[], ctx: SelectletContext): SubjectProofFn {
  if (chains.length === 0) {
    throw new Error('Cannot build multi-chain proof for empty chain list');
  }

  if (chains.length === 1) {
    const chain = chains[0]!;
    return buildFullSubjectProof(chain, ctx);
  }

  const proofs: SubjectProofFn[] = [];
  for (let i = 0; i < chains.length; i++) {
    const chain = chains[i]!;
    proofs[i] = buildFullSubjectProof(chain, ctx);
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

function buildSelectorListElementProof(list: SelectorList, ctx: SelectletContext): ElementProofFn {
  const arms = list.arms;

  if (arms.length === 0) {
    throw new Error('Cannot build selector list proof for empty selector list');
  }

  if (arms.length === 1) {
    const arm = arms[0]!;
    return buildFullElementProof(buildChain(arm), ctx);
  }

  arms.sort((a, b) => a.cost - b.cost);

  const chains: Chain[] = [];
  for (let i = 0; i < arms.length; i++) {
    const arm = arms[i]!;
    chains[i] = buildChain(arm);
  }

  return buildMultiChainElementProof(chains, ctx);
}

function buildSelectorListSubjectProof(list: SelectorList, ctx: SelectletContext): SubjectProofFn {
  const arms = list.arms;

  if (arms.length === 0) {
    throw new Error('Cannot build selector list proof for empty selector list');
  }

  if (arms.length === 1) {
    const arm = arms[0]!;
    return buildFullSubjectProof(buildChain(arm), ctx);
  }

  arms.sort((a, b) => a.cost - b.cost);

  const proofs: SubjectProofFn[] = [];
  for (let i = 0; i < arms.length; i++) {
    const arm = arms[i]!;
    proofs[i] = buildFullSubjectProof(buildChain(arm), ctx);
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

function buildElementConnectionToFrontier(rel: ChainRelation, dom: DOMOperations): ElementProofFn {
  switch (rel.combinator) {
    case ' ': return buildAncestorInFrontierElementProof(dom);
    case '>': return buildParentInFrontierElementProof(dom);
    case '+': return buildPrevInFrontierElementProof(dom);
    case '~': return buildPrevAnyInFrontierElementProof(dom);

    case null:
      throw new Error('Cannot connect chain start relation to frontier.');

    default:
      return assertNever(rel.combinator);
  }
}

function buildSubjectConnectionToFrontier(rel: ChainRelation, dom: DOMOperations): SubjectProofFn {
  switch (rel.combinator) {
    case ' ': return buildAncestorInFrontierSubjectProof(dom);
    case '>': return buildParentInFrontierSubjectProof(dom);
    case '+': return buildPrevInFrontierSubjectProof(dom);
    case '~': return buildPrevAnyInFrontierSubjectProof(dom);

    case null:
      throw new Error('Cannot connect chain start relation to frontier.');

    default:
      return assertNever(rel.combinator);
  }
}

function buildAncestorInFrontierElementProof(dom: DOMOperations): ElementProofFn {
  return function proof(candidate, frontier) {
    for (let p = dom.parentElement(candidate); p; p = dom.parentElement(p)) {
      if (inFrontier(p, frontier)) return true;
    }

    return false;
  };
}

function buildAncestorInFrontierSubjectProof(dom: DOMOperations): SubjectProofFn {
  return function proof(candidate, frontier, _rc, kind) {
    if (kind !== SubjectKind.Element) return false;

    for (let p = dom.parentElement(candidate); p; p = dom.parentElement(p)) {
      if (inFrontier(p, frontier)) return true;
    }

    return false;
  };
}

function buildParentInFrontierElementProof(dom: DOMOperations): ElementProofFn {
  return function proof(candidate, frontier) {
    const p = dom.parentElement(candidate);
    return p !== null && inFrontier(p, frontier);
  };
}

function buildParentInFrontierSubjectProof(dom: DOMOperations): SubjectProofFn {
  return function proof(candidate, frontier, _rc, kind) {
    if (kind !== SubjectKind.Element) return false;

    const p = dom.parentElement(candidate);
    return p !== null && inFrontier(p, frontier);
  };
}

function buildPrevInFrontierElementProof(dom: DOMOperations): ElementProofFn {
  return function proof(candidate, frontier) {
    const p = dom.previousElementSibling(candidate);
    return p !== null && inFrontier(p, frontier);
  };
}

function buildPrevInFrontierSubjectProof(dom: DOMOperations): SubjectProofFn {
  return function proof(candidate, frontier, _rc, kind) {
    if (kind !== SubjectKind.Element) return false;

    const p = dom.previousElementSibling(candidate);
    return p !== null && inFrontier(p, frontier);
  };
}

function buildPrevAnyInFrontierElementProof(dom: DOMOperations): ElementProofFn {
  return function proof(candidate, frontier) {
    for (let p = dom.previousElementSibling(candidate); p; p = dom.previousElementSibling(p)) {
      if (inFrontier(p, frontier)) return true;
    }

    return false;
  };
}

function buildPrevAnyInFrontierSubjectProof(dom: DOMOperations): SubjectProofFn {
  return function proof(candidate, frontier, _rc, kind) {
    if (kind !== SubjectKind.Element) return false;

    for (let p = dom.previousElementSibling(candidate); p; p = dom.previousElementSibling(p)) {
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

function extendElementProof(rel: ChainRelation, prev: ElementProofFn, ctx: SelectletContext): ElementProofFn {
  switch (rel.combinator) {
    case ' ': return buildAncestorElementProof(prev, ctx.dom);
    case '>': return buildParentElementProof(prev, ctx.dom);
    case '+': return buildPrevElementProof(prev, ctx.dom);
    case '~': return buildPrevAnyElementProof(prev, ctx.dom);

    case null:
      throw new Error('Cannot extend proof from chain start relation.');

    default:
      return assertNever(rel.combinator);
  }
}

function extendSubjectProof(rel: ChainRelation, prev: SubjectProofFn, dom: DOMOperations): SubjectProofFn {
  switch (rel.combinator) {
    case ' ': return buildAncestorSubjectProof(prev, dom);
    case '>': return buildParentSubjectProof(prev, dom);
    case '+': return buildPrevSubjectProof(prev, dom);
    case '~': return buildPrevAnySubjectProof(prev, dom);

    case null:
      throw new Error('Cannot extend proof from chain start relation.');

    default:
      return assertNever(rel.combinator);
  }
}

function buildAncestorElementProof(prev: ElementProofFn, dom: DOMOperations): ElementProofFn {
  return function proof(candidate, frontier, rc) {
    for (let p = dom.parentElement(candidate); p; p = dom.parentElement(p)) {
      if (prev(p, frontier, rc)) return true;
    }

    return false;
  };
}

function buildAncestorSubjectProof(prev: SubjectProofFn, dom: DOMOperations): SubjectProofFn {
  return function proof(candidate, frontier, rc, kind) {
    if (kind !== SubjectKind.Element) return false;

    let result: TriMatch | undefined;

    for (let p = dom.parentElement(candidate); p; p = dom.parentElement(p)) {
      const r = prev(p, frontier, rc, SubjectKind.Element);
      if (r === true) return true;
      result = result === undefined ? r : subjectOr(result, r);
    }

    const root = shadowRoot(candidate, dom);
    if (root) {
      const r = prev(dom.shadowHost(root), frontier, rc, SubjectKind.HostElement);
      if (r === true) return true;
      result = result === undefined ? r : subjectOr(result, r);
    }

    return result === undefined ? false : result;
  };
}

function buildParentElementProof(prev: ElementProofFn, dom: DOMOperations): ElementProofFn {
  return function proof(candidate, frontier, rc) {
    const p = dom.parentElement(candidate);
    return p !== null && prev(p, frontier, rc);
  };
}

function buildParentSubjectProof(prev: SubjectProofFn, dom: DOMOperations): SubjectProofFn {
  return function proof(candidate, frontier, rc, kind) {
    if (kind !== SubjectKind.Element) return false;

    let result: TriMatch | undefined;

    const p = dom.parentElement(candidate);
    if (p) {
      const r = prev(p, frontier, rc, SubjectKind.Element);
      if (r === true) return true;
      result = r;
    }

    const root = shadowRoot(candidate, dom);
    if (root && dom.parentNode(candidate) === root) {
      const r = prev(dom.shadowHost(root), frontier, rc, SubjectKind.HostElement);
      if (r === true) return true;
      result = result === undefined ? r : subjectOr(result, r);
    }

    return result === undefined ? false : result;
  };
}

function buildPrevElementProof(prev: ElementProofFn, dom: DOMOperations): ElementProofFn {
  return function proof(candidate, frontier, rc) {
    const p = dom.previousElementSibling(candidate);
    return p !== null && prev(p, frontier, rc);
  };
}

function buildPrevSubjectProof(prev: SubjectProofFn, dom: DOMOperations): SubjectProofFn {
  return function proof(candidate, frontier, rc, kind) {
    if (kind !== SubjectKind.Element) return false;

    const p = dom.previousElementSibling(candidate);
    if (!p) return false;

    return prev(p, frontier, rc, SubjectKind.Element);
  };
}

function buildPrevAnyElementProof(prev: ElementProofFn, dom: DOMOperations): ElementProofFn {
  return function proof(candidate, frontier, rc) {
    for (let p = dom.previousElementSibling(candidate); p; p = dom.previousElementSibling(p)) {
      if (prev(p, frontier, rc)) return true;
    }

    return false;
  };
}

function buildPrevAnySubjectProof(prev: SubjectProofFn, dom: DOMOperations): SubjectProofFn {
  return function proof(candidate, frontier, rc, kind) {
    if (kind !== SubjectKind.Element) return false;

    let result: TriMatch | undefined;
    for (let p = dom.previousElementSibling(candidate); p; p = dom.previousElementSibling(p)) {
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

export function buildAdvanceMove(chain: Chain, from: number, ctx: SelectletContext): AdvanceMove | null {
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

  const test = buildStepElementTest(rel, ctx);
  const run = buildAdvanceFn(combinator, test, ctx.dom);

  const move: AdvanceMove = { from, to, run, combinator, test };

  return move;
}

function buildAdvanceFn(combinator: AdvanceCombinator, test: CandidateElementPredicate, dom: DOMOperations): AdvanceFn {
  switch (combinator) {
    case '>': return (frontier, rc) => advanceChildren(frontier, test, rc, dom);
    case '+': return (frontier, rc) => advanceNextSibling(frontier, test, rc, dom);
    case '~': return (frontier, rc) => advanceFollowingSiblings(frontier, test, rc, dom);
  }
}

function advanceNextSibling(frontier: Element[], test: CandidateElementPredicate, rc: RuntimeCache | null, dom: DOMOperations): Element[] {
  const out: Element[] = [];
  let j = -1;

  for (let i = 0; i < frontier.length; i++) {
    const base = frontier[i]!;
    const candidate = dom.nextElementSibling(base);
    if (candidate && test(candidate, rc)) out[++j] = candidate;
  }

  return out;
}

function advanceFollowingSiblings(frontier: Element[], test: CandidateElementPredicate, rc: RuntimeCache | null, dom: DOMOperations): Element[] {
  const out: Element[] = [];
  const seen = new Set<Element>();

  for (let i = 0; i < frontier.length; i++) {
    const base = frontier[i]!;
    for (let candidate = dom.nextElementSibling(base); candidate; candidate = dom.nextElementSibling(candidate)) {
      if (!seen.has(candidate) && test(candidate, rc)) {
        seen.add(candidate);
        out[out.length] = candidate;
      }
    }
  }

  return out;
}

function advanceChildren(frontier: Element[], test: CandidateElementPredicate, rc: RuntimeCache | null, dom: DOMOperations): Element[] {
  const out: Element[] = [];
  let j = -1;

  for (let i = 0; i < frontier.length; i++) {
    const base = frontier[i]!;
    for (let candidate = dom.firstElementChild(base); candidate; candidate = dom.nextElementSibling(candidate)) {
      if (test(candidate, rc)) out[++j] = candidate;
    }
  }

  return out;
}

export function buildAdvanceFirstFn(combinator: AdvanceCombinator, test: CandidateElementPredicate, dom: DOMOperations): AdvanceFirstFn {
  switch (combinator) {
    case '>': return (frontier, rc) => firstChild(frontier, test, rc, dom);
    case '+': return (frontier, rc) => firstNextSibling(frontier, test, rc, dom);
    case '~': return (frontier, rc) => firstFollowingSibling(frontier, test, rc, dom);
  }
}

function firstNextSibling(frontier: Element[], test: CandidateElementPredicate, rc: RuntimeCache | null, dom: DOMOperations): Element | null {
  for (let i = 0; i < frontier.length; i++) {
    const base = frontier[i]!;
    const candidate = dom.nextElementSibling(base);
    if (candidate && test(candidate, rc)) return candidate;
  }

  return null;
}

function firstFollowingSibling(frontier: Element[], test: CandidateElementPredicate, rc: RuntimeCache | null, dom: DOMOperations): Element | null {
  for (let i = 0; i < frontier.length; i++) {
    const base = frontier[i]!;
    for (let candidate = dom.nextElementSibling(base); candidate; candidate = dom.nextElementSibling(candidate)) {
      if (test(candidate, rc)) return candidate;
    }
  }

  return null;
}

function firstChild(frontier: Element[], test: CandidateElementPredicate, rc: RuntimeCache | null, dom: DOMOperations): Element | null {
  for (let i = 0; i < frontier.length; i++) {
    const base = frontier[i]!;
    for (let candidate = dom.firstElementChild(base); candidate; candidate = dom.nextElementSibling(candidate)) {
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
  ctx: SelectletContext,
  rc: RuntimeCache | null,
): boolean {
  if (index >= steps.length) return true;

  const step = steps[index]!;
  const [combinator, test] = step;
  const next = index + 1;

  switch (combinator) {
    case ' ':
      for (let node = ctx.dom.firstElementChild(base); node; node = nextDescendant(base, node, ctx.dom)) {
        if (test(node, rc) && matchHasFrom(steps, next, node, ctx, rc)) return true;
      }
      return false;

    case '>':
      for (let node = ctx.dom.firstElementChild(base); node; node = ctx.dom.nextElementSibling(node)) {
        if (test(node, rc) && matchHasFrom(steps, next, node, ctx, rc)) return true;
      }
      return false;

    case '+': {
      const node = ctx.dom.nextElementSibling(base);
      return !!node && test(node, rc) && matchHasFrom(steps, next, node, ctx, rc);
    }

    case '~':
      for (let node = ctx.dom.nextElementSibling(base); node; node = ctx.dom.nextElementSibling(node)) {
        if (test(node, rc) && matchHasFrom(steps, next, node, ctx, rc)) return true;
      }
      return false;
  }
}

function shadowRoot(node: Element, dom: DOMOperations): ShadowRoot | null {
  const root = dom.root(node);
  return dom.isShadowRoot(root) ? root : null;
}
