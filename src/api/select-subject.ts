import type { Filter } from '../planner/filter';
import type { SelectorList } from '../parser/parser';
import { mergeDocumentOrderLists } from '../utils/collections';
import { describeElements } from '../utils/debug';
import { planCandidateGroups, type CandidateGroupPlan } from '../planner/candidates';
import type { RuntimeCache } from '../compile/runtimeCache';
import type { SelectRunFn } from './select';

export function buildSubjectSelect(list: SelectorList, snap: Snapshot): SelectRunFn {
  const plans = planCandidateGroups(list, snap);
  const groups: SubjectGroup[] = [];

  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];

    const select = compileSubjectSelect(plan.filter, snap);
    groups[i] = { plan, select };

    if (snap.isDebug) {
      updateDebugBuild(snap, plan, select);
    }
  }

  return function SubjectSelect(ctx, rc, snap) {
    return runSubjectSelect(groups, ctx, rc, snap);
  };
}

type SubjectGroup = {
  plan: CandidateGroupPlan;
  select: SubjectSelectFn;
};

function runSubjectSelect(
  groups: SubjectGroup[],
  ctx: QueryContext,
  rc: RuntimeCache | null,
  snap: Snapshot,
): Element[] {
  const isDebug = snap.isDebug;

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

type SubjectSelectFn = (candidates: Element[], rc: RuntimeCache | null) => Element[];

function compileSubjectSelect(filter: Filter, snap: Snapshot): SubjectSelectFn {
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
  return Function('s', f)(snap) as SubjectSelectFn;
}

function updateDebugRun(
  snap: Snapshot,
  group: SubjectGroup,
  candidates: Element[],
  results: Element[],
): void {
  snap.debugSelect?.run.push({
    engine: 'subject',
    lookupStrategy: group.plan.candidates.strategy,
    lookupQuery: group.plan.candidates.lookupQuery,
    candidates: describeElements(candidates),
    srcText: String(group.select),
    results: describeElements(results),
  });
}

function updateDebugBuild(
  snap: Snapshot,
  plan: CandidateGroupPlan,
  select: SubjectSelectFn,
): void {
  snap.debugSelect?.build.push({
    engine: 'subject',
    usesScope: plan.filter.usesScope === true,
    usesCache: plan.filter.usesCache === true,
    lookupStrategy: plan.candidates.strategy,
    lookupQuery: plan.candidates.lookupQuery,
    filterCost: plan.filter.cost,
    srcText: snap.debugCompile ?? select.toString(),
  });

  snap.debugCompile = undefined;
}
