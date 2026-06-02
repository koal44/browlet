import type { Filter } from '../planner/filter';
import { parseSelectorList, type SelectorList } from '../parser/parser';
import { mergeDocumentOrderLists } from '../utils/collections';
import { describeContext, describeElements, type QueryContextDescription } from '../utils/util';
import { planCandidateGroups, type CandidateGroupPlan } from '../planner/candidates';
import type { RuntimeCache } from '../compile/runtimeCache';

export function querySelect(sel: string, ctx: QueryContext, snap: Snapshot): Element[] {
  snap.probe.select++;
  const isDebug = snap.isDebug;
  if (isDebug) initDebug(snap, sel, ctx);

  let resolver = snap.selectResolvers.get(sel);
  if (!resolver) {
    const parsed = parseSelectorList(sel, { pseudos: snap.pseudos });
    resolver = buildSelectResolver(parsed, snap);
    snap.selectResolvers.set(sel, resolver);
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
    const results = group.select(candidates, rc);

    if (isDebug) updateDebugRun(snap, group, candidates, results);

    return results;
  }

  const lists: Element[][] = [];
  let i = 0;

  for (let k = 0; k < groups.length; k++) {
    const group = groups[k];
    const candidates = group.plan.candidates.lookup(ctx);
    const results = group.select(candidates, rc);

    if (results.length) lists[i++] = results;
    if (isDebug) updateDebugRun(snap, group, candidates, results);
  }

  return mergeDocumentOrderLists(lists);
}

export type SelectResolver = {
  groups: SelectGroup[];
  usesScope: boolean;
  usesCache: boolean;
};

type SelectGroup = {
  plan: CandidateGroupPlan;
  select: SelectFn;
};

function buildSelectResolver(list: SelectorList, snap: Snapshot): SelectResolver {
  snap.checkCacheWatermark();
  snap.probe.selBuild++;

  const plans = planCandidateGroups(list, snap);
  const groups: SelectGroup[] = [];

  let usesScope = false;
  let usesCache = false;

  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    usesScope ||= plan.filter.usesScope;
    usesCache ||= plan.filter.usesCache;

    const select = compileSelect(plan.filter, snap);
    const group: SelectGroup = { plan, select };

    groups[i] = group;

    if (snap.isDebug) {
      updateDebugBuild(snap, plan, select);
    }
  }

  return { groups, usesScope, usesCache };
}

type SelectFn = (candidates: Element[], rc: RuntimeCache | null) => Element[];

function compileSelect(filter: Filter, snap: Snapshot): SelectFn {
  const f =
    `"use strict";` +
    filter.declarations.join('') +
    `return function Select(c,rc){` +
      `var e,k=-1,j=-1,r=[];` +
      `while((e=c[++k])){` +
        `if(${filter.source}){` +
          `r[++j]=e;` +
        `}` +
      `}` +
      `return r;` +
    `}`;

  if (snap.isDebug) snap.debugCompile = f;

  // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
  return Function('s', f)(snap) as SelectFn;
}

export type DebugSelect = {
  kind: 'select';
  selectors: string;
  context?: QueryContextDescription;
  build: {
    usesScope: boolean;
    usesCache: boolean;
    strategy: string;
    lookupQuery: string;
    filterCost: number;
    selectSrcText: string;
  }[];
  run: {
    strategy: string;
    lookupQuery: string;
    candidates: string[];
    selectSrcText: string;
    results: string[];
  }[];
  error?: string;
};

function initDebug(snap: Snapshot, sel: string, ctx: QueryContext): void {
  snap.debugStack.length = 0;
  const dbgSelect: DebugSelect = {
    kind: 'select',
    selectors: sel,
    context: describeContext(ctx),
    build: [],
    run: [],
  };
  snap.debugSelect = dbgSelect;
  snap.debugStack.push(dbgSelect);
}

function updateDebugRun(
  snap: Snapshot,
  group: SelectGroup,
  candidates: Element[],
  results: Element[],
): void {
  snap.debugSelect?.run.push({
    strategy: group.plan.candidates.strategy,
    lookupQuery: group.plan.candidates.lookupQuery,
    candidates: describeElements(candidates),
    selectSrcText: String(group.select),
    results: describeElements(results),
  });
}

function updateDebugBuild(
  snap: Snapshot,
  plan: CandidateGroupPlan,
  select: SelectFn,
): void {
  snap.debugSelect?.build.push({
    usesScope: plan.filter.usesScope === true,
    usesCache: plan.filter.usesCache === true,
    strategy: plan.candidates.strategy,
    lookupQuery: plan.candidates.lookupQuery,
    filterCost: plan.filter.cost,
    selectSrcText: snap.debugCompile ?? select.toString(),
  });

  snap.debugCompile = undefined;
}
