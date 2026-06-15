import type { CompoundSelector } from '../parser/parser';
import type { Chain, ProofFn } from './chain';
import { seedsByTag } from '../seeds/seedsByTag';
import { cssIdentUnescape } from '../utils/css';
import { buildMultiChainProof, buildProof } from './chain';
import type { RuntimeCache } from '../compile/runtimeCache';

export type BridgeMove = {
  from: number;
  to: number;
  lookup: LookupFn;
  proof: ProofFn;
  debug?: string;
  count?: number;
};

export type MultiBridgeMove = {
  lookup: LookupFn;
  proof: ProofFn;
  debug?: string;
  count?: number;
};

export type LookupFn = (root: QueryContext) => Element[];

export function buildBridgeMove(chain: Chain, from: number, to: number, snap: Snapshot): BridgeMove {
  const compound = chain[to].right.compound;
  const lookup = buildLookupPlan(compound, snap);

  applyLookupSeed(compound, lookup);
  try {
    const move: BridgeMove = {
      from, to,
      lookup: lookup.lookup,
      proof: buildProof(chain, from, to, snap),
    };

    if (snap.isDebug) {
      move.debug = `${describeBridgeMove(move)} · lookup ${describeLookupPlan(lookup)}`;
    }

    return move;
  } finally {
    resetLookupSeed(compound, lookup);
  }
}

export function buildMultiBridgeMove(chains: Chain[], snap: Snapshot): MultiBridgeMove {
  const compounds: CompoundSelector[] = [];
  const lookups: LookupPlan[] = [];

  const baseCompound = chains[0][chains[0].length - 1].right.compound;
  const baseLookup = buildLookupPlan(baseCompound, snap);

  compounds[0] = baseCompound;
  lookups[0] = baseLookup;

  for (let i = 1; i < chains.length; i++) {
    const chain = chains[i];
    const compound = chain[chain.length - 1].right.compound;
    const lookup = buildLookupPlan(compound, snap);

    if (!sameLookupPlan(baseLookup, lookup)) {
      throw new Error(
        `Cannot build multi-bridge move for mixed lookups: ` +
        `${describeLookupPlan(baseLookup)} vs ${describeLookupPlan(lookup)}`,
      );
    }

    compounds[i] = compound;
    lookups[i] = lookup;
  }

  for (let i = 0; i < compounds.length; i++) {
    applyLookupSeed(compounds[i], lookups[i]);
  }

  try {
    const move: MultiBridgeMove = {
      lookup: baseLookup.lookup,
      proof: buildMultiChainProof(chains, snap),
    };

    if (snap.isDebug) {
      move.debug = `bridge entry ➝ end · lookup ${describeLookupPlan(baseLookup)}`;
    }

    return move;
  } finally {
    for (let i = 0; i < compounds.length; i++) {
      resetLookupSeed(compounds[i], lookups[i]);
    }
  }
}

export function filterBridgeCandidates(candidates: Element[], proof: ProofFn, frontier: Element[] | null, rc: RuntimeCache | null): Element[] {
  const out: Element[] = [];
  let j = -1;

  for (let i = 0; i < candidates.length; i++) {
    const e = candidates[i];
    if (proof(e, frontier, rc)) out[++j] = e;
  }

  return out;
}

export function findFirstBridgeCandidate(candidates: Element[], proof: ProofFn, frontier: Element[] | null, rc: RuntimeCache | null): Element | null {
  for (let i = 0; i < candidates.length; i++) {
    const e = candidates[i];
    if (proof(e, frontier, rc)) return e;
  }

  return null;
}

export function describeBridgeMove(move: BridgeMove | null | undefined): string {
  if (move === undefined) return 'unbuilt';
  if (move === null) return 'cannot';
  return move.debug ?? `bridge ${move.from} ➝ ${move.to}`;
}

export type LookupStrategy = 'id' | 'class' | 'tag' | 'walk';
type LookupSeed = 'id' | 'classes' | 'tag' | null;

export type LookupPlan = {
  strategy: LookupStrategy;
  lookupQuery: string;
  lookup: LookupFn;
  seed: LookupSeed;
};

export function buildLookupPlan(compound: CompoundSelector, snap: Snapshot): LookupPlan {
  if (compound.id) {
    const id = cssIdentUnescape(compound.id.raw);

    return {
      strategy: 'id',
      lookupQuery: id,
      lookup: (root) => snap.seedsById(id, root),
      seed: 'id',
    };
  }

  if (compound.classes?.length) {
    const classes = compound.classes.map((c) => cssIdentUnescape(c.raw));

    if (classes.some((c) => /[\t\n\f\r ]/.test(c))) {
      return {
        strategy: 'class',
        lookupQuery: classes[0] ?? '',
        lookup: () => [],
        seed: null,
      };
    }

    return {
      strategy: 'class',
      lookupQuery: classes.join('.'),
      lookup: (root) => snap.seedsByClass(classes, root),
      seed: 'classes',
    };
  }

  if (compound.tag) {
    const { prefixRaw, localRaw } = compound.tag;
    const query = localRaw === '*' ? '*' : cssIdentUnescape(localRaw);

    return {
      strategy: 'tag',
      lookupQuery: query,
      lookup: (root) => seedsByTag(query, root, snap),
      seed: prefixRaw !== '' ? 'tag' : null,
    };
  }

  return {
    strategy: 'walk',
    lookupQuery: '*',
    lookup: (root) => seedsByTag('*', root, snap),
    seed: null,
  };
}

export function sameLookupPlan(a: LookupPlan, b: LookupPlan): boolean {
  return a.strategy === b.strategy
    && a.lookupQuery === b.lookupQuery;
}

function applyLookupSeed(compound: CompoundSelector, plan: LookupPlan): void {
  switch (plan.seed) {
    case 'id':
      if (compound.id) compound.id.seed = true;
      return;

    case 'classes':
      if (compound.classes) {
        for (let i = 0; i < compound.classes.length; i++) {
          compound.classes[i].seed = true;
        }
      }
      return;

    case 'tag':
      if (compound.tag) compound.tag.seed = true;
      return;

    case null:
      return;
  }
}

function resetLookupSeed(compound: CompoundSelector, plan: LookupPlan): void {
  switch (plan.seed) {
    case 'id':
      if (compound.id) compound.id.seed = false;
      return;

    case 'classes':
      if (compound.classes) {
        for (let i = 0; i < compound.classes.length; i++) {
          compound.classes[i].seed = false;
        }
      }
      return;

    case 'tag':
      if (compound.tag) compound.tag.seed = false;
      return;

    case null:
      return;
  }
}

function describeLookupPlan(plan: LookupPlan): string {
  return `${plan.strategy} ${plan.lookupQuery}`;
}
