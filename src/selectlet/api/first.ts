import type { DOMQueryRoot as QuerySource, DOMElement as Element } from '../../infra/index';
import { parseSelectorList, type SelectorList } from '../parser/parser';
import type { RuntimeCache } from '../compile/runtimeCache';
import { describeQuerySource, describeElement, type QuerySourceDescription } from '../debug';
import { buildFullBridgeFirst } from './first-fullbridge';
import { buildFrontierFirst } from './first-frontier';
import type { DebugFrontierProgram } from '../planner/frontier';
import type { SelectletContext } from '../context';

export function queryFirst(sel: string, source: QuerySource, ctx: SelectletContext): Element | null {
  ctx.probe.first++;

  const isDebug = ctx.isDebug;
  if (isDebug) initDebug(ctx, sel, source);

  let resolver = ctx.firstResolvers.get(sel);
  if (!resolver) {
    const parsed = parseSelectorList(sel, { pseudos: ctx.pseudos });
    resolver = buildFirstResolver(parsed, ctx);
    ctx.firstResolvers.set(sel, resolver);
    ctx.cacheSize++;
  }

  const first = resolveFirstStrategy(resolver, source, ctx);

  ctx.update(source, resolver.usesScope);

  let rc: RuntimeCache | null = null;
  if (resolver.usesCache) {
    ctx.syncRuntimeCache(source);
    rc = ctx.runtimeCache;
  }

  const result = first(source, rc);

  if (isDebug) {
    updateDebugResult(ctx, result);
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
  source: QuerySource,
  rc: RuntimeCache | null,
) => Element | null;

function buildFirstResolver(list: SelectorList, ctx: SelectletContext): FirstResolver {
  ctx.checkCacheWatermark();
  ctx.probe.firstBuild++;

  return {
    list,
    usesScope: list.usesScope,
    usesCache: list.usesCache,
  };
}

function resolveFirstStrategy(resolver: FirstResolver, source: QuerySource, ctx: SelectletContext): FirstRunFn {
  // Element sources force full-bridge selection. Although element.querySelector()
  // feels like a subtree query, the source only constrains returned subjects;
  // selector proof may still depend on ancestors/siblings outside the subtree.
  // Frontier selection narrows the proof universe while moving through the chain,
  // so it is not safe for element sources.
  if (ctx.dom.isElement(source)) {
    let fullBridge = resolver.fullBridge;
    if (!fullBridge) {
      fullBridge = buildFullBridgeFirst(resolver.list, ctx);
      resolver.fullBridge = fullBridge;
    }
    return fullBridge;
  }

  // Document and fragment sources prefer frontier selection: author-written
  // selectors usually encode a left-to-right narrowing path. Full-bridge
  // grouping can still beat frontier for some selector lists.
  let frontier = resolver.frontier;
  if (!frontier) {
    frontier = buildFrontierFirst(resolver.list, ctx);
    resolver.frontier = frontier;
  }
  return frontier;
}

export type DebugFirst = {
  kind: 'first';
  selectors: string;
  source?: QuerySourceDescription;
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

function initDebug(ctx: SelectletContext, sel: string, source: QuerySource): void {
  ctx.debugStack.length = 0;

  const dbgFirst: DebugFirst = {
    kind: 'first',
    selectors: sel,
    source: describeQuerySource(source, undefined, ctx.dom),
    build: [],
    run: [],
  };

  ctx.debugFirst = dbgFirst;
  ctx.debugStack.push(dbgFirst);
}

function updateDebugResult(ctx: SelectletContext, result: Element | null): void {
  if (ctx.debugFirst) {
    ctx.debugFirst.result = result ? describeElement(result, ctx.dom) : null;
  }
}
