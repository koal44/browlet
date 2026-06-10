/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-implied-eval */
import type { BuildContext, CompoundSelector } from '../parser/parser';
import { parseSelectorList, type ComplexSelector, type SelectorList } from '../parser/parser';
import { mergeDocumentOrderLists } from '../utils/collections';
import type { RuntimeCache } from '../compile/runtimeCache';
import { expandSelectorListForSeeding } from '../planner/pseudo-lift';
import { buildCompoundTest, createBuildContext } from '../planner/filter';
import { cssIdentUnescape } from '../utils/css';
import { describeContext, describeElements, type QueryContextDescription } from '../utils/util';

export function querySelect(sel: string, ctx: QueryContext, snap: Snapshot): Element[] {
  snap.probe.select++;
  const isDebug = snap.isDebug;
  if (isDebug) initDebug(snap, sel, ctx);

  let resolver = snap.selectWitnessResolvers.get(sel);
  if (!resolver) {
    const parsed = parseSelectorList(sel, { pseudos: snap.pseudos });
    resolver = buildSelectWitnessResolver(parsed, snap);
    snap.selectWitnessResolvers.set(sel, resolver);
    snap.cacheSize++;
  }

  snap.update(ctx, resolver.usesScope);

  let rc: RuntimeCache | null = null;
  if (resolver.usesCache) {
    snap.syncRuntimeCache(ctx);
    rc = snap.runtimeCache;
  }

  const lists: Element[][] = [];
  let i = 0;

  for (let k = 0; k < resolver.lambdas.length; k++) {
    const select = resolver.lambdas[k];
    const results = select(ctx, rc);

    if (results.length) lists[i++] = results;
    if (isDebug) updateDebugRun(snap, k, select, results);
  }

  return mergeDocumentOrderLists(lists);
}

export type SelectWitnessResolver = {
  lambdas: SelectWitnessFn[];
  usesScope: boolean;
  usesCache: boolean;
};

function buildSelectWitnessResolver(list: SelectorList, snap: Snapshot): SelectWitnessResolver {
  snap.checkCacheWatermark();
  snap.probe.selBuild++;

  const arms = expandSelectorListForSeeding(list);
  const lambdas: SelectWitnessFn[] = [];

  let usesScope = false;
  let usesCache = false;

  for (let i = 0; i < arms.length; i++) {
    const arm = arms[i];

    usesScope ||= arm.usesScope;
    usesCache ||= arm.usesCache;

    const select = compileWitnessSelect(arm, snap);
    lambdas[i] = select;

    if (snap.isDebug) {
      updateDebugBuild(snap, i, arm, select);
    }
  }

  return { lambdas, usesScope, usesCache };
}

type SelectWitnessFn = (ctx: QueryContext, rc: RuntimeCache | null) => Element[];

function compileWitnessSelect(complex: ComplexSelector, snap: Snapshot): SelectWitnessFn {
  const ctx = createBuildContext();
  const source = buildWitnessSelectSource(complex, ctx);

  const f =
    `"use strict";` +
    ctx.declarations.join('') +
    `return function Select(ctx,rc){` +
      source +
    `}`;

  if (snap.isDebug) snap.debugCompile = f;

  return Function('s', f)(snap) as SelectWitnessFn;
}

function buildWitnessSelectSource(complex: ComplexSelector, ctx: BuildContext): string {
  const { parts } = complex;
  const sources: string[] = [];

  sources.push(`var root=ctx,w=null,c=null;`);

  let filter: string | undefined;
  let hasWitnesses = false;

  for (let i = 0; i < parts.length; i++) {
    const { combinator, compound } = parts[i];

    // If we have a clean witness frontier and the next edge is one of the
    // cheap/explicit forward axes, advance the witness set directly.
    //
    // Descendant is intentionally not here. Descendant can be handled by lookup
    // + applyFilter against the existing w.
    if (filter === undefined && hasWitnesses && combinator && isForwardAdvanceCombinator(combinator)) {
      const pred = defineWitnessPredicate(buildCompoundTest(compound, ctx), ctx);
      const advance = emitWitnessAdvance(combinator);

      sources.push(`w=${advance}(w,${pred},rc);`);
      sources.push(`if(!w.length)return [];`);
      sources.push(`if(w.length===1)root=w[0];`);
      continue;
    }

    filter = growWitnessFilter(filter, combinator, compound, ctx, hasWitnesses);

    const lookup = emitCandidateLookup(compound);
    if (lookup) {
      const pred = defineWitnessPredicate(filter, ctx);

      sources.push(`c=${lookup};`);
      sources.push(`w=s.applyFilter(c,${pred},w,rc);`);
      sources.push(`if(!w.length)return [];`);
      sources.push(`if(w.length===1)root=w[0];`);

      filter = undefined;
      hasWitnesses = true;
    }
  }

  if (filter !== undefined) {
    const pred = defineWitnessPredicate(filter, ctx);

    sources.push(`c=s.byTag("*",root);`);
    sources.push(`w=s.applyFilter(c,${pred},w,rc);`);
    sources.push(`if(!w.length)return [];`);
  }

  sources.push(`return w||[];`);
  return sources.join('');
}

function growWitnessFilter(
  filter: string | undefined,
  combinator: string | null,
  compound: CompoundSelector,
  ctx: BuildContext,
  hasWitnesses: boolean,
): string {
  const right = buildCompoundTest(compound, ctx);

  if (filter === undefined) {
    if (hasWitnesses && combinator) {
      return `${right}&&${emitWitnessBoundaryMatch(combinator)}`;
    }

    return right;
  }

  const left = defineWitnessPredicate(filter, ctx);
  return `${right}&&${emitWitnessCombinatorMatch(combinator, left)}`;
}

function emitWitnessBoundaryMatch(combinator: string | null): string {
  switch (combinator) {
    case ' ': return `s.matchAncestorInSet(e,w)`;
    case '>': return `s.matchParentInSet(e,w)`;
    case '+': return `s.matchPrevInSet(e,w)`;
    case '~': return `s.matchPrevAnyInSet(e,w)`;
    default:
      throw new Error(`Invalid witness boundary combinator: ${String(combinator)}`);
  }
}

function emitWitnessCombinatorMatch(combinator: string | null, pred: string): string {
  switch (combinator) {
    case ' ': return `s.matchAncestorW(e,${pred},w,rc)`;
    case '>': return `s.matchParentW(e,${pred},w,rc)`;
    case '+': return `s.matchPrevW(e,${pred},w,rc)`;
    case '~': return `s.matchPrevAnyW(e,${pred},w,rc)`;
    default:
      throw new Error(`Invalid combinator in witness filter: ${String(combinator)}`);
  }
}

function emitWitnessAdvance(combinator: string): string {
  switch (combinator) {
    case '>': return 's.frontierChildren';
    case '+': return 's.frontierNext';
    case '~': return 's.frontierFollowing';
    default:
      throw new Error(`Invalid witness advance combinator: ${String(combinator)}`);
  }
}

function defineWitnessPredicate(source: string, ctx: BuildContext): string {
  const name = `W${ctx.nextPredicate++}`;
  ctx.declarations.push(`function ${name}(e,w,rc){return (${source});}\n`);
  return name;
}

function isForwardAdvanceCombinator(combinator: string): boolean {
  return combinator === '>' || combinator === '+' || combinator === '~';
}

function emitCandidateLookup(compound: CompoundSelector): string | undefined {
  if (compound.id) {
    compound.id.seed = true;
    const id = cssIdentUnescape(compound.id.raw);
    return `s.seedsById(${JSON.stringify(id)},root)`;
  }

  if (compound.classes?.length) {
    const classes = compound.classes.map((c) => cssIdentUnescape(c.raw));
    if (classes.some((c) => /[\t\n\f\r ]/.test(c))) return `[]`;

    for (const cls of compound.classes) cls.seed = true;
    return `s.seedsByClass(${JSON.stringify(classes)},root)`;
  }

  return undefined;
}

export type DebugSelectWitness = {
  kind: 'select-witness';
  selectors: string;
  context?: QueryContextDescription;
  build: {
    usesScope: boolean;
    usesCache: boolean;
    armIndex: number;
    selectSrcText: string;
  }[];
  run: {
    armIndex: number;
    selectSrcText: string;
    results: string[];
  }[];
  error?: string;
};

function initDebug(snap: Snapshot, sel: string, ctx: QueryContext): void {
  snap.debugStack.length = 0;

  const dbgSelect: DebugSelectWitness = {
    kind: 'select-witness',
    selectors: sel,
    context: describeContext(ctx),
    build: [],
    run: [],
  };

  snap.debugSelectWitness = dbgSelect;
  snap.debugStack.push(dbgSelect);
}

function updateDebugRun(
  snap: Snapshot,
  armIndex: number,
  select: SelectWitnessFn,
  results: Element[],
): void {
  snap.debugSelectWitness?.run.push({
    armIndex,
    selectSrcText: String(select),
    results: describeElements(results),
  });
}

function updateDebugBuild(
  snap: Snapshot,
  armIndex: number,
  arm: ComplexSelector,
  select: SelectWitnessFn,
): void {
  snap.debugSelectWitness?.build.push({
    usesScope: arm.usesScope === true,
    usesCache: arm.usesCache === true,
    armIndex,
    selectSrcText: snap.debugCompile ?? select.toString(),
  });

  snap.debugCompile = undefined;
}
