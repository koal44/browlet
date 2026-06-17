import type { SelectorList } from '../parser/parser';
import type { RuntimeCache } from '../compile/runtimeCache';
import type { SelectRunFn } from './select';
import { mergeDocumentOrderLists } from '../utils/collections';
import { describeElements } from '../utils/debug';
import { expandSelectorListForSeeding } from '../planner/lift-seed';
import { filterBridgeCandidates } from '../planner/bridge';
import { buildFullBridgeGroups, type FullBridgeGroup } from '../planner/fullbridge-groups';
import { LOOKUP_COPY } from '../constants';

export function buildFullBridgeSelect(list: SelectorList, snap: Snapshot): SelectRunFn {
  const arms = expandSelectorListForSeeding(list);
  const groups = buildFullBridgeGroups(arms, snap);

  if (snap.isDebug) {
    for (let i = 0; i < groups.length; i++) {
      updateDebugBuild(snap, groups[i]);
    }
  }

  return function FullBridgeSelect(ctx, rc) {
    return runFullBridgeSelect(groups, ctx, rc, snap);
  };
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
    const candidates = group.bridge.lookup(ctx, LOOKUP_COPY);
    const results = filterBridgeCandidates(candidates, group.bridge.proof, null, rc);

    if (isDebug) updateDebugRun(snap, group, candidates, results);

    return results;
  }

  const lists: Element[][] = [];
  let i = 0;

  for (let k = 0; k < groups.length; k++) {
    const group = groups[k];
    const candidates = group.bridge.lookup(ctx, LOOKUP_COPY);
    const results = filterBridgeCandidates(candidates, group.bridge.proof, null, rc);

    if (results.length) lists[i++] = results;
    if (isDebug) updateDebugRun(snap, group, candidates, results);
  }

  return mergeDocumentOrderLists(lists);
}

function updateDebugRun(
  snap: Snapshot,
  group: FullBridgeGroup,
  candidates: Iterable<Element>,
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
