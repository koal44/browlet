import type { ComplexSelector } from '../parser/parser';
import { buildLookupPlan, buildMultiBridgeMove, sameLookupPlan, type LookupPlan, type MultiBridgeMove } from './bridge';
import { buildChain, type Chain } from './chain';

export function buildFullBridgeGroups(arms: ComplexSelector[], snap: Snapshot): FullBridgeGroup[] {
  const drafts = buildFullBridgeDrafts(arms, snap);
  drafts.sort(compareFullBridgeDrafts);
  const groups = finalizeFullBridgeDrafts(drafts, snap);
  return groups;
}

type PlannedChain = {
  chain: Chain;
  cost: number;
};

type FullBridgeDraft = {
  lookup: LookupPlan;
  chains: PlannedChain[];
  cost: number;
  usesScope: boolean;
  usesCache: boolean;
  usesHost: boolean;
};

export type FullBridgeGroup = {
  lookup: LookupPlan;
  bridge: MultiBridgeMove;
  cost: number;
  usesScope: boolean;
  usesCache: boolean;
  usesHost: boolean;
};

function buildFullBridgeDrafts(arms: ComplexSelector[], snap: Snapshot): FullBridgeDraft[] {
  arms.sort((a, b) => a.cost - b.cost);

  const drafts: FullBridgeDraft[] = [];

  for (let i = 0; i < arms.length; i++) {
    const arm = arms[i]!;
    const chain = buildChain(arm);
    const relation = chain[chain.length - 1]!;
    const last = relation.right.compound;
    const lookup = buildLookupPlan(last, snap);

    let draft: FullBridgeDraft | undefined;

    for (let j = 0; j < drafts.length; j++) {
      const d = drafts[j]!;
      if (sameLookupPlan(d.lookup, lookup)) {
        draft = d;
        break;
      }
    }

    const planned: PlannedChain = {
      chain,
      cost: arm.cost,
    };

    if (draft) {
      draft.chains.push(planned);
      draft.cost += arm.cost;
      draft.usesScope ||= arm.usesScope === true;
      draft.usesCache ||= arm.usesCache === true;
      draft.usesHost ||= arm.usesHost === true;
      continue;
    }

    drafts.push({
      lookup,
      chains: [planned],
      cost: arm.cost,
      usesScope: arm.usesScope === true,
      usesCache: arm.usesCache === true,
      usesHost: arm.usesHost === true,
    });
  }

  return drafts;
}

function finalizeFullBridgeDrafts(drafts: FullBridgeDraft[], snap: Snapshot): FullBridgeGroup[] {
  const groups: FullBridgeGroup[] = [];

  for (let i = 0; i < drafts.length; i++) {
    const draft = drafts[i]!;

    draft.chains.sort((a, b) => a.cost - b.cost);

    const chains: Chain[] = [];
    for (let j = 0; j < draft.chains.length; j++) {
      const planned = draft.chains[j]!;
      chains[j] = planned.chain;
    }

    groups[i] = {
      lookup: draft.lookup,
      bridge: buildMultiBridgeMove(chains, snap),
      cost: draft.cost,
      usesScope: draft.usesScope,
      usesCache: draft.usesCache,
      usesHost: draft.usesHost,
    };
  }

  return groups;
}

function compareFullBridgeDrafts(a: FullBridgeDraft, b: FullBridgeDraft): number {
  return lookupStrategyRank(a.lookup.strategy) - lookupStrategyRank(b.lookup.strategy)
    || a.cost - b.cost;
}

function lookupStrategyRank(strategy: LookupPlan['strategy']): number {
  switch (strategy) {
    case 'id': return 0;
    case 'class': return 1;
    case 'tag': return 2;
    case 'walk': return 3;
  }
}
