import type { ComplexSelector, SelectorList } from '../parser/parser';
import type { RuntimeCache } from '../compile/runtimeCache';
import type { SelectRunFn } from './select';
import { mergeDocumentOrderLists } from '../utils/collections';
import { describeElements } from '../utils/debug';
import { expandSelectorListForSeeding } from '../planner/pseudo-lift';
import { buildChain, type Chain } from '../planner/chain';
import {
  buildLookupPlan, buildMultiBridgeMove, proveBridgeCandidates, sameLookupPlan,
  type LookupPlan, type MultiBridgeMove,
} from '../planner/bridge';

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
};

type FullBridgeGroup = {
  lookup: LookupPlan;
  bridge: MultiBridgeMove;
  cost: number;
  usesScope: boolean;
  usesCache: boolean;
};

export function buildFullBridgeSelect(list: SelectorList, snap: Snapshot): SelectRunFn {
  const arms = expandSelectorListForSeeding(list);
  const drafts = buildFullBridgeDrafts(arms, snap);

  drafts.sort(compareFullBridgeDrafts);

  const groups = finalizeFullBridgeDrafts(drafts, snap);

  if (snap.isDebug) {
    for (let i = 0; i < groups.length; i++) {
      updateDebugBuild(snap, groups[i]);
    }
  }

  return function FullBridgeSelect(ctx, rc) {
    return runFullBridgeSelect(groups, ctx, rc, snap);
  };
}

function buildFullBridgeDrafts(arms: ComplexSelector[], snap: Snapshot): FullBridgeDraft[] {
  arms.sort((a, b) => a.cost - b.cost);

  const drafts: FullBridgeDraft[] = [];

  for (let i = 0; i < arms.length; i++) {
    const arm = arms[i];
    const chain = buildChain(arm);
    const last = chain[chain.length - 1].right.compound;
    const lookup = buildLookupPlan(last, snap);

    let draft: FullBridgeDraft | undefined;

    for (let j = 0; j < drafts.length; j++) {
      const d = drafts[j];
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
      continue;
    }

    drafts.push({
      lookup,
      chains: [planned],
      cost: arm.cost,
      usesScope: arm.usesScope === true,
      usesCache: arm.usesCache === true,
    });
  }

  return drafts;
}

function finalizeFullBridgeDrafts(drafts: FullBridgeDraft[], snap: Snapshot): FullBridgeGroup[] {
  const groups: FullBridgeGroup[] = [];

  for (let i = 0; i < drafts.length; i++) {
    const draft = drafts[i];

    draft.chains.sort((a, b) => a.cost - b.cost);

    const chains: Chain[] = [];
    for (let j = 0; j < draft.chains.length; j++) {
      chains[j] = draft.chains[j].chain;
    }

    groups[i] = {
      lookup: draft.lookup,
      bridge: buildMultiBridgeMove(chains, snap),
      cost: draft.cost,
      usesScope: draft.usesScope,
      usesCache: draft.usesCache,
    };
  }

  return groups;
}

function runFullBridgeSelect(
  groups: FullBridgeGroup[],
  ctx: QueryContext,
  rc: RuntimeCache | null,
  snap: Snapshot,
): Element[] {
  const isDebug = snap.isDebug;

  if (groups.length === 1) {
    const group = groups[0];
    const candidates = group.bridge.lookup(ctx);
    const results = proveBridgeCandidates(candidates, group.bridge.proof, null, rc);

    if (isDebug) updateDebugRun(snap, group, candidates, results);

    return results;
  }

  const lists: Element[][] = [];
  let i = 0;

  for (let k = 0; k < groups.length; k++) {
    const group = groups[k];
    const candidates = group.bridge.lookup(ctx);
    const results = proveBridgeCandidates(candidates, group.bridge.proof, null, rc);

    if (results.length) lists[i++] = results;
    if (isDebug) updateDebugRun(snap, group, candidates, results);
  }

  return mergeDocumentOrderLists(lists);
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

function updateDebugRun(
  snap: Snapshot,
  group: FullBridgeGroup,
  candidates: Element[],
  results: Element[],
): void {
  snap.debugSelect?.run.push({
    engine: 'full-bridge',
    lookupStrategy: group.lookup.strategy,
    lookupQuery: group.lookup.lookupQuery,
    bridge: group.bridge.debug,
    candidates: describeElements(candidates),
    results: describeElements(results),
  });
}

function updateDebugBuild(
  snap: Snapshot,
  group: FullBridgeGroup,
): void {
  snap.debugSelect?.build.push({
    engine: 'full-bridge',
    usesScope: group.usesScope,
    usesCache: group.usesCache,
    lookupStrategy: group.lookup.strategy,
    lookupQuery: group.lookup.lookupQuery,
    cost: group.cost,
    bridge: group.bridge.debug,
  });

  snap.debugCompile = undefined;
}
