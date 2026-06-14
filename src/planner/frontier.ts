import type { CompoundSelector } from '../parser/parser';
import type { RuntimeCache } from '../compile/runtimeCache';
import type { QueryContextDescription } from '../utils/debug';
import { describeCombinator, describeCompound, describeContext, describeLookup } from '../utils/debug';
import { seedsByTag } from '../seeds/seedsByTag';
import { cssIdentUnescape } from '../utils/css';
import {
  buildAdvanceFirstFn, buildAdvanceMove, buildProof,
  type AdvanceMove, type Chain, type ProofFn,
} from './chain';

export type FrontierProgram = {
  chain: Chain;
  start: BridgeMove;
  steps: FrontierStep[];
};

type FrontierStep = {
  canRoot: boolean;
  advance?: AdvanceMove | null;
  bridge?: BridgeMove | null;
  bridgeToEnd?: BridgeMove | null;
  count?: number;
  lookupRoot?: QueryContext;
};

export type FrontierState = {
  root: QueryContext;
  frontier: Element[] | null;
};

type BridgeMove = {
  from: number;
  to: number;
  lookup: LookupFn;
  proof: ProofFn;
  debug?: string;
  count?: number;
};

type LookupFn = (root: QueryContext) => Element[];

export function buildFrontierProgram(chain: Chain, snap: Snapshot): FrontierProgram {
  const start = buildBridgeMove(chain, -1, chooseBridgeTarget(chain, -1), snap);
  const steps: FrontierStep[] = [];

  for (let i = 0; i < chain.length; i++) {
    steps[i] = {
      canRoot: canRootAt(chain, i),
    };
  }

  return { chain, start, steps };
}

export function getAdvanceMove(program: FrontierProgram, index: number, snap: Snapshot): AdvanceMove | null {
  const step = program.steps[index];

  if (step.advance !== undefined) return step.advance;

  const move = buildAdvanceMove(program.chain, index, snap);

  if (move && snap.isDebug) {
    const compound = program.chain[move.to].right.compound;
    move.debug =
      `${describeAdvanceMove(move)} · ${describeCombinator(move.combinator)} · test ${describeCompound(compound)}`;
  }

  step.advance = move;
  return move;
}

export function getBridgeMove(program: FrontierProgram, index: number, snap: Snapshot): BridgeMove | null {
  const step = program.steps[index];

  if (step.bridge !== undefined) return step.bridge;

  const next = index + 1;
  if (next >= program.chain.length) {
    step.bridge = null;
    return null;
  }

  const bridge = buildBridgeMove(
    program.chain,
    index,
    chooseBridgeTarget(program.chain, index),
    snap,
  );

  step.bridge = bridge;
  return bridge;
}

export function getBridgeToEndMove(program: FrontierProgram, index: number, snap: Snapshot): BridgeMove {
  const step = program.steps[index];

  if (step.bridgeToEnd !== undefined) {
    if (step.bridgeToEnd === null) {
      throw new Error(`Invalid bridge from terminal step: ${index}`);
    }

    return step.bridgeToEnd;
  }

  const last = program.chain.length - 1;

  if (index >= last) {
    step.bridgeToEnd = null;
    throw new Error(`Invalid bridge from terminal step: ${index}`);
  }

  const bridge = buildBridgeMove(program.chain, index, last, snap);
  step.bridgeToEnd = bridge;
  return bridge;
}

export function canAdvance(state: FrontierState): boolean {
  // Multi-frontier advance is not order-safe unless the frontier is known
  // to be an ancestor-antichain. Keep singleton-only until that proof exists.
  return state.frontier !== null && state.frontier.length === 1;
}

function canRootAt(chain: Chain, index: number): boolean {
  const next = index + 1;
  if (next >= chain.length) return true;

  const combinator = chain[next].combinator;

  // A singleton frontier at step `index` may become lookup root only if the next
  // relation stays inside that frontier's subtree. Sibling relations leave the subtree.
  return combinator !== '+' && combinator !== '~';
}

export function runAdvanceMove(state: FrontierState, move: AdvanceMove, canRoot: boolean, rc: RuntimeCache | null): void {
  const frontier = state.frontier;
  if (!frontier) return;

  const next = move.run(frontier, rc);
  updateFrontierState(state, next, canRoot);
}

export function runFirstAdvanceMove(state: FrontierState, move: AdvanceMove, rc: RuntimeCache | null): Element | null {
  const frontier = state.frontier;
  if (!frontier) return null;

  let first = move.first;
  if (!first) {
    first = buildAdvanceFirstFn(move.combinator, move.test);
    move.first = first;
  }

  return first(frontier, rc);
}

export function runBridgeMove(state: FrontierState, move: BridgeMove, canRoot: boolean, rc: RuntimeCache | null): void {
  const candidates = move.lookup(state.root);
  const next = proveBridgeCandidates(candidates, move.proof, state.frontier, rc);
  updateFrontierState(state, next, canRoot);
}

export function runFirstBridgeMove(state: FrontierState, move: BridgeMove, rc: RuntimeCache | null): Element | null {
  const candidates = move.lookup(state.root);

  for (let i = 0; i < candidates.length; i++) {
    const e = candidates[i];

    if (move.proof(e, state.frontier, rc)) {
      return e;
    }
  }

  return null;
}

function updateFrontierState(state: FrontierState, frontier: Element[], canRoot: boolean): void {
  state.frontier = frontier;

  if (canRoot && frontier.length === 1) {
    state.root = frontier[0];
  }
}

function proveBridgeCandidates(candidates: Element[], proof: ProofFn, frontier: Element[] | null, rc: RuntimeCache | null): Element[] {
  const out: Element[] = [];
  let j = -1;

  for (let i = 0; i < candidates.length; i++) {
    const e = candidates[i];
    if (proof(e, frontier, rc)) out[++j] = e;
  }

  return out;
}

function chooseBridgeTarget(chain: Chain, from: number): number {
  const start = from + 1;
  const last = chain.length - 1;

  for (let i = start; i <= last; i++) {
    if (chain[i].right.compound.id) return i;
  }

  for (let i = start; i <= last; i++) {
    if (chain[i].right.compound.classes?.length) return i;
  }

  return last;
}

function buildBridgeMove(chain: Chain, from: number, to: number, snap: Snapshot): BridgeMove {
  const compound = chain[to].right.compound;
  const lookup = buildLookup(compound, snap);

  markLookupSeed(compound);
  try {
    const move: BridgeMove = {
      from, to, lookup, proof: buildProof(chain, from, to, snap),
    };
    if (snap.isDebug) {
      move.debug = `${describeBridgeMove(move)} · lookup ${describeLookup(compound)}`;
    }
    return move;
  } finally {
    resetCompoundSeeds(compound);
  }
}

function markLookupSeed(compound: CompoundSelector): void {
  if (compound.id) {
    compound.id.seed = true;
  } else if (compound.classes?.length) {
    for (let i = 0; i < compound.classes.length; i++) {
      compound.classes[i].seed = true;
    }
  } else if (compound.tag) {
    const { prefixRaw } = compound.tag;

    // seedsByTag is a localName superset. Explicit empty namespace selectors
    // like |tag and |* still need the residual namespace/type test.
    if (prefixRaw !== '') {
      compound.tag.seed = true;
    }
  }
}

function resetCompoundSeeds(compound: CompoundSelector): void {
  if (compound.id) compound.id.seed = false;
  if (compound.tag) compound.tag.seed = false;

  if (compound.classes) {
    for (let i = 0; i < compound.classes.length; i++) {
      compound.classes[i].seed = false;
    }
  }
}

function buildLookup(compound: CompoundSelector, snap: Snapshot): LookupFn {
  if (compound.id) {
    const id = cssIdentUnescape(compound.id.raw);
    return (root) => snap.seedsById(id, root);
  }

  if (compound.classes?.length) {
    const classes = compound.classes.map((c) => cssIdentUnescape(c.raw));

    if (classes.some((c) => /[\t\n\f\r ]/.test(c))) {
      return () => [];
    }

    return (root) => snap.seedsByClass(classes, root);
  }

  if (compound.tag) {
    const { localRaw } = compound.tag;
    const query = localRaw === '*' ? '*' : cssIdentUnescape(localRaw);
    return (root) => seedsByTag(query, root, snap);
  }

  return (root) => seedsByTag('*', root, snap);
}

export type DebugFrontierProgram = {
  start: DebugFrontierStart;
  steps: DebugFrontierStep[];
};

type DebugFrontierStart = {
  bridge: string;
  count?: number;
};

type DebugFrontierStep = {
  index: number;
  advance: string;
  bridge: string;
  bridgeToEnd: string;
  canRoot: boolean;
  count?: number;
  lookupRoot?: QueryContextDescription;
};

export function describeFrontierProgram(program: FrontierProgram): DebugFrontierProgram {
  const steps: DebugFrontierStep[] = [];
  const last = program.steps.length - 1;

  for (let i = 0; i < last; i++) {
    const step = program.steps[i];

    const dbg: DebugFrontierStep = {
      index: i,
      canRoot: step.canRoot,
      advance: describeAdvanceMove(step.advance),
      bridge: describeBridgeMove(step.bridge),
      bridgeToEnd: describeBridgeMove(step.bridgeToEnd),
      lookupRoot: step.lookupRoot ? describeContext(step.lookupRoot, { preview: false }) : undefined,
    };

    if (step.count !== undefined) {
      dbg.count = step.count;
    }

    steps[steps.length] = dbg;
  }

  const start: DebugFrontierStart = {
    bridge: program.start.debug ?? `bridge entry ➝ ${program.start.to}`,
  };

  if (program.start.count !== undefined) {
    start.count = program.start.count;
  }

  return { start, steps };
}

function describeAdvanceMove(move: AdvanceMove | null | undefined): string {
  if (move === undefined) return 'unbuilt';
  if (move === null) return 'cannot';
  return move.debug ?? `advance ${move.from} ➝ ${move.to}`;
}

function describeBridgeMove(move: BridgeMove | null | undefined): string {
  if (move === undefined) return 'unbuilt';
  if (move === null) return 'cannot';
  return move.debug ?? `bridge ${move.from} ➝ ${move.to}`;
}

export function resetFrontierDebug(program: FrontierProgram): void {
  program.start.count = undefined;

  for (let i = 0; i < program.steps.length; i++) {
    program.steps[i].count = undefined;
    program.steps[i].lookupRoot = undefined;
  }
}
