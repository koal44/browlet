import { collectCompoundTests } from '../compile/emit-seedable';
import { nextDescendant } from '../compile/runtime';
import type { RuntimeCache } from '../compile/runtimeCache';
import type {
  CandidateBiPredicate, CandidateTest, CandidateTriPredicate, Combinator, ComplexPart, ComplexSelector, CompoundSelector, RelativeSelectorList, SelectorList,
  TriMatch,
} from '../parser/parser';
import { assertNever } from '../../utils/util';
import { SubjectKind } from '../constants';
import { getShadowTreeRoot } from '../../utils/dom';

export type Chain = ChainRelation[];

export type ChainRelation = {
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
  chain[0] = {
    combinator: null,
    left: parts[0],
    right: parts[0],
  };

  for (let i = 1; i < parts.length; i++) {
    const combinator = parts[i].combinator;
    if (combinator === null) {
      throw new Error(`Missing combinator at part ${i}`);
    }

    chain[i] = {
      combinator,
      left: parts[i - 1],
      right: parts[i],
    };
  }

  return chain;
}

export function buildStrictSelectorListTest(list: SelectorList, snap: Snapshot): CandidateBiPredicate {
  if (list.usesHost) {
    const tri = buildStrictSelectorListTriTest(list, snap);
    return (candidate, rc) =>
      tri(candidate, rc, SubjectKind.Element) === true;
  }
  return buildStrictSelectorListBiTest(list, snap);
}

export function buildStrictSelectorListBiTest(list: SelectorList, snap: Snapshot): CandidateBiPredicate {
  const proof = buildSelectorListBiProof(list, snap);
  return (candidate, rc) => proof(candidate, null, rc);
}

export function buildStrictSelectorListTriTest(list: SelectorList, snap: Snapshot): CandidateTriPredicate {
  const proof = buildSelectorListTriProof(list, snap);
  return (candidate, rc, kind) => proof(candidate, null, rc, kind);
}

export function buildForgivingSelectorListBiTest(list: SelectorList, snap: Snapshot): CandidateBiPredicate {
  if (list.arms.length === 0) return () => false;
  return buildStrictSelectorListBiTest(list, snap);
}

export function buildForgivingSelectorListTriTest(list: SelectorList, snap: Snapshot): CandidateTriPredicate {
  if (list.arms.length === 0) return () => false;
  return buildStrictSelectorListTriTest(list, snap);
}

export function buildRelativeSelectorListBiTest(list: RelativeSelectorList, snap: Snapshot): CandidateBiPredicate {
  if (list.arms.length === 0) return () => false;

  const arms: CandidateBiPredicate[] = list.arms.map((arm) => {
    const steps: HasStep[] = arm.steps.map((step) => {
      const test = buildCompoundBiTest(step.compound.compound, snap);
      return [step.combinator, test];
    });

    return (e, rc) => matchHasFrom(steps, 0, e, snap, rc);
  });

  if (arms.length === 1) return arms[0];

  return function relativeSelectorListBiTest(e, rc) {
    for (let i = 0; i < arms.length; i++) {
      if (arms[i](e, rc)) return true;
    }

    return false;
  };
}

function buildStepBiTest(rel: ChainRelation, snap: Snapshot): CandidateBiPredicate {
  return buildCompoundBiTest(rel.right.compound, snap);
}

function buildStepTriTest(rel: ChainRelation, snap: Snapshot): CandidateTriPredicate {
  return buildCompoundTriTest(rel.right.compound, snap);
}

export function buildCompoundBiTest(compound: CompoundSelector, snap: Snapshot): CandidateBiPredicate {
  const tests = collectCompoundTests(compound);

  const n = tests.length;
  if (n === 0) return () => true;
  if (n === 1) return tests[0].buildBi(snap);

  tests.sort((a, b) => a.cost - b.cost);

  const predicates: CandidateBiPredicate[] = [];
  for (let i = 0; i < n; i++) {
    predicates[i] = tests[i].buildBi(snap);
  }

  return function compoundTest(e, rc) {
    for (let i = 0; i < n; i++) {
      if (!predicates[i](e, rc)) return false;
    }

    return true;
  };
}

export function buildCompoundTriTest(compound: CompoundSelector, snap: Snapshot): CandidateTriPredicate {
  const tests = collectCompoundTests(compound);

  const n = tests.length;
  if (n === 0) return () => true;
  if (n === 1) return buildCandidateTriTest(tests[0], snap);

  tests.sort((a, b) => a.cost - b.cost);

  const predicates: CandidateTriPredicate[] = [];
  for (let i = 0; i < n; i++) {
    predicates[i] = buildCandidateTriTest(tests[i], snap);
  }

  return function compoundTriTest(e, rc, kind) {
    let sawFalse = false;

    for (let i = 0; i < n; i++) {
      const r = predicates[i](e, rc, kind);

      if (r === null) return null;
      if (r === false) sawFalse = true;
    }

    return !sawFalse;
  };
}

function buildCandidateTriTest(test: CandidateTest, snap: Snapshot): CandidateTriPredicate {
  if (test.buildTri) return test.buildTri(snap);

  const bi = test.buildBi(snap);

  return (e, rc, kind) => {
    if (kind !== SubjectKind.Element) return null;
    return bi(e, rc);
  };
}

// -------------- PROOF -----------------

export type BiProofFn =
  (candidate: Element, frontier: Element[] | null, rc: RuntimeCache | null) => boolean;

export type TriProofFn =
  (candidate: Element, frontier: Element[] | null, rc: RuntimeCache | null, kind: SubjectKind) => TriMatch;

function buildStepBiProof(rel: ChainRelation, snap: Snapshot): BiProofFn {
  const test = buildStepBiTest(rel, snap);

  return function proof(candidate, _frontier, rc) {
    return test(candidate, rc);
  };
}

function buildStepTriProof(rel: ChainRelation, snap: Snapshot): TriProofFn {
  const test = buildStepTriTest(rel, snap);

  return function proof(candidate, _frontier, rc, kind) {
    return test(candidate, rc, kind);
  };
}

export function buildBiProof(chain: Chain, from: number, to: number, snap: Snapshot): BiProofFn {
  if (from < -1 || to < 0 || to >= chain.length || to <= from) {
    throw new Error(`Invalid proof range: ${from} ➝ ${to}`);
  }

  const start = from + 1;
  let proof: BiProofFn = buildStepBiProof(chain[start], snap);

  if (from >= 0) {
    const prev = proof;
    const connect = buildConnectionToFrontierBi(chain[start]);

    proof = function proof(candidate, frontier, rc) {
      return prev(candidate, frontier, rc) && connect(candidate, frontier, rc);
    };
  }

  for (let i = start + 1; i <= to; i++) {
    const step = buildStepBiTest(chain[i], snap);
    const prev = proof;
    const connect = extendBiProof(chain[i], prev, snap);

    proof = function proof(candidate, frontier, rc) {
      return step(candidate, rc) && connect(candidate, frontier, rc);
    };
  }

  return proof;
}

export function buildTriProof(chain: Chain, from: number, to: number, snap: Snapshot): TriProofFn {
  if (from < -1 || to < 0 || to >= chain.length || to <= from) {
    throw new Error(`Invalid proof range: ${from} ➝ ${to}`);
  }

  const start = from + 1;
  let proof: TriProofFn = buildStepTriProof(chain[start], snap);

  if (from >= 0) {
    const prev = proof;
    const connect = buildConnectionToFrontierTri(chain[start]);

    proof = function proof(candidate, frontier, rc, kind) {
      return triAnd(
        prev(candidate, frontier, rc, kind),
        connect(candidate, frontier, rc, kind),
      );
    };
  }

  for (let i = start + 1; i <= to; i++) {
    const step = buildStepTriTest(chain[i], snap);
    const prev = proof;
    const connect = extendTriProof(chain[i], prev);

    proof = function proof(candidate, frontier, rc, kind) {
      return triAnd(
        step(candidate, rc, kind),
        connect(candidate, frontier, rc, kind),
      );
    };
  }

  return proof;
}

export function buildFullBiProof(chain: Chain, snap: Snapshot): BiProofFn {
  return buildBiProof(chain, -1, chain.length - 1, snap);
}

export function buildFullTriProof(chain: Chain, snap: Snapshot): TriProofFn {
  return buildTriProof(chain, -1, chain.length - 1, snap);
}

export function buildMultiChainBiProof(chains: Chain[], snap: Snapshot): BiProofFn {
  if (chains.length === 0) {
    throw new Error('Cannot build multi-chain proof for empty chain list');
  }

  if (chains.length === 1) {
    return buildFullBiProof(chains[0], snap);
  }

  const proofs: BiProofFn[] = [];
  for (let i = 0; i < chains.length; i++) {
    proofs[i] = buildFullBiProof(chains[i], snap);
  }

  return function proof(candidate, frontier, rc) {
    for (let i = 0; i < proofs.length; i++) {
      if (proofs[i](candidate, frontier, rc)) return true;
    }

    return false;
  };
}

export function buildMultiChainTriProof(chains: Chain[], snap: Snapshot): TriProofFn {
  if (chains.length === 0) {
    throw new Error('Cannot build multi-chain proof for empty chain list');
  }

  if (chains.length === 1) {
    return buildFullTriProof(chains[0], snap);
  }

  const proofs: TriProofFn[] = [];
  for (let i = 0; i < chains.length; i++) {
    proofs[i] = buildFullTriProof(chains[i], snap);
  }

  return function proof(candidate, frontier, rc, kind) {
    let sawFalse = false;

    for (let i = 0; i < proofs.length; i++) {
      const r = proofs[i](candidate, frontier, rc, kind);

      if (r === true) return true;
      if (r === false) sawFalse = true;
    }

    return sawFalse ? false : null;
  };
}

export function buildSelectorListBiProof(list: SelectorList, snap: Snapshot): BiProofFn {
  const arms = list.arms;

  if (arms.length === 0) {
    throw new Error('Cannot build selector list proof for empty selector list');
  }

  if (arms.length === 1) {
    return buildFullBiProof(buildChain(arms[0]), snap);
  }

  arms.sort((a, b) => a.cost - b.cost);

  const chains: Chain[] = [];
  for (let i = 0; i < arms.length; i++) {
    chains[i] = buildChain(arms[i]);
  }

  return buildMultiChainBiProof(chains, snap);
}

export function buildSelectorListTriProof(list: SelectorList, snap: Snapshot): TriProofFn {
  const arms = list.arms;

  if (arms.length === 0) {
    throw new Error('Cannot build selector list proof for empty selector list');
  }

  if (arms.length === 1) {
    return buildFullTriProof(buildChain(arms[0]), snap);
  }

  arms.sort((a, b) => a.cost - b.cost);

  const proofs: TriProofFn[] = [];
  for (let i = 0; i < arms.length; i++) {
    proofs[i] = buildFullTriProof(buildChain(arms[i]), snap);
  }

  return function selectorListTriProof(candidate, frontier, rc, kind) {
    let sawFalse = false;

    for (let i = 0; i < proofs.length; i++) {
      const r = proofs[i](candidate, frontier, rc, kind);

      if (r === true) return true;
      if (r === false) sawFalse = true;
    }

    return sawFalse ? false : null;
  };
}

function buildConnectionToFrontierBi(rel: ChainRelation): BiProofFn {
  switch (rel.combinator) {
    case ' ': return buildAncestorInFrontierBiProof();
    case '>': return buildParentInFrontierBiProof();
    case '+': return buildPrevInFrontierBiProof();
    case '~': return buildPrevAnyInFrontierBiProof();

    case null:
      throw new Error('Cannot connect chain start relation to frontier.');

    default:
      return assertNever(rel.combinator);
  }
}

function buildConnectionToFrontierTri(rel: ChainRelation): TriProofFn {
  switch (rel.combinator) {
    case ' ': return buildAncestorInFrontierTriProof();
    case '>': return buildParentInFrontierTriProof();
    case '+': return buildPrevInFrontierTriProof();
    case '~': return buildPrevAnyInFrontierTriProof();

    case null:
      throw new Error('Cannot connect chain start relation to frontier.');

    default:
      return assertNever(rel.combinator);
  }
}

function buildAncestorInFrontierBiProof(): BiProofFn {
  return function proof(candidate, frontier) {
    for (let p = candidate.parentElement; p; p = p.parentElement) {
      if (inFrontier(p, frontier)) return true;
    }

    return false;
  };
}

function buildAncestorInFrontierTriProof(): TriProofFn {
  return function proof(candidate, frontier, _rc, kind) {
    if (kind !== SubjectKind.Element) return false;

    for (let p = candidate.parentElement; p; p = p.parentElement) {
      if (inFrontier(p, frontier)) return true;
    }

    return false;
  };
}

function buildParentInFrontierBiProof(): BiProofFn {
  return function proof(candidate, frontier) {
    const p = candidate.parentElement;
    return p !== null && inFrontier(p, frontier);
  };
}

function buildParentInFrontierTriProof(): TriProofFn {
  return function proof(candidate, frontier, _rc, kind) {
    if (kind !== SubjectKind.Element) return false;

    const p = candidate.parentElement;
    return p !== null && inFrontier(p, frontier);
  };
}

function buildPrevInFrontierBiProof(): BiProofFn {
  return function proof(candidate, frontier) {
    const p = candidate.previousElementSibling;
    return p !== null && inFrontier(p, frontier);
  };
}

function buildPrevInFrontierTriProof(): TriProofFn {
  return function proof(candidate, frontier, _rc, kind) {
    if (kind !== SubjectKind.Element) return false;

    const p = candidate.previousElementSibling;
    return p !== null && inFrontier(p, frontier);
  };
}

function buildPrevAnyInFrontierBiProof(): BiProofFn {
  return function proof(candidate, frontier) {
    for (let p = candidate.previousElementSibling; p; p = p.previousElementSibling) {
      if (inFrontier(p, frontier)) return true;
    }

    return false;
  };
}

function buildPrevAnyInFrontierTriProof(): TriProofFn {
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

function extendBiProof(rel: ChainRelation, prev: BiProofFn, _snap: Snapshot): BiProofFn {
  switch (rel.combinator) {
    case ' ': return buildAncestorBiProof(prev);
    case '>': return buildParentBiProof(prev);
    case '+': return buildPrevBiProof(prev);
    case '~': return buildPrevAnyBiProof(prev);

    case null:
      throw new Error('Cannot extend proof from chain start relation.');

    default:
      return assertNever(rel.combinator);
  }
}

function extendTriProof(rel: ChainRelation, prev: TriProofFn): TriProofFn {
  switch (rel.combinator) {
    case ' ': return buildAncestorTriProof(prev);
    case '>': return buildParentTriProof(prev);
    case '+': return buildPrevTriProof(prev);
    case '~': return buildPrevAnyTriProof(prev);

    case null:
      throw new Error('Cannot extend proof from chain start relation.');

    default:
      return assertNever(rel.combinator);
  }
}

function buildAncestorBiProof(prev: BiProofFn): BiProofFn {
  return function proof(candidate, frontier, rc) {
    for (let p = candidate.parentElement; p; p = p.parentElement) {
      if (prev(p, frontier, rc)) return true;
    }

    return false;
  };
}

function buildAncestorTriProof(prev: TriProofFn): TriProofFn {
  return function proof(candidate, frontier, rc, kind) {
    if (kind !== SubjectKind.Element) return false;

    let sawFalse = false;
    let sawNull = false;

    for (let p = candidate.parentElement; p; p = p.parentElement) {
      const r = prev(p, frontier, rc, SubjectKind.Element);
      if (r === true) return true;
      if (r === false) sawFalse = true;
      else sawNull = true;
    }

    const root = getShadowTreeRoot(candidate);
    if (root) {
      const r = prev(root.host, frontier, rc, SubjectKind.HostElement);
      if (r === true) return true;
      if (r === false) sawFalse = true;
      else sawNull = true;
    }

    return triAnyResult(sawFalse, sawNull);
  };
}

function buildParentBiProof(prev: BiProofFn): BiProofFn {
  return function proof(candidate, frontier, rc) {
    const p = candidate.parentElement;
    return p !== null && prev(p, frontier, rc);
  };
}

function buildParentTriProof(prev: TriProofFn): TriProofFn {
  return function proof(candidate, frontier, rc, kind) {
    if (kind !== SubjectKind.Element) return false;

    let sawFalse = false;
    let sawNull = false;

    const p = candidate.parentElement;
    if (p) {
      const r = prev(p, frontier, rc, SubjectKind.Element);
      if (r === true) return true;
      if (r === false) sawFalse = true;
      else sawNull = true;
    }

    const root = getShadowTreeRoot(candidate);
    if (root && candidate.parentNode === root) {
      const r = prev(root.host, frontier, rc, SubjectKind.HostElement);
      if (r === true) return true;
      if (r === false) sawFalse = true;
      else sawNull = true;
    }

    return sawFalse ? false : sawNull ? null : false;
  };
}

function buildPrevBiProof(prev: BiProofFn): BiProofFn {
  return function proof(candidate, frontier, rc) {
    const p = candidate.previousElementSibling;
    return p !== null && prev(p, frontier, rc);
  };
}

function buildPrevTriProof(prev: TriProofFn): TriProofFn {
  return function proof(candidate, frontier, rc, kind) {
    if (kind !== SubjectKind.Element) return false;

    const p = candidate.previousElementSibling;
    if (!p) return false;

    return prev(p, frontier, rc, SubjectKind.Element);
  };
}

function buildPrevAnyBiProof(prev: BiProofFn): BiProofFn {
  return function proof(candidate, frontier, rc) {
    for (let p = candidate.previousElementSibling; p; p = p.previousElementSibling) {
      if (prev(p, frontier, rc)) return true;
    }

    return false;
  };
}

function buildPrevAnyTriProof(prev: TriProofFn): TriProofFn {
  return function proof(candidate, frontier, rc, kind) {
    if (kind !== SubjectKind.Element) return false;

    let sawFalse = false;
    let sawNull = false;

    for (let p = candidate.previousElementSibling; p; p = p.previousElementSibling) {
      const r = prev(p, frontier, rc, SubjectKind.Element);
      if (r === true) return true;
      if (r === false) sawFalse = true;
      else sawNull = true;
    }

    return triAnyResult(sawFalse, sawNull);
  };
}

function triAnd(a: TriMatch, b: TriMatch): TriMatch {
  if (a === null || b === null) return null;
  if (a === false || b === false) return false;
  return true;
}

function triAnyResult(sawFalse: boolean, sawNull: boolean): TriMatch {
  return sawFalse ? false : sawNull ? null : false;
}

// -------------- ADVANCE MOVES -----------------

export type AdvanceMove = {
  combinator: AdvanceCombinator;
  from: number;
  to: number;
  run: AdvanceFn;
  test: CandidateBiPredicate;
  first?: AdvanceFirstFn;
  debug?: string;
};

type AdvanceCombinator = '>' | '+' | '~';

type AdvanceFn = (frontier: Element[], rc: RuntimeCache | null) => Element[];
type AdvanceFirstFn = (frontier: Element[], rc: RuntimeCache | null) => Element | null;

export function buildAdvanceMove(chain: Chain, from: number, snap: Snapshot): AdvanceMove | null {
  if (chainUsesHost(chain)) return null;

  const to = from + 1;
  if (to >= chain.length) return null;

  const rel = chain[to];
  const { combinator } = rel;

  if (combinator === null) {
    throw new Error(`Missing combinator at chain relation ${to} in frontier advance move`);
  }

  if (combinator !== '>' && combinator !== '+' && combinator !== '~') {
    return null;
  }

  const test = buildStepBiTest(rel, snap);
  const run = buildAdvanceFn(combinator, test);

  const move: AdvanceMove = { from, to, run, combinator, test };

  return move;
}

function chainUsesHost(chain: Chain): boolean {
  for (let i = 0; i < chain.length; i++) {
    if (chain[i].left.compound.usesHost || chain[i].right.compound.usesHost) {
      return true;
    }
  }

  return false;
}

function buildAdvanceFn(combinator: AdvanceCombinator, test: CandidateBiPredicate): AdvanceFn {
  switch (combinator) {
    case '>': return (frontier, rc) => advanceChildren(frontier, test, rc);
    case '+': return (frontier, rc) => advanceNextSibling(frontier, test, rc);
    case '~': return (frontier, rc) => advanceFollowingSiblings(frontier, test, rc);
  }
}

function advanceNextSibling(frontier: Element[], test: CandidateBiPredicate, rc: RuntimeCache | null): Element[] {
  const out: Element[] = [];
  let j = -1;

  for (let i = 0; i < frontier.length; i++) {
    const candidate = frontier[i].nextElementSibling;
    if (candidate && test(candidate, rc)) out[++j] = candidate;
  }

  return out;
}

function advanceFollowingSiblings(frontier: Element[], test: CandidateBiPredicate, rc: RuntimeCache | null): Element[] {
  const out: Element[] = [];
  const seen = new Set<Element>();

  for (let i = 0; i < frontier.length; i++) {
    for (let candidate = frontier[i].nextElementSibling; candidate; candidate = candidate.nextElementSibling) {
      if (!seen.has(candidate) && test(candidate, rc)) {
        seen.add(candidate);
        out[out.length] = candidate;
      }
    }
  }

  return out;
}

function advanceChildren(frontier: Element[], test: CandidateBiPredicate, rc: RuntimeCache | null): Element[] {
  const out: Element[] = [];
  let j = -1;

  for (let i = 0; i < frontier.length; i++) {
    for (let candidate = frontier[i].firstElementChild; candidate; candidate = candidate.nextElementSibling) {
      if (test(candidate, rc)) out[++j] = candidate;
    }
  }

  return out;
}

export function buildAdvanceFirstFn(combinator: AdvanceCombinator, test: CandidateBiPredicate): AdvanceFirstFn {
  switch (combinator) {
    case '>': return (frontier, rc) => firstChild(frontier, test, rc);
    case '+': return (frontier, rc) => firstNextSibling(frontier, test, rc);
    case '~': return (frontier, rc) => firstFollowingSibling(frontier, test, rc);
  }
}

function firstNextSibling(frontier: Element[], test: CandidateBiPredicate, rc: RuntimeCache | null): Element | null {
  for (let i = 0; i < frontier.length; i++) {
    const candidate = frontier[i].nextElementSibling;
    if (candidate && test(candidate, rc)) return candidate;
  }

  return null;
}

function firstFollowingSibling(frontier: Element[], test: CandidateBiPredicate, rc: RuntimeCache | null): Element | null {
  for (let i = 0; i < frontier.length; i++) {
    for (let candidate = frontier[i].nextElementSibling; candidate; candidate = candidate.nextElementSibling) {
      if (test(candidate, rc)) return candidate;
    }
  }

  return null;
}

function firstChild(frontier: Element[], test: CandidateBiPredicate, rc: RuntimeCache | null): Element | null {
  for (let i = 0; i < frontier.length; i++) {
    for (let candidate = frontier[i].firstElementChild; candidate; candidate = candidate.nextElementSibling) {
      if (test(candidate, rc)) return candidate;
    }
  }

  return null;
}

type SelectorCombinator = ' ' | '>' | '+' | '~';
export type HasStep = [SelectorCombinator, (e: Element, rc: RuntimeCache | null) => boolean];
export function matchHasFrom(
  steps: HasStep[],
  index: number,
  base: Element,
  snap: Snapshot,
  rc: RuntimeCache | null,
): boolean {
  if (index >= steps.length) return true;

  const [combinator, test] = steps[index];
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
