import type { CompoundSelector } from '../parser/parser';
import type { Chain, BiProofFn } from './chain';
import { seedsByTag } from '../seeds/seedsByTag';
import { cssIdentUnescape } from '../../utils/css';
import { buildMultiChainBiProof, buildBiProof, buildTriProof, buildMultiChainTriProof } from './chain';
import type { RuntimeCache } from '../compile/runtimeCache';
import { precedesByDocPosition } from '../../utils/collections';
import { SubjectKind, type LookupMode } from '../constants';

export type BridgeMove = {
  from: number;
  to: number;
  lookup: LookupFn;
  proof: BiProofFn;
  debug?: string;
  count?: number;
};

export type MultiBridgeMove = {
  lookup: LookupFn;
  proof: BiProofFn;
  debug?: string;
  count?: number;
};

export type LookupFn = (root: QueryContext, mode: LookupMode) => Iterable<Element>;

export function buildBridgeMove(chain: Chain, from: number, to: number, snap: Snapshot): BridgeMove {
  const compound = chain[to].right.compound;
  const lookup = buildLookupPlan(compound, snap);

  applyLookupSeed(compound, lookup);
  try {
    const move: BridgeMove = {
      from, to,
      lookup: lookup.lookup,
      proof: buildBridgeProof(chain, from, to, snap),
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
      proof: buildMultiBridgeProof(chains, snap),
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

export function filterBridgeCandidates(candidates: Iterable<Element>, proof: BiProofFn, frontier: Element[] | null, rc: RuntimeCache | null): Element[] {
  const out: Element[] = [];
  let j = -1;

  for (const e of candidates) {
    if (proof(e, frontier, rc)) out[++j] = e;
  }

  return out;
}

export function findFirstBridgeCandidate(
  candidates: Iterable<Element>,
  proof: BiProofFn,
  frontier: Element[] | null,
  rc: RuntimeCache | null,
  best: Element | null,
): Element | null {
  for (const e of candidates) {
    if (best && !precedesByDocPosition(e, best)) return null;
    if (proof(e, frontier, rc)) return e;
  }

  return null;
}

// function upperBoundBefore(candidates: ElementSource, best: Element): number {
//   const n = candidates.length;

//   for (let i = 0; i < n && i < 8; i++) {
//     if (!precedesByDocPosition(candidates[i], best)) return i;
//   }

//   let lo = 8;
//   if (lo >= n) return n;

//   if (!precedesByDocPosition(candidates[lo], best)) {
//     let hi = lo;

//     lo = 8;
//     while (lo < hi) {
//       const mid = (lo + hi) >>> 1;

//       if (precedesByDocPosition(candidates[mid], best)) {
//         lo = mid + 1;
//       } else {
//         hi = mid;
//       }
//     }

//     return lo;
//   }

//   let hi = 16;
//   while (hi < n && precedesByDocPosition(candidates[hi], best)) {
//     lo = hi + 1;
//     hi <<= 1;
//   }

//   if (hi > n) hi = n;

//   while (lo < hi) {
//     const mid = (lo + hi) >>> 1;

//     if (precedesByDocPosition(candidates[mid], best)) {
//       lo = mid + 1;
//     } else {
//       hi = mid;
//     }
//   }

//   return lo;
// }

function buildBridgeProof(
  chain: Chain, from: number, to: number, snap: Snapshot,
): BiProofFn {
  if (!chainRangeUsesHost(chain, from, to)) {
    return buildBiProof(chain, from, to, snap);
  }

  const tri = buildTriProof(chain, from, to, snap);

  return (candidate, frontier, rc) =>
    tri(candidate, frontier, rc, SubjectKind.Element) === true;
}

function buildMultiBridgeProof(chains: Chain[], snap: Snapshot): BiProofFn {
  if (!chainsUseHost(chains)) {
    return buildMultiChainBiProof(chains, snap);
  }

  const tri = buildMultiChainTriProof(chains, snap);

  return (candidate, frontier, rc) =>
    tri(candidate, frontier, rc, SubjectKind.Element) === true;
}

function chainsUseHost(chains: Chain[]): boolean {
  for (let i = 0; i < chains.length; i++) {
    const chain = chains[i];

    for (let j = 0; j < chain.length; j++) {
      if (chain[j].right.compound.usesHost) return true;
    }
  }

  return false;
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
      lookup: (root, mode) => snap.seedsById(id, root, mode),
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
      lookup: (root, mode) => snap.seedsByClass(classes, root, mode),
      seed: 'classes',
    };
  }

  if (compound.tag) {
    const { prefixRaw, localRaw } = compound.tag;
    const query = localRaw === '*' ? '*' : cssIdentUnescape(localRaw);

    return {
      strategy: 'tag',
      lookupQuery: query,
      lookup: (root, mode) => seedsByTag(query, root, mode, snap),
      seed: prefixRaw !== '' ? 'tag' : null,
    };
  }

  return {
    strategy: 'walk',
    lookupQuery: '*',
    lookup: (root, mode) => seedsByTag('*', root, mode, snap),
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

function chainRangeUsesHost(chain: Chain, from: number, to: number): boolean {
  for (let i = from + 1; i <= to; i++) {
    if (chain[i].right.compound.usesHost) return true;
  }

  return false;
}
