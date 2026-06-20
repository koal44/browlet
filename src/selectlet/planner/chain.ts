import { collectCompoundTests } from '../compile/emit-seedable';
import { nextDescendant } from '../compile/runtime';
import type { RuntimeCache } from '../compile/runtimeCache';
import type {
  CandidatePredicate, Combinator, ComplexPart, ComplexSelector, CompoundSelector, HostContextSelector, HostSelector, RelativeSelectorList, SelectorList,
} from '../parser/parser';
import { assertNever } from '../../utils/util';

export type Chain = ChainRelation[];

export type ChainRelation = {
  combinator: ChainCombinator | null;
  left: ComplexPart;
  right: ComplexPart;
};

const CHAIN_NEVER = 0;
const CHAIN_HOST_DESCENDANT = 1;
const CHAIN_HOST_CHILD = 2;

type ChainCombinator =
  | Combinator
  | typeof CHAIN_NEVER
  | typeof CHAIN_HOST_DESCENDANT
  | typeof CHAIN_HOST_CHILD;

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
      combinator: normalizeChainCombinator(i, combinator, parts[i - 1], parts[i]),
      left: parts[i - 1],
      right: parts[i],
    };
  }

  return chain;
}

function normalizeChainCombinator(
  i: number,
  combinator: Combinator,
  left: ComplexPart,
  right: ComplexPart,
): ChainCombinator {
  const leftCompound = left.compound;
  const rightCompound = right.compound;

  // A host-boundary compound cannot be the real/right candidate side of a relation.
  if (rightCompound.host || rightCompound.hostContext) return CHAIN_NEVER;

  const hasHostBoundary = leftCompound.host || leftCompound.hostContext;
  if (!hasHostBoundary) return combinator;

  // Host-boundary pseudos only work as a bare virtual boundary.
  // :host.foo, .foo:host-context(...), :host-context(...)[attr], etc.
  // are parse-valid but unprovable as real elements.
  if (
    leftCompound.id ||
    leftCompound.tag ||
    leftCompound.classes?.length ||
    leftCompound.tests.length !== 0
  ) {
    return CHAIN_NEVER;
  }

  // The host boundary is only meaningful as the left side of the first real relation.
  if (i !== 1) return CHAIN_NEVER;

  if (combinator === ' ') return CHAIN_HOST_DESCENDANT;
  if (combinator === '>') return CHAIN_HOST_CHILD;

  // Sibling combinators from a virtual host boundary are meaningless.
  return CHAIN_NEVER;
}
export function buildStrictSelectorListTest(list: SelectorList, snap: Snapshot): CandidatePredicate {
  const proof = buildSelectorListProof(list, snap);
  return (candidate, rc) => proof(candidate, null, rc);
}

export function buildForgivingSelectorListTest(list: SelectorList, snap: Snapshot): CandidatePredicate {
  if (list.arms.length === 0) return () => false;
  return buildStrictSelectorListTest(list, snap);
}

export function buildRelativeSelectorListTest(list: RelativeSelectorList, snap: Snapshot): CandidatePredicate {
  if (list.arms.length === 0) return () => false;

  const arms: CandidatePredicate[] = list.arms.map((arm) => {
    const steps: HasStep[] = arm.steps.map((step) => {
      const test = buildCompoundTest(step.compound.compound, snap);
      return [step.combinator, test];
    });

    return (e, rc) => matchHasFrom(steps, 0, e, snap, rc);
  });

  if (arms.length === 1) return arms[0];

  return function relativeSelectorListTest(e, rc) {
    for (let i = 0; i < arms.length; i++) {
      if (arms[i](e, rc)) return true;
    }

    return false;
  };
}

function buildStepTest(rel: ChainRelation, snap: Snapshot): CandidatePredicate {
  return buildCompoundTest(rel.right.compound, snap);
}

export function buildCompoundTest(compound: CompoundSelector, snap: Snapshot): CandidatePredicate {
  if (compound.host || compound.hostContext) return () => false;
  const tests = collectCompoundTests(compound);

  const n = tests.length;
  if (n === 0) return () => true;
  if (n === 1) return tests[0].build(snap);

  tests.sort((a, b) => a.cost - b.cost);

  const predicates: CandidatePredicate[] = [];
  for (let i = 0; i < n; i++) {
    predicates[i] = tests[i].build(snap);
  }

  return function compoundTest(e, rc) {
    for (let i = 0; i < n; i++) {
      if (!predicates[i](e, rc)) return false;
    }

    return true;
  };
}

// -------------- PROOF -----------------

export type ProofFn = (candidate: Element, frontier: Element[] | null, rc: RuntimeCache | null) => boolean;

function buildStepProof(rel: ChainRelation, snap: Snapshot): ProofFn {
  const test = buildStepTest(rel, snap);

  return function proof(candidate, _frontier, rc) {
    return test(candidate, rc);
  };
}

export function buildProof(chain: Chain, from: number, to: number, snap: Snapshot): ProofFn {
  if (from < -1 || to < 0 || to >= chain.length || to <= from) {
    throw new Error(`Invalid proof range: ${from} ➝ ${to}`);
  }

  const start = from + 1;
  let proof: ProofFn = buildStepProof(chain[start], snap);

  if (from >= 0) {
    const prev = proof;
    const connect = buildConnectionToFrontier(chain[start]);

    proof = function proof(candidate, frontier, rc) {
      return prev(candidate, frontier, rc) && connect(candidate, frontier, rc);
    };
  }

  for (let i = start + 1; i <= to; i++) {
    const step = buildStepTest(chain[i], snap);
    const prev = proof;
    const connect = extendProof(chain[i], prev, snap);

    proof = function proof(candidate, frontier, rc) {
      return step(candidate, rc) && connect(candidate, frontier, rc);
    };
  }

  return proof;
}

export function buildFullProof(chain: Chain, snap: Snapshot): ProofFn {
  return buildProof(chain, -1, chain.length - 1, snap);
}

export function buildMultiChainProof(chains: Chain[], snap: Snapshot): ProofFn {
  if (chains.length === 0) {
    throw new Error('Cannot build multi-chain proof for empty chain list');
  }

  if (chains.length === 1) {
    return buildFullProof(chains[0], snap);
  }

  const proofs: ProofFn[] = [];
  for (let i = 0; i < chains.length; i++) {
    proofs[i] = buildFullProof(chains[i], snap);
  }

  return function proof(candidate, frontier, rc) {
    for (let i = 0; i < proofs.length; i++) {
      if (proofs[i](candidate, frontier, rc)) return true;
    }

    return false;
  };
}

export function buildSelectorListProof(list: SelectorList, snap: Snapshot): ProofFn {
  const arms = list.arms;

  if (arms.length === 0) {
    throw new Error('Cannot build selector list proof for empty selector list');
  }

  if (arms.length === 1) {
    return buildFullProof(buildChain(arms[0]), snap);
  }

  arms.sort((a, b) => a.cost - b.cost);

  const chains: Chain[] = [];
  for (let i = 0; i < arms.length; i++) {
    chains[i] = buildChain(arms[i]);
  }

  return buildMultiChainProof(chains, snap);
}

function buildConnectionToFrontier(rel: ChainRelation): ProofFn {
  switch (rel.combinator) {
    case ' ': return buildAncestorInFrontierProof();
    case '>': return buildParentInFrontierProof();
    case '+': return buildPrevInFrontierProof();
    case '~': return buildPrevAnyInFrontierProof();
    case CHAIN_NEVER: return buildNeverProof();

    case null:
      throw new Error('Cannot connect chain start relation to frontier.');

    case CHAIN_HOST_DESCENDANT:
    case CHAIN_HOST_CHILD:
      throw new Error(`Host boundary combinator cannot connect to frontier: ${String(rel.combinator)}`);

    default:
      return assertNever(rel.combinator);
  }
}

function buildNeverProof(): ProofFn {
  return function proof() {
    return false;
  };
}

function buildAncestorInFrontierProof(): ProofFn {
  return function proof(candidate, frontier) {
    for (let p = candidate.parentElement; p; p = p.parentElement) {
      if (inFrontier(p, frontier)) return true;
    }

    return false;
  };
}

function buildParentInFrontierProof(): ProofFn {
  return function proof(candidate, frontier) {
    const p = candidate.parentElement;
    return p !== null && inFrontier(p, frontier);
  };
}

function buildPrevInFrontierProof(): ProofFn {
  return function proof(candidate, frontier) {
    const p = candidate.previousElementSibling;
    return p !== null && inFrontier(p, frontier);
  };
}

function buildPrevAnyInFrontierProof(): ProofFn {
  return function proof(candidate, frontier) {
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

function extendProof(rel: ChainRelation, prev: ProofFn, snap: Snapshot): ProofFn {
  switch (rel.combinator) {
    case ' ': return buildAncestorProof(prev);
    case '>': return buildParentProof(prev);
    case '+': return buildPrevProof(prev);
    case '~': return buildPrevAnyProof(prev);
    case CHAIN_HOST_DESCENDANT: return buildHostAncestorProof(rel, snap);
    case CHAIN_HOST_CHILD: return buildHostParentProof(rel, snap);
    case CHAIN_NEVER: return buildNeverProof();

    case null:
      throw new Error('Cannot extend proof from chain start relation.');

    default:
      return assertNever(rel.combinator);
  }
}

function buildAncestorProof(prev: ProofFn): ProofFn {
  return function proof(candidate, frontier, rc) {
    for (let p = candidate.parentElement; p; p = p.parentElement) {
      if (prev(p, frontier, rc)) return true;
    }

    return false;
  };
}

function buildParentProof(prev: ProofFn): ProofFn {
  return function proof(candidate, frontier, rc) {
    const p = candidate.parentElement;
    return p !== null && prev(p, frontier, rc);
  };
}

function buildPrevProof(prev: ProofFn): ProofFn {
  return function proof(candidate, frontier, rc) {
    const p = candidate.previousElementSibling;
    return p !== null && prev(p, frontier, rc);
  };
}

function buildPrevAnyProof(prev: ProofFn): ProofFn {
  return function proof(candidate, frontier, rc) {
    for (let p = candidate.previousElementSibling; p; p = p.previousElementSibling) {
      if (prev(p, frontier, rc)) return true;
    }

    return false;
  };
}

function buildHostAncestorProof(rel: ChainRelation, snap: Snapshot): ProofFn {
  const boundaryTest = buildHostBoundaryTest(rel.left.compound, snap);

  return function proof(candidate, _frontier, rc) {
    const root = candidateShadowRoot(candidate);
    return root !== null && boundaryTest(root.host, rc);
  };
}

function buildHostParentProof(rel: ChainRelation, snap: Snapshot): ProofFn {
  const boundaryTest = buildHostBoundaryTest(rel.left.compound, snap);

  return function proof(candidate, _frontier, rc) {
    const root = candidateShadowRoot(candidate);
    return root !== null &&
      candidate.parentNode === root &&
      boundaryTest(root.host, rc);
  };
}

type HostBoundaryPredicate = (host: Element, rc: RuntimeCache | null) => boolean;

function buildHostBoundaryTest(compound: CompoundSelector, snap: Snapshot): HostBoundaryPredicate {
  const hostTest = compound.host
    ? buildHostArgTest(compound.host, snap)
    : null;

  const hostContextTest = compound.hostContext
    ? buildHostContextArgTest(compound.hostContext, snap)
    : null;

  return function hostBoundaryTest(host, rc) {
    if (hostTest && !hostTest(host, rc)) return false;
    if (hostContextTest && !hostContextTest(host, rc)) return false;
    return true;
  };
}

function buildHostArgTest(host: HostSelector, snap: Snapshot): CandidatePredicate {
  return host.arg
    ? buildCompoundTest(host.arg, snap)
    : () => true;
}

function buildHostContextArgTest(hostContext: HostContextSelector, snap: Snapshot): HostBoundaryPredicate {
  const test = buildCompoundTest(hostContext.arg, snap);

  return function hostContextArgTest(host, rc) {
    for (let e: Element | null = host; e; e = e.parentElement) {
      if (test(e, rc)) return true;
    }

    return false;
  };
}

function asShadowRoot(root: Node): ShadowRoot | null {
  return root.nodeType === 11 && 'host' in root
    ? root as ShadowRoot
    : null;
}

function candidateShadowRoot(candidate: Element): ShadowRoot | null {
  return asShadowRoot(candidate.getRootNode());
}

// -------------- ADVANCE MOVES -----------------

export type AdvanceMove = {
  combinator: AdvanceCombinator;
  from: number;
  to: number;
  run: AdvanceFn;
  test: CandidatePredicate;
  first?: AdvanceFirstFn;
  debug?: string;
};

type AdvanceCombinator = '>' | '+' | '~';

type AdvanceFn = (frontier: Element[], rc: RuntimeCache | null) => Element[];
type AdvanceFirstFn = (frontier: Element[], rc: RuntimeCache | null) => Element | null;

export function buildAdvanceMove(chain: Chain, from: number, snap: Snapshot): AdvanceMove | null {
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

  const test = buildStepTest(rel, snap);
  const run = buildAdvanceFn(combinator, test);

  const move: AdvanceMove = { from, to, run, combinator, test };

  return move;
}

function buildAdvanceFn(combinator: AdvanceCombinator, test: CandidatePredicate): AdvanceFn {
  switch (combinator) {
    case '>': return (frontier, rc) => advanceChildren(frontier, test, rc);
    case '+': return (frontier, rc) => advanceNextSibling(frontier, test, rc);
    case '~': return (frontier, rc) => advanceFollowingSiblings(frontier, test, rc);
  }
}

function advanceNextSibling(frontier: Element[], test: CandidatePredicate, rc: RuntimeCache | null): Element[] {
  const out: Element[] = [];
  let j = -1;

  for (let i = 0; i < frontier.length; i++) {
    const candidate = frontier[i].nextElementSibling;
    if (candidate && test(candidate, rc)) out[++j] = candidate;
  }

  return out;
}

function advanceFollowingSiblings(frontier: Element[], test: CandidatePredicate, rc: RuntimeCache | null): Element[] {
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

function advanceChildren(frontier: Element[], test: CandidatePredicate, rc: RuntimeCache | null): Element[] {
  const out: Element[] = [];
  let j = -1;

  for (let i = 0; i < frontier.length; i++) {
    for (let candidate = frontier[i].firstElementChild; candidate; candidate = candidate.nextElementSibling) {
      if (test(candidate, rc)) out[++j] = candidate;
    }
  }

  return out;
}

export function buildAdvanceFirstFn(combinator: AdvanceCombinator, test: CandidatePredicate): AdvanceFirstFn {
  switch (combinator) {
    case '>': return (frontier, rc) => firstChild(frontier, test, rc);
    case '+': return (frontier, rc) => firstNextSibling(frontier, test, rc);
    case '~': return (frontier, rc) => firstFollowingSibling(frontier, test, rc);
  }
}

function firstNextSibling(frontier: Element[], test: CandidatePredicate, rc: RuntimeCache | null): Element | null {
  for (let i = 0; i < frontier.length; i++) {
    const candidate = frontier[i].nextElementSibling;
    if (candidate && test(candidate, rc)) return candidate;
  }

  return null;
}

function firstFollowingSibling(frontier: Element[], test: CandidatePredicate, rc: RuntimeCache | null): Element | null {
  for (let i = 0; i < frontier.length; i++) {
    for (let candidate = frontier[i].nextElementSibling; candidate; candidate = candidate.nextElementSibling) {
      if (test(candidate, rc)) return candidate;
    }
  }

  return null;
}

function firstChild(frontier: Element[], test: CandidatePredicate, rc: RuntimeCache | null): Element | null {
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
