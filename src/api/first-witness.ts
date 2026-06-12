import type { ComplexSelector, SelectorList } from '../parser/parser';
import type { RuntimeCache } from '../compile/runtimeCache';
import type { FirstRunFn } from './first';
import { precedesByDocPosition } from '../utils/collections';
import { expandSelectorListForSeeding } from '../planner/pseudo-lift';
import {
  buildWitnessProgram, canAdvance, describeWitnessProgram, getAdvanceMove, getFinalBridgeMove, resetWitnessDebug,
  runAdvanceMove, runBridgeMove, runFirstAdvanceMove, runFirstBridgeMove,
  type WitnessProgram, type WitnessState,
} from './witness';
import { describeElement } from '../utils/debug';

export function buildWitnessFirst(list: SelectorList, snap: Snapshot): FirstRunFn {
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

  return function First(ctx, rc, snap) {
    return runFirst(firsts, ctx, rc, snap);
  };
}

function runFirst(firsts: ArmFirstFn[], ctx: QueryContext, rc: RuntimeCache | null, _snap: Snapshot): Element | null {
  if (firsts.length === 1) {
    return firsts[0](ctx, rc);
  }

  let best: Element | null = null;

  for (let i = 0; i < firsts.length; i++) {
    const result = firsts[i](ctx, rc);

    if (!result) continue;
    if (!best || precedesByDocPosition(result, best)) best = result;
  }

  return best;
}

type ArmFirstFn = (ctx: QueryContext, rc: RuntimeCache | null) => Element | null;

function buildArmFn(complex: ComplexSelector, armIndex: number, snap: Snapshot): ArmFirstFn {
  const program = buildWitnessProgram(complex, snap);

  return function First(ctx, rc) {
    const result = runWitnessFirstProgram(program, ctx, rc, snap);

    if (snap.isDebug) {
      updateDebugRun(snap, armIndex, program, result);
    }

    return result;
  };
}

function runWitnessFirstProgram(program: WitnessProgram, ctx: QueryContext, rc: RuntimeCache | null, snap: Snapshot): Element | null {
  const isDebug = snap.isDebug;
  if (isDebug) resetWitnessDebug(program);

  const state: WitnessState = {
    root: ctx,
    witnesses: null,
  };

  const last = program.steps.length - 1;

  if (program.start.to === last) {
    const found = runFirstBridgeMove(state, program.start, rc);
    if (isDebug) program.start.count = found ? 1 : 0;
    return found;
  }

  runBridgeMove(state, program.start, program.steps[program.start.to].canRoot, rc);

  if (isDebug) {
    program.start.count = state.witnesses?.length ?? 0;
  }

  if (!state.witnesses?.length) return null;

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
          return found;
        }

        runAdvanceMove(state, advance, program.steps[advance.to].canRoot, rc);

        if (isDebug) step.count = state.witnesses.length;

        index = advance.to;
        if (!state.witnesses.length) return null;
        continue;
      }
    }

    if (isDebug) step.lookupRoot = state.root;
    const bridge = getFinalBridgeMove(program, from, snap);
    const found = runFirstBridgeMove(state, bridge, rc);

    if (isDebug) step.count = found ? 1 : 0;

    return found;
  }

  throw new Error(`Unreachable witness first runner state at step ${index}`);
}

function updateDebugRun(
  snap: Snapshot,
  armIndex: number,
  program: WitnessProgram,
  result: Element | null,
): void {
  snap.debugFirst?.run.push({
    engine: 'witness',
    armIndex,
    program: describeWitnessProgram(program),
    result: result ? describeElement(result) : null,
  });
}

function updateDebugBuild(
  snap: Snapshot,
  armIndex: number,
  arm: ComplexSelector,
): void {
  snap.debugFirst?.build.push({
    engine: 'witness',
    usesScope: arm.usesScope === true,
    usesCache: arm.usesCache === true,
    armIndex,
  });

  snap.debugCompile = undefined;
}
