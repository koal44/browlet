import type { DOMQueryRoot as QuerySource, DOMElement as Element } from '../../infra/index';
import { parseSelectorList, type SelectorList } from '../parser/parser';
import type { RuntimeCache } from '../compile/runtimeCache';
import { describeQuerySource, type QuerySourceDescription } from '../debug';
import { buildFullBridgeSelect } from './select-fullbridge';
import { buildFrontierSelect } from './select-frontier';
import type { DebugFrontierProgram } from '../planner/frontier';
import type { SelectletContext } from '../context';

export function querySelect(sel: string, source: QuerySource, ctx: SelectletContext): Element[] {
  ctx.probe.select++;

  const isDebug = ctx.isDebug;
  if (isDebug) initDebug(ctx, sel, source);

  let resolver = ctx.selectResolvers.get(sel);
  if (!resolver) {
    const parsed = parseSelectorList(sel, { pseudos: ctx.pseudos });
    resolver = buildSelectResolver(parsed, ctx);
    ctx.selectResolvers.set(sel, resolver);
    ctx.cacheSize++;
  }

  const select = resolveSelectStrategy(resolver, source, ctx);

  ctx.update(source, resolver.usesScope);

  let rc: RuntimeCache | null = null;
  if (resolver.usesCache) {
    ctx.syncRuntimeCache(source);
    rc = ctx.runtimeCache;
  }

  return select(source, rc);
}

export type SelectResolver = {
  list: SelectorList;
  usesScope: boolean;
  usesCache: boolean;
  usesHost: boolean;
  fullBridge?: SelectRunFn;
  frontier?: SelectRunFn;
};

export type SelectRunFn = (
  source: QuerySource,
  rc: RuntimeCache | null,
) => Element[];

function buildSelectResolver(list: SelectorList, ctx: SelectletContext): SelectResolver {
  ctx.checkCacheWatermark();
  ctx.probe.selBuild++;

  return {
    list,
    usesScope: list.usesScope,
    usesCache: list.usesCache,
    usesHost: list.usesHost,
  };
}

function resolveSelectStrategy(
  resolver: SelectResolver,
  source: QuerySource,
  ctx: SelectletContext,
): SelectRunFn {
  // Element sources force full-bridge selection. Although
  // element.querySelectorAll() feels like a subtree query, the source only
  // constrains returned subjects; selector proof may still depend on
  // ancestors/siblings outside the subtree. Frontier selection narrows the proof
  // universe while moving through the chain, so it is not safe for element
  // sources.
  if (ctx.dom.isElement(source)) {
    let fullBridge = resolver.fullBridge;
    if (!fullBridge) {
      fullBridge = buildFullBridgeSelect(resolver.list, ctx);
      resolver.fullBridge = fullBridge;
    }
    return fullBridge;
  }

  // Document and fragment sources prefer frontier selection: author-written
  // selectors usually encode a left-to-right narrowing path. Full-bridge
  // grouping can still beat frontier for some selector lists, especially
  // because merging arms back into document order can be expensive.
  let frontier = resolver.frontier;
  if (!frontier) {
    frontier = buildFrontierSelect(resolver.list, ctx);
    resolver.frontier = frontier;
  }
  return frontier;
}

export type DebugSelect = {
  kind: 'select';
  selectors: string;
  source?: QuerySourceDescription;
  build: DebugSelectBuild[];
  run: DebugSelectRun[];
  error?: string;
};

export type DebugSelectBuild = {
  engine: 'full-bridge' | 'frontier';
  usesScope: boolean;
  usesCache: boolean;
  usesHost: boolean;

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

function initDebug(ctx: SelectletContext, sel: string, source: QuerySource): void {
  ctx.debugStack.length = 0;

  const dbgSelect: DebugSelect = {
    kind: 'select',
    selectors: sel,
    source: describeQuerySource(source, undefined, ctx.dom),
    build: [],
    run: [],
  };

  ctx.debugSelect = dbgSelect;
  ctx.debugStack.push(dbgSelect);
}
