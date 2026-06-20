import type { ComplexSelector, SelectorList } from '../parser/parser';
import type { RuntimeCache } from '../compile/runtimeCache';
import type { SelectRunFn } from './select';
import { mergeDocumentOrderLists } from '../../utils/collections';
import { expandSelectorListForSeeding } from '../planner/lift-seed';
import {
  buildFrontierProgram, canAdvance, describeFrontierProgram, getAdvanceMove, getBridgeMove, resetFrontierDebug, runAdvanceMove, runBridgeMove, type FrontierProgram, type FrontierState,
} from '../planner/frontier';
import { describeComplex, describeElements } from '../debug';
import { buildChain } from '../planner/chain';
import { LOOKUP_COPY } from '../constants';

export function buildFrontierSelect(list: SelectorList, snap: Snapshot): SelectRunFn {
  const arms = expandSelectorListForSeeding(list);
  const selects: ArmSelectFn[] = [];

  for (let i = 0; i < arms.length; i++) {
    const arm = arms[i];

    const select = buildArmFn(arm, i, snap);
    selects[i] = select;

    if (snap.isDebug) {
      updateDebugBuild(snap, i, arm);
    }
  }

  return function Select(ctx, rc) {
    return runSelect(selects, ctx, rc);
  };
}

function runSelect(selects: ArmSelectFn[], ctx: QueryContext, rc: RuntimeCache | null): Element[] {
  if (selects.length === 1) {
    return selects[0](ctx, rc);
  }

  const lists: Element[][] = [];
  let i = 0;

  for (let k = 0; k < selects.length; k++) {
    const results = selects[k](ctx, rc);
    if (results.length) lists[i++] = results;
  }

  return mergeDocumentOrderLists(lists);
}

type ArmSelectFn = (ctx: QueryContext, rc: RuntimeCache | null) => Element[];

function buildArmFn(complex: ComplexSelector, armIndex: number, snap: Snapshot): ArmSelectFn {
  const chain = buildChain(complex);
  const program = buildFrontierProgram(chain, snap);

  return function Select(ctx, rc) {
    const results = runFrontierProgram(program, ctx, rc, snap);

    if (snap.isDebug) {
      updateDebugRun(snap, armIndex, complex, program, results);
    }

    return results;
  };
}

function runFrontierProgram(program: FrontierProgram, ctx: QueryContext, rc: RuntimeCache | null, snap: Snapshot): Element[] {
  const isDebug = snap.isDebug;
  if (isDebug) resetFrontierDebug(program);

  const state: FrontierState = {
    root: ctx,
    frontier: null,
  };

  runBridgeMove(state, program.start, program.steps[program.start.to].canRoot, LOOKUP_COPY, rc);

  if (isDebug) {
    program.start.count = state.frontier?.length ?? 0;
  }

  if (!state.frontier?.length) return [];

  let index = program.start.to;
  const last = program.steps.length - 1;

  while (index < last) {
    const from = index;
    const step = program.steps[from];

    if (canAdvance(state)) {
      const advance = getAdvanceMove(program, from, snap);

      if (advance) {
        if (isDebug) step.lookupRoot = state.root;

        runAdvanceMove(state, advance, program.steps[advance.to].canRoot, rc);

        if (isDebug) step.count = state.frontier.length;

        index = advance.to;
        if (!state.frontier.length) return [];
        continue;
      }
    }

    const bridge = getBridgeMove(program, from, snap);
    if (!bridge) break;

    if (isDebug) step.lookupRoot = state.root;

    runBridgeMove(state, bridge, program.steps[bridge.to].canRoot, LOOKUP_COPY, rc);

    if (isDebug) step.count = state.frontier.length;

    index = bridge.to;
    if (!state.frontier.length) return [];
  }

  return state.frontier;
}

function updateDebugRun(
  snap: Snapshot,
  armIndex: number,
  arm: ComplexSelector,
  program: FrontierProgram,
  results: Element[],
): void {
  snap.debugSelect?.run.push({
    engine: 'frontier',
    armIndex,
    arm: describeComplex(arm),
    program: describeFrontierProgram(program),
    results: describeElements(results),
  });
}

function updateDebugBuild(
  snap: Snapshot,
  armIndex: number,
  arm: ComplexSelector,
): void {
  snap.debugSelect?.build.push({
    engine: 'frontier',
    usesScope: arm.usesScope === true,
    usesCache: arm.usesCache === true,
    armIndex,
    arm: describeComplex(arm),
  });

  snap.debugCompile = undefined;
}
