import type { ComplexSelector, SelectorList } from '../parser/parser';
import type { RuntimeCache } from '../compile/runtimeCache';
import type { FirstRunFn } from './first';
import { precedesByDocPosition } from '../../utils/collections';
import { expandSelectorListForSeeding } from '../planner/lift-seed';
import {
  buildFrontierProgram, canAdvance, describeFrontierProgram, getAdvanceMove, getBridgeToEndMove, resetFrontierDebug,
  runAdvanceMove, runBridgeMove, runFirstAdvanceMove, runFirstBridgeMove,
  type FrontierProgram, type FrontierState,
} from '../planner/frontier';
import { describeComplex, describeElement } from '../debug';
import { buildChain } from '../planner/chain';
import { LOOKUP_VIEW } from '../constants';

export function buildFrontierFirst(list: SelectorList, snap: Snapshot): FirstRunFn {
  const arms = expandSelectorListForSeeding(list);
  const firsts: ArmFirstFn[] = [];

  for (let i = 0; i < arms.length; i++) {
    const arm = arms[i];

    const first = buildArmFn(arm, i, snap);
    firsts[i] = first;

    if (snap.isDebug) {
      updateDebugBuild(snap, i, arm);
    }
  }

  const first: FirstRunFn = (ctx, rc) => {
    return runFirst(firsts, ctx, rc);
  };

  return first;
}

function runFirst(firsts: ArmFirstFn[], ctx: QueryContext, rc: RuntimeCache | null): Element | null {
  let best: Element | null = null;

  for (let i = 0; i < firsts.length; i++) {
    const result = firsts[i](ctx, rc, best);
    if (result) best = result;
  }

  return best;
}

type ArmFirstFn = (ctx: QueryContext, rc: RuntimeCache | null, best: Element | null) => Element | null;

function buildArmFn(complex: ComplexSelector, armIndex: number, snap: Snapshot): ArmFirstFn {
  const chain = buildChain(complex);
  const program = buildFrontierProgram(chain, snap);

  return function First(ctx, rc, best) {
    const result = runFrontierFirstProgram(program, ctx, rc, best, snap);

    if (snap.isDebug) {
      updateDebugRun(snap, armIndex, complex, program, result);
    }

    return result;
  };
}

function runFrontierFirstProgram(program: FrontierProgram, ctx: QueryContext, rc: RuntimeCache | null, best: Element | null, snap: Snapshot): Element | null {
  const isDebug = snap.isDebug;
  if (isDebug) resetFrontierDebug(program);

  const state: FrontierState = {
    root: ctx,
    frontier: null,
  };

  const last = program.steps.length - 1;

  if (program.start.to === last) {
    const found = runFirstBridgeMove(state, program.start, LOOKUP_VIEW, rc, best);
    if (isDebug) program.start.count = found ? 1 : 0;
    return found;
  }

  runBridgeMove(state, program.start, program.steps[program.start.to].canRoot, LOOKUP_VIEW, rc);

  if (isDebug) {
    program.start.count = state.frontier?.length ?? 0;
  }

  if (!state.frontier?.length) return null;

  let index = program.start.to;
  while (index < last) {
    const from = index;
    const step = program.steps[from];

    if (canAdvance(state)) {
      const advance = getAdvanceMove(program, from, snap);

      if (advance) {
        if (isDebug) step.lookupRoot = state.root;

        if (advance.to === last) {
          const found = runFirstAdvanceMove(state, advance, rc);
          if (isDebug) step.count = found ? 1 : 0;

          if (!found) return null;
          if (!best || precedesByDocPosition(found, best)) return found;
          return null;
        }

        runAdvanceMove(state, advance, program.steps[advance.to].canRoot, rc);

        if (isDebug) step.count = state.frontier.length;

        index = advance.to;
        if (!state.frontier.length) return null;
        continue;
      }
    }

    if (isDebug) step.lookupRoot = state.root;
    const bridge = getBridgeToEndMove(program, from, snap);
    const found = runFirstBridgeMove(state, bridge, LOOKUP_VIEW, rc, best);

    if (isDebug) step.count = found ? 1 : 0;

    return found;
  }

  throw new Error(`Unreachable frontier first runner state at step ${index}`);
}

function updateDebugRun(
  snap: Snapshot,
  armIndex: number,
  arm: ComplexSelector,
  program: FrontierProgram,
  result: Element | null,
): void {
  snap.debugFirst?.run.push({
    engine: 'frontier',
    armIndex,
    arm: describeComplex(arm),
    program: describeFrontierProgram(program),
    result: result ? describeElement(result) : null,
  });
}

function updateDebugBuild(
  snap: Snapshot,
  armIndex: number,
  arm: ComplexSelector,
): void {
  snap.debugFirst?.build.push({
    engine: 'frontier',
    usesScope: arm.usesScope === true,
    usesCache: arm.usesCache === true,
    armIndex,
    arm: describeComplex(arm),
  });

  snap.debugCompile = undefined;
}
