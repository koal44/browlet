import type { DOMQueryRoot as QuerySource, DOMElement as Element } from '../../infra/index';
import type { SelectorList } from '../parser/parser';
import type { RuntimeCache } from '../compile/runtimeCache';
import type { SelectRunFn } from './select';
import { mergeDocumentOrderLists } from '../collections';
import { describeElements } from '../debug';
import { filterBridgeCandidates } from '../planner/bridge';
import { buildFullBridgeGroups, type FullBridgeGroup } from '../planner/fullbridge-groups';
import { LOOKUP_COPY } from '../constants';
import type { SelectletContext } from '../context';

export function buildFullBridgeSelect(list: SelectorList, ctx: SelectletContext): SelectRunFn {
  const arms = list.arms;
  const groups = buildFullBridgeGroups(arms, ctx);

  if (ctx.isDebug) {
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i]!;
      updateDebugBuild(ctx, group);
    }
  }

  return function FullBridgeSelect(source, rc) {
    return runFullBridgeSelect(groups, source, rc, ctx);
  };
}

function runFullBridgeSelect(
  groups: FullBridgeGroup[],
  source: QuerySource,
  rc: RuntimeCache | null,
  ctx: SelectletContext,
): Element[] {
  const isDebug = ctx.isDebug;

  if (groups.length === 1) {
    const group = groups[0]!;
    const candidates = group.bridge.lookup(source, LOOKUP_COPY);
    const results = filterBridgeCandidates(candidates, group.bridge.proof, null, rc);

    if (isDebug) updateDebugRun(ctx, group, candidates, results);

    return results;
  }

  const lists: Element[][] = [];
  let i = 0;

  for (let k = 0; k < groups.length; k++) {
    const group = groups[k]!;
    const candidates = group.bridge.lookup(source, LOOKUP_COPY);
    const results = filterBridgeCandidates(candidates, group.bridge.proof, null, rc);

    if (results.length) lists[i++] = results;
    if (isDebug) updateDebugRun(ctx, group, candidates, results);
  }

  return mergeDocumentOrderLists(lists, ctx.dom);
}

function updateDebugRun(
  ctx: SelectletContext,
  group: FullBridgeGroup,
  candidates: Iterable<Element>,
  results: Element[],
): void {
  ctx.debugSelect?.run.push({
    engine: 'full-bridge',
    lookupStrategy: group.lookup.strategy,
    lookupQuery: group.lookup.lookupQuery,
    bridge: group.bridge.debug,
    candidates: describeElements(candidates, undefined, ctx.dom),
    results: describeElements(results, undefined, ctx.dom),
  });
}

function updateDebugBuild(
  ctx: SelectletContext,
  group: FullBridgeGroup,
): void {
  ctx.debugSelect?.build.push({
    engine: 'full-bridge',
    usesScope: group.usesScope,
    usesCache: group.usesCache,
    usesHost: group.usesHost,
    lookupStrategy: group.lookup.strategy,
    lookupQuery: group.lookup.lookupQuery,
    cost: group.cost,
    bridge: group.bridge.debug,
  });

  ctx.debugCompile = undefined;
}
