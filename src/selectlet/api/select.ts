import { parseSelectorList, type SelectorList } from '../parser/parser';
import type { RuntimeCache } from '../compile/runtimeCache';
import { describeContext, type QueryContextDescription } from '../debug';
import { isElement } from '../../utils/dom';
import { buildFullBridgeSelect } from './select-fullbridge';
import { buildFrontierSelect } from './select-frontier';
import type { DebugFrontierProgram } from '../planner/frontier';
import { liftHostSelectorList } from '../planner/lift-host';

export function querySelect(sel: string, ctx: QueryContext, snap: Snapshot): Element[] {
  snap.probe.select++;

  const isDebug = snap.isDebug;
  if (isDebug) initDebug(snap, sel, ctx);

  let resolver = snap.selectResolvers.get(sel);
  if (!resolver) {
    const parsed = parseSelectorList(sel, { pseudos: snap.pseudos });
    const lifted = liftHostSelectorList(parsed);
    resolver = buildSelectResolver(lifted, snap);
    snap.selectResolvers.set(sel, resolver);
    snap.cacheSize++;
  }

  const select = resolveSelectStrategy(resolver, ctx, snap);

  snap.update(ctx, resolver.usesScope);

  let rc: RuntimeCache | null = null;
  if (resolver.usesCache) {
    snap.syncRuntimeCache(ctx);
    rc = snap.runtimeCache;
  }

  return select(ctx, rc);
}

export type SelectResolver = {
  list: SelectorList;
  usesScope: boolean;
  usesCache: boolean;
  fullBridge?: SelectRunFn;
  frontier?: SelectRunFn;
};

export type SelectRunFn = (
  ctx: QueryContext,
  rc: RuntimeCache | null,
) => Element[];

function buildSelectResolver(list: SelectorList, snap: Snapshot): SelectResolver {
  snap.checkCacheWatermark();
  snap.probe.selBuild++;

  return {
    list,
    usesScope: list.usesScope,
    usesCache: list.usesCache,
  };
}

function resolveSelectStrategy(
  resolver: SelectResolver,
  ctx: QueryContext,
  snap: Snapshot,
): SelectRunFn {
  // Element contexts force full-bridge selection. Although
  // element.querySelectorAll() feels like a subtree query, the context only
  // constrains returned subjects; selector proof may still depend on
  // ancestors/siblings outside the subtree. Frontier selection narrows the proof
  // universe while moving through the chain, so it is not safe for element
  // contexts.
  if (isElement(ctx)) {
    let fullBridge = resolver.fullBridge;
    if (!fullBridge) {
      fullBridge = buildFullBridgeSelect(resolver.list, snap);
      resolver.fullBridge = fullBridge;
    }
    return fullBridge;
  }

  // Document and fragment contexts prefer frontier selection: author-written
  // selectors usually encode a left-to-right narrowing path. Full-bridge
  // grouping can still beat frontier for some selector lists, especially
  // because merging arms back into document order can be expensive.
  let frontier = resolver.frontier;
  if (!frontier) {
    frontier = buildFrontierSelect(resolver.list, snap);
    resolver.frontier = frontier;
  }
  return frontier;
}

export type DebugSelect = {
  kind: 'select';
  selectors: string;
  context?: QueryContextDescription;
  build: DebugSelectBuild[];
  run: DebugSelectRun[];
  error?: string;
};

export type DebugSelectBuild = {
  engine: 'full-bridge' | 'frontier';
  usesScope: boolean;
  usesCache: boolean;

  // full-bridge-only
  lookupStrategy?: string;
  lookupQuery?: string;
  cost?: number;
  bridge?: string;

  // frontier-only
  armIndex?: number;
  arm?: string;
};

export type DebugSelectRun = {
  engine: 'full-bridge' | 'frontier';

  // full-bridge-only
  lookupStrategy?: string;
  lookupQuery?: string;
  candidates?: string[];
  bridge?: string;

  // frontier-only
  armIndex?: number;
  arm?: string;
  program?: DebugFrontierProgram;

  results: string[];
};

function initDebug(snap: Snapshot, sel: string, ctx: QueryContext): void {
  snap.debugStack.length = 0;

  const dbgSelect: DebugSelect = {
    kind: 'select',
    selectors: sel,
    context: describeContext(ctx),
    build: [],
    run: [],
  };

  snap.debugSelect = dbgSelect;
  snap.debugStack.push(dbgSelect);
}
