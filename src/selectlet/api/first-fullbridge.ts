import type { SelectorList } from '../parser/parser';
import type { RuntimeCache } from '../compile/runtimeCache';
import type { FirstRunFn } from './first';
import { describeElement, describeElements } from '../debug';
import { findFirstBridgeCandidate } from '../planner/bridge';
import { buildFullBridgeGroups, type FullBridgeGroup } from '../planner/fullbridge-groups';
import { LOOKUP_VIEW } from '../constants';

export function buildFullBridgeFirst(list: SelectorList, snap: Snapshot): FirstRunFn {
  const arms = list.arms;
  const groups = buildFullBridgeGroups(arms, snap);

  if (snap.isDebug) {
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i]!;
      updateDebugBuild(snap, group);
    }
  }

  return function FullBridgeFirst(ctx, rc) {
    return runFullBridgeFirst(groups, ctx, rc, snap);
  };
}

function runFullBridgeFirst(groups: FullBridgeGroup[], ctx: QueryContext, rc: RuntimeCache | null, snap: Snapshot): Element | null {
  const isDebug = snap.isDebug;

  const frontier = null;  // frontier is always null for full-bridge
  let best: Element | null = null;

  if (groups.length === 1) {
    const group = groups[0]!;
    const candidates = group.bridge.lookup(ctx, LOOKUP_VIEW);
    const result = findFirstBridgeCandidate(candidates, group.bridge.proof, frontier, rc, best);

    if (isDebug) updateDebugRun(snap, group, candidates, result);

    return result;
  }

  for (let k = 0; k < groups.length; k++) {
    const group = groups[k]!;
    const candidates = group.bridge.lookup(ctx, LOOKUP_VIEW);
    const result = findFirstBridgeCandidate(candidates, group.bridge.proof, frontier, rc, best);

    if (isDebug) updateDebugRun(snap, group, candidates, result);

    if (!result) continue;
    best = result;
  }

  return best;
}

function updateDebugRun(snap: Snapshot, group: FullBridgeGroup, candidates: Iterable<Element>, result: Element | null): void {
  snap.debugFirst?.run.push({
    engine: 'full-bridge',
    lookupStrategy: group.lookup.strategy,
    lookupQuery: group.lookup.lookupQuery,
    bridge: group.bridge.debug,
    candidates: describeElements(candidates),
    result: result ? describeElement(result) : null,
  });
}

function updateDebugBuild(snap: Snapshot, group: FullBridgeGroup): void {
  snap.debugFirst?.build.push({
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
