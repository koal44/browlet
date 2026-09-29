import type { DOMNode as QuerySource, DOMNode as Element } from '../../infra/index';
import type { SelectorList } from '../parser/parser';
import type { RuntimeCache } from '../compile/runtimeCache';
import type { FirstRunFn } from './first';
import { describeElement, describeElements } from '../debug';
import { findFirstBridgeCandidate } from '../planner/bridge';
import { buildFullBridgeGroups, type FullBridgeGroup } from '../planner/fullbridge-groups';
import { LOOKUP_VIEW } from '../constants';
import type { SelectletContext } from '../context';

export function buildFullBridgeFirst(list: SelectorList, ctx: SelectletContext): FirstRunFn {
  const arms = list.arms;
  const groups = buildFullBridgeGroups(arms, ctx);

  if (ctx.isDebug) {
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i]!;
      updateDebugBuild(ctx, group);
    }
  }

  return function FullBridgeFirst(source, rc) {
    return runFullBridgeFirst(groups, source, rc, ctx);
  };
}

function runFullBridgeFirst(groups: FullBridgeGroup[], source: QuerySource, rc: RuntimeCache | null, ctx: SelectletContext): Element | null {
  const isDebug = ctx.isDebug;

  const frontier = null;  // frontier is always null for full-bridge
  let best: Element | null = null;

  if (groups.length === 1) {
    const group = groups[0]!;
    const candidates = group.bridge.lookup(source, LOOKUP_VIEW);
    const result = findFirstBridgeCandidate(candidates, group.bridge.proof, frontier, rc, best, ctx.dom);

    if (isDebug) updateDebugRun(ctx, group, candidates, result);

    return result;
  }

  for (let k = 0; k < groups.length; k++) {
    const group = groups[k]!;
    const candidates = group.bridge.lookup(source, LOOKUP_VIEW);
    const result = findFirstBridgeCandidate(candidates, group.bridge.proof, frontier, rc, best, ctx.dom);

    if (isDebug) updateDebugRun(ctx, group, candidates, result);

    if (!result) continue;
    best = result;
  }

  return best;
}

function updateDebugRun(ctx: SelectletContext, group: FullBridgeGroup, candidates: Iterable<Element>, result: Element | null): void {
  ctx.debugFirst?.run.push({
    engine: 'full-bridge',
    lookupStrategy: group.lookup.strategy,
    lookupQuery: group.lookup.lookupQuery,
    bridge: group.bridge.debug,
    candidates: describeElements(candidates, undefined, ctx.dom),
    result: result ? describeElement(result, ctx.dom) : null,
  });
}

function updateDebugBuild(ctx: SelectletContext, group: FullBridgeGroup): void {
  ctx.debugFirst?.build.push({
    engine: 'full-bridge',
    usesScope: group.usesScope,
    usesCache: group.usesCache,
    lookupStrategy: group.lookup.strategy,
    lookupQuery: group.lookup.lookupQuery,
    cost: group.cost,
    bridge: group.bridge.debug,
  });

  ctx.debugCompile = undefined;
}
