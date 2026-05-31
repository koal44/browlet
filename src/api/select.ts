import type { Filter } from '../planner/filter';
import type { HashCache } from '../compile/runtime';
import { parseSelectorList, type SelectorList } from '../parser/parser';
import { mergeDocumentOrderLists } from '../utils/collections';
import { describeContext, describeElements, type QueryContextDescription } from '../utils/util';
import { planCandidateGroups, type CandidateGroupPlan } from '../planner/candidates';

export function querySelect(sel: string, ctx: QueryContext, snap: Snapshot, isApiEntry = false): Element[] {
  snap.probe.select++;
  const isDebug = snap.isDebug;
  if (isDebug) initDebug(snap, sel, ctx, isApiEntry);

  let resolver = snap.selectResolvers.get(sel);
  if (!resolver) {
    const parsed = parseSelectorList(sel, { pseudos: snap.pseudos });
    resolver = buildSelectResolver(parsed, snap);
    snap.selectResolvers.set(sel, resolver);
    snap.cacheSize++;
  }

  snap.update(ctx, isApiEntry && resolver.usesScope);

  const cache: HashCache = {};
  const groups = resolver.groups;

  if (groups.length === 1) {
    const group = groups[0];
    const candidates = group.plan.candidates.lookup(ctx);
    const results = group.select(candidates, cache);

    if (isDebug) updateDebugRun(snap, group, candidates, results);

    return results;
  }

  const lists: Element[][] = [];
  let i = 0;

  for (let k = 0; k < groups.length; k++) {
    const group = groups[k];
    const candidates = group.plan.candidates.lookup(ctx);
    const results = group.select(candidates, cache);

    if (results.length) lists[i++] = results;
    if (isDebug) updateDebugRun(snap, group, candidates, results);
  }

  return mergeDocumentOrderLists(lists);
}

export type SelectResolver = {
  groups: SelectGroup[];
  usesScope: boolean;
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

  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    usesScope ||= plan.filter.usesScope;

    const select = compileSelect(plan.filter, snap);
    const group: SelectGroup = { plan, select };

    groups[i] = group;

    if (snap.isDebug) {
      updateDebugBuild(snap, plan, select);
    }
  }

  return { groups, usesScope };
}

type SelectFn = (candidates: Element[], h: HashCache) => Element[];

function compileSelect(filter: Filter, snap: Snapshot): SelectFn {
  const f =
    `"use strict";` +
    filter.declarations.join('') +
    `return function Select(c,h){` +
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
  isApiEntry: boolean;
  selectors: string;
  context?: QueryContextDescription;
  build: {
    usesScope: boolean;
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

function initDebug(snap: Snapshot, sel: string, ctx: QueryContext, isApiEntry: boolean): void {
  if (isApiEntry) snap.debugStack.length = 0;
  const dbgSelect: DebugSelect = {
    kind: 'select',
    isApiEntry,
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
    strategy: plan.candidates.strategy,
    lookupQuery: plan.candidates.lookupQuery,
    filterCost: plan.filter.cost,
    selectSrcText: snap.debugCompile ?? select.toString(),
  });

  snap.debugCompile = undefined;
}
