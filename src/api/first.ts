import type { Filter } from '../planner/filter';
import { parseSelectorList, type SelectorList } from '../parser/parser';
import { precedesByDocPosition } from '../utils/collections';
import { describeContext, describeElement, describeElements, type QueryContextDescription } from '../utils/debug';
import { planCandidateGroups, type CandidateGroupPlan } from '../planner/candidates';
import type { RuntimeCache } from '../compile/runtimeCache';

export function queryFirst(selectors: string, ctx: QueryContext, snap: Snapshot): Element | null {
  snap.probe.first++;

  const isDebug = snap.isDebug;
  if (isDebug) initDebug(snap, selectors, ctx);

  let resolver = snap.firstResolvers.get(selectors);
  if (!resolver) {
    const parsed = parseSelectorList(selectors, { pseudos: snap.pseudos });
    resolver = buildFirstResolver(parsed, snap);
    snap.firstResolvers.set(selectors, resolver);
    snap.cacheSize++;
  }

  snap.update(ctx, resolver.usesScope);

  let rc: RuntimeCache | null = null;
  if (resolver.usesCache) {
    snap.syncRuntimeCache(ctx);
    rc = snap.runtimeCache;
  }

  const groups = resolver.groups;

  if (groups.length === 1) {
    const group = groups[0];
    const candidates = group.plan.candidates.lookup(ctx);
    const found = group.first(candidates, rc);

    if (isDebug) {
      updateDebugRun(snap, group, candidates, found);
      updateDebugResult(snap, found);
    }

    return found;
  }

  let best: Element | null = null;

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const candidates = group.plan.candidates.lookup(ctx);
    const found = group.first(candidates, rc);

    if (isDebug) updateDebugRun(snap, group, candidates, found);

    if (!found) continue;
    if (!best || precedesByDocPosition(found, best)) best = found;
  }

  if (isDebug) updateDebugResult(snap, best);

  return best;
}

export type FirstResolver = {
  groups: FirstGroup[];
  usesScope: boolean;
  usesCache: boolean;
};

type FirstGroup = {
  plan: CandidateGroupPlan;
  first: FirstFn;
};

function buildFirstResolver(list: SelectorList, snap: Snapshot): FirstResolver {
  snap.checkCacheWatermark();
  snap.probe.firstBuild++;

  const plans = planCandidateGroups(list, snap);
  const groups: FirstGroup[] = [];

  let usesScope = false;
  let usesCache = false;

  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    usesScope ||= plan.filter.usesScope;
    usesCache ||= plan.filter.usesCache;

    const first = compileFirst(plan.filter, snap);
    const group: FirstGroup = { plan, first };

    groups[i] = group;

    if (snap.isDebug) {
      updateDebugBuild(snap, plan, first);
    }
  }

  return { groups, usesScope, usesCache };
}

type FirstFn = (candidates: Element[], rc: RuntimeCache | null) => Element | null;

function compileFirst(filter: Filter, snap: Snapshot): FirstFn {
  const f =
    `"use strict";` +
    filter.declarations.join('') +
    `return function First(c,rc){` +
      `var e,k=-1;` +
      `while((e=c[++k])){` +
        `if(${filter.source}){` +
          `return e;` +
        `}` +
      `}` +
      `return null;` +
    `}`;

  if (snap.isDebug) snap.debugCompile = f;

  // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
  return Function('s', f)(snap) as FirstFn;
}

export type DebugFirst = {
  kind: 'first';
  selectors: string;
  context?: QueryContextDescription;
  build: {
    usesScope: boolean;
    usesCache: boolean;
    strategy: string;
    lookupQuery: string;
    filterCost: number;
    firstSrcText: string;
  }[];
  run: {
    strategy: string;
    lookupQuery: string;
    candidates: string[];
    firstSrcText: string;
    result: string | null;
  }[];
  result?: string | null;
  error?: string;
};

function initDebug(snap: Snapshot, sel: string, ctx: QueryContext): void {
  snap.debugStack.length = 0;

  const dbgFirst: DebugFirst = {
    kind: 'first',
    selectors: sel,
    context: describeContext(ctx),
    build: [],
    run: [],
  };

  snap.debugFirst = dbgFirst;
  snap.debugStack.push(dbgFirst);
}

function updateDebugBuild(
  snap: Snapshot,
  plan: CandidateGroupPlan,
  first: FirstFn,
): void {
  snap.debugFirst?.build.push({
    usesScope: plan.filter.usesScope === true,
    usesCache: plan.filter.usesCache === true,
    strategy: plan.candidates.strategy,
    lookupQuery: plan.candidates.lookupQuery,
    filterCost: plan.filter.cost,
    firstSrcText: snap.debugCompile ?? first.toString(),
  });

  snap.debugCompile = undefined;
}

function updateDebugRun(
  snap: Snapshot,
  group: FirstGroup,
  candidates: Element[],
  result: Element | null,
): void {
  snap.debugFirst?.run.push({
    strategy: group.plan.candidates.strategy,
    lookupQuery: group.plan.candidates.lookupQuery,
    candidates: describeElements(candidates),
    firstSrcText: String(group.first),
    result: result ? describeElement(result) : null,
  });
}

function updateDebugResult(snap: Snapshot, result: Element | null): void {
  if (snap.debugFirst) {
    snap.debugFirst.result = result ? describeElement(result) : null;
  }
}
