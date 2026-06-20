import { parseSelectorList, type SelectorList } from '../parser/parser';
import type { RuntimeCache } from '../compile/runtimeCache';
import { describeContext, describeElement, type QueryContextDescription } from '../debug';
import { isElement } from '../../utils/dom';
import { buildFullBridgeFirst } from './first-fullbridge';
import { buildFrontierFirst } from './first-frontier';
import type { DebugFrontierProgram } from '../planner/frontier';
import { liftHostSelectorList } from '../planner/lift-host';

export function queryFirst(sel: string, ctx: QueryContext, snap: Snapshot): Element | null {
  snap.probe.first++;

  const isDebug = snap.isDebug;
  if (isDebug) initDebug(snap, sel, ctx);

  let resolver = snap.firstResolvers.get(sel);
  if (!resolver) {
    const parsed = parseSelectorList(sel, { pseudos: snap.pseudos });
    const lifted = liftHostSelectorList(parsed);
    resolver = buildFirstResolver(lifted, snap);
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

  const result = first(ctx, rc);

  if (isDebug) {
    updateDebugResult(snap, result);
  }

  return result;
}

export type FirstResolver = {
  list: SelectorList;
  usesScope: boolean;
  usesCache: boolean;
  fullBridge?: FirstRunFn;
  frontier?: FirstRunFn;
};

export type FirstRunFn = (
  ctx: QueryContext,
  rc: RuntimeCache | null,
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

function resolveFirstStrategy(resolver: FirstResolver, ctx: QueryContext, snap: Snapshot): FirstRunFn {
  // Element contexts force full-bridge selection. Although element.querySelector()
  // feels like a subtree query, the context only constrains returned subjects;
  // selector proof may still depend on ancestors/siblings outside the subtree.
  // Frontier selection narrows the proof universe while moving through the chain,
  // so it is not safe for element contexts.
  if (isElement(ctx)) {
    let fullBridge = resolver.fullBridge;
    if (!fullBridge) {
      fullBridge = buildFullBridgeFirst(resolver.list, snap);
      resolver.fullBridge = fullBridge;
    }
    return fullBridge;
  }

  // Document and fragment contexts prefer frontier selection: author-written
  // selectors usually encode a left-to-right narrowing path. Full-bridge
  // grouping can still beat frontier for some selector lists.
  let frontier = resolver.frontier;
  if (!frontier) {
    frontier = buildFrontierFirst(resolver.list, snap);
    resolver.frontier = frontier;
  }
  return frontier;
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
  engine: 'full-bridge' | 'frontier';
  usesScope: boolean;
  usesCache: boolean;

  // fullbridge-only
  lookupStrategy?: string;
  lookupQuery?: string;
  cost?: number;
  bridge?: string;

  // frontier-only
  armIndex?: number;
  arm?: string;
};

export type DebugFirstRun = {
  engine: 'full-bridge' | 'frontier';

  // fullbridge-only
  lookupStrategy?: string;
  lookupQuery?: string;
  candidates?: string[];
  bridge?: string;

  // witness-only
  armIndex?: number;
  arm?: string;
  program?: DebugFrontierProgram;

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
