import { parseSelectorList, type SelectorList } from '../parser/parser';
import type { RuntimeCache } from '../compile/runtimeCache';
import { describeContext, describeElement, type QueryContextDescription } from '../utils/debug';
import { isElement } from '../utils/dom';
import { buildSubjectFirst } from './first-subject';
import { buildWitnessFirst } from './first-witness';
import type { DebugWitnessProgram } from './witness';

export function queryFirst(sel: string, ctx: QueryContext, snap: Snapshot): Element | null {
  snap.probe.first++;

  const isDebug = snap.isDebug;
  if (isDebug) initDebug(snap, sel, ctx);

  let resolver = snap.firstResolvers.get(sel);
  if (!resolver) {
    const parsed = parseSelectorList(sel, { pseudos: snap.pseudos });
    resolver = buildFirstResolver(parsed, snap);
    snap.firstResolvers.set(sel, resolver);
    snap.cacheSize++;
  }

  const first = resolveFirstStrategy(resolver, ctx, snap);

  snap.update(ctx, resolver.usesScope);

  let rc: RuntimeCache | null = null;
  if (resolver.usesCache) {
    snap.syncRuntimeCache(ctx);
    rc = snap.runtimeCache;
  }

  const result = first(ctx, rc, snap);

  if (isDebug) {
    updateDebugResult(snap, result);
  }

  return result;
}

export type FirstResolver = {
  list: SelectorList;
  usesScope: boolean;
  usesCache: boolean;
  subject?: FirstRunFn;
  witness?: FirstRunFn;
};

export type FirstRunFn = (
  ctx: QueryContext,
  rc: RuntimeCache | null,
  snap: Snapshot,
) => Element | null;

function buildFirstResolver(list: SelectorList, snap: Snapshot): FirstResolver {
  snap.checkCacheWatermark();
  snap.probe.firstBuild++;

  return {
    list,
    usesScope: list.usesScope,
    usesCache: list.usesCache,
  };
}

function resolveFirstStrategy(
  resolver: FirstResolver,
  ctx: QueryContext,
  snap: Snapshot,
): FirstRunFn {
  if (isElement(ctx)) {
    let subject = resolver.subject;
    if (!subject) {
      subject = buildSubjectFirst(resolver.list, snap);
      resolver.subject = subject;
    }
    return subject;
  } else { // Document, DocumentFragment
    let witness = resolver.witness;
    if (!witness) {
      witness = buildWitnessFirst(resolver.list, snap);
      resolver.witness = witness;
    }
    return witness;
  }
}

export type DebugFirst = {
  kind: 'first';
  selectors: string;
  context?: QueryContextDescription;
  build: DebugFirstBuild[];
  run: DebugFirstRun[];
  result?: string | null;
  error?: string;
};

export type DebugFirstBuild = {
  engine: 'subject' | 'witness';
  usesScope: boolean;
  usesCache: boolean;

  // subject-only
  lookupStrategy?: string;
  lookupQuery?: string;
  filterCost?: number;
  srcText?: string;

  // witness-only
  armIndex?: number;
};

export type DebugFirstRun = {
  engine: 'subject' | 'witness';

  // subject-only
  lookupStrategy?: string;
  lookupQuery?: string;
  candidates?: string[];
  srcText?: string;

  // witness-only
  armIndex?: number;
  program?: DebugWitnessProgram;

  result: string | null;
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

function updateDebugResult(snap: Snapshot, result: Element | null): void {
  if (snap.debugFirst) {
    snap.debugFirst.result = result ? describeElement(result) : null;
  }
}
