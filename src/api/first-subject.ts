import type { Filter } from '../planner/filter';
import type { SelectorList } from '../parser/parser';
import { precedesByDocPosition } from '../utils/collections';
import { describeElement, describeElements } from '../utils/debug';
import { planCandidateGroups, type CandidateGroupPlan } from '../planner/candidates';
import type { RuntimeCache } from '../compile/runtimeCache';
import type { FirstRunFn } from './first';

export function buildSubjectFirst(list: SelectorList, snap: Snapshot): FirstRunFn {
  const plans = planCandidateGroups(list, snap);
  const groups: SubjectFirstGroup[] = [];

  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];

    const first = compileSubjectFirst(plan.filter, snap);
    groups[i] = { plan, first };

    if (snap.isDebug) {
      updateDebugBuild(snap, plan, first);
    }
  }

  return function SubjectFirst(ctx, rc, snap) {
    return runSubjectFirst(groups, ctx, rc, snap);
  };
}

type SubjectFirstGroup = {
  plan: CandidateGroupPlan;
  first: SubjectFirstFn;
};

function runSubjectFirst(
  groups: SubjectFirstGroup[],
  ctx: QueryContext,
  rc: RuntimeCache | null,
  snap: Snapshot,
): Element | null {
  const isDebug = snap.isDebug;

  if (groups.length === 1) {
    const group = groups[0];
    const candidates = group.plan.candidates.lookup(ctx);
    const result = group.first(candidates, rc);

    if (isDebug) updateDebugRun(snap, group, candidates, result);

    return result;
  }

  let best: Element | null = null;

  for (let k = 0; k < groups.length; k++) {
    const group = groups[k];
    const candidates = group.plan.candidates.lookup(ctx);
    const result = group.first(candidates, rc);

    if (isDebug) updateDebugRun(snap, group, candidates, result);

    if (!result) continue;
    if (!best || precedesByDocPosition(result, best)) best = result;
  }

  return best;
}

type SubjectFirstFn = (candidates: Element[], rc: RuntimeCache | null) => Element | null;

function compileSubjectFirst(filter: Filter, snap: Snapshot): SubjectFirstFn {
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
  return Function('s', f)(snap) as SubjectFirstFn;
}

function updateDebugRun(
  snap: Snapshot,
  group: SubjectFirstGroup,
  candidates: Element[],
  result: Element | null,
): void {
  snap.debugFirst?.run.push({
    engine: 'subject',
    lookupStrategy: group.plan.candidates.strategy,
    lookupQuery: group.plan.candidates.lookupQuery,
    candidates: describeElements(candidates),
    srcText: String(group.first),
    result: result ? describeElement(result) : null,
  });
}

function updateDebugBuild(
  snap: Snapshot,
  plan: CandidateGroupPlan,
  first: SubjectFirstFn,
): void {
  snap.debugFirst?.build.push({
    engine: 'subject',
    usesScope: plan.filter.usesScope === true,
    usesCache: plan.filter.usesCache === true,
    lookupStrategy: plan.candidates.strategy,
    lookupQuery: plan.candidates.lookupQuery,
    filterCost: plan.filter.cost,
    srcText: snap.debugCompile ?? first.toString(),
  });

  snap.debugCompile = undefined;
}
