import type { DOMNode as QuerySource, DOMNode as Element } from '../../infra/index';
import type { ComplexSelector, SelectorList } from '../parser/parser';
import type { RuntimeCache } from '../compile/runtimeCache';
import type { SelectRunFn } from './select';
import { mergeDocumentOrderLists } from '../collections';
import {
  buildFrontierProgram, canAdvance, describeFrontierProgram, getAdvanceMove, getBridgeMove, resetFrontierDebug, runAdvanceMove, runBridgeMove, type FrontierProgram, type FrontierState,
} from '../planner/frontier';
import { describeComplex, describeElements } from '../debug';
import { buildChain } from '../planner/chain';
import { LOOKUP_COPY } from '../constants';
import type { SelectletContext } from '../context';

export function buildFrontierSelect(list: SelectorList, ctx: SelectletContext): SelectRunFn {
  const arms = list.arms;
  const selects: ArmSelectFn[] = [];

  for (let i = 0; i < arms.length; i++) {
    const arm = arms[i]!;

    const select = buildArmFn(arm, i, ctx);
    selects[i] = select;

    if (ctx.isDebug) {
      updateDebugBuild(ctx, i, arm);
    }
  }

  return function Select(source, rc) {
    return runSelect(selects, source, rc, ctx);
  };
}

function runSelect(selects: ArmSelectFn[], source: QuerySource, rc: RuntimeCache | null, ctx: SelectletContext): Element[] {
  if (selects.length === 1) {
    const select = selects[0]!;
    return select(source, rc);
  }

  const lists: Element[][] = [];
  let i = 0;

  for (let k = 0; k < selects.length; k++) {
    const select = selects[k]!;
    const results = select(source, rc);
    if (results.length) lists[i++] = results;
  }

  return mergeDocumentOrderLists(lists, ctx.dom);
}

type ArmSelectFn = (source: QuerySource, rc: RuntimeCache | null) => Element[];

function buildArmFn(complex: ComplexSelector, armIndex: number, ctx: SelectletContext): ArmSelectFn {
  const chain = buildChain(complex);
  const program = buildFrontierProgram(chain, ctx);

  return function Select(source, rc) {
    const results = runFrontierProgram(program, source, rc, ctx);

    if (ctx.isDebug) {
      updateDebugRun(ctx, armIndex, complex, program, results);
    }

    return results;
  };
}

function runFrontierProgram(program: FrontierProgram, source: QuerySource, rc: RuntimeCache | null, ctx: SelectletContext): Element[] {
  const isDebug = ctx.isDebug;
  if (isDebug) resetFrontierDebug(program);

  const state: FrontierState = {
    root: source,
    frontier: null,
  };

  const startStep = program.steps[program.start.to]!;
  runBridgeMove(state, program.start, startStep.canRoot, LOOKUP_COPY, rc);

  if (isDebug) {
    program.start.count = state.frontier?.length ?? 0;
  }

  if (!state.frontier?.length) return [];

  let index = program.start.to;
  const last = program.steps.length - 1;

  while (index < last) {
    const from = index;
    const step = program.steps[from]!;

    if (canAdvance(state)) {
      const advance = getAdvanceMove(program, from, ctx);

      if (advance) {
        if (isDebug) step.lookupRoot = state.root;

        const advanceStep = program.steps[advance.to]!;
        runAdvanceMove(state, advance, advanceStep.canRoot, rc);

        if (isDebug) step.count = state.frontier.length;

        index = advance.to;
        if (!state.frontier.length) return [];
        continue;
      }
    }

    const bridge = getBridgeMove(program, from, ctx);
    if (!bridge) break;

    if (isDebug) step.lookupRoot = state.root;

    const bridgeStep = program.steps[bridge.to]!;
    runBridgeMove(state, bridge, bridgeStep.canRoot, LOOKUP_COPY, rc);

    if (isDebug) step.count = state.frontier.length;

    index = bridge.to;
    if (!state.frontier.length) return [];
  }

  return state.frontier;
}

function updateDebugRun(
  ctx: SelectletContext,
  armIndex: number,
  arm: ComplexSelector,
  program: FrontierProgram,
  results: Element[],
): void {
  ctx.debugSelect?.run.push({
    engine: 'frontier',
    armIndex,
    arm: describeComplex(arm),
    program: describeFrontierProgram(program, ctx.dom),
    results: describeElements(results, undefined, ctx.dom),
  });
}

function updateDebugBuild(
  ctx: SelectletContext,
  armIndex: number,
  arm: ComplexSelector,
): void {
  ctx.debugSelect?.build.push({
    engine: 'frontier',
    usesScope: arm.usesScope === true,
    usesCache: arm.usesCache === true,
    usesHost: arm.usesHost === true,
    armIndex,
    arm: describeComplex(arm),
  });

  ctx.debugCompile = undefined;
}
