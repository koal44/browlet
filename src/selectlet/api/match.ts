import type { DOMElement as Element } from '../../infra/index';
import { type CandidateElementPredicate, parseSelectorList, type SelectorList } from '../parser/parser';
import { describeQuerySource, type QuerySourceDescription } from '../debug';
import type { RuntimeCache } from '../compile/runtimeCache';
import { buildStrictSelectorListTest } from '../planner/chain';
import type { SelectletContext } from '../context';

export function queryMatches(selectors: string, element: Element, ctx: SelectletContext): boolean {
  ctx.probe.match++;
  const isDebug = ctx.isDebug;
  if (isDebug) initDebugMatch(ctx, selectors, element);

  const resolver = getStrictMatchResolver(selectors, ctx);

  if (resolver.usesScope) ctx.update(element, true /*updateScope*/);

  let rc: RuntimeCache | null = null;
  if (resolver.usesCache && (ctx.dom.treeVersion !== undefined)) {
    ctx.syncRuntimeCache(element);
    rc = ctx.runtimeCache;
  }

  const result = resolver.match(element, rc);

  if (isDebug) updateDebugMatch(ctx, result);

  return result;
}

export type MatchResolver = {
  match: CandidateElementPredicate;
  usesScope: boolean;
  usesCache: boolean;
  usesHost: boolean;
};

export function getStrictMatchResolver(selectors: string, ctx: SelectletContext): MatchResolver {
  let resolver = ctx.strictMatchResolvers.get(selectors);

  if (!resolver) {
    const parsed = parseSelectorList(selectors, { pseudos: ctx.pseudos });

    if (ctx.isDebug && ctx.debugMatch) {
      updateDebugParse(ctx, parsed);
    }

    resolver = buildStrictMatchResolver(parsed, ctx);
    ctx.strictMatchResolvers.set(selectors, resolver);
    ctx.cacheSize++;
  }

  return resolver;
}

function buildStrictMatchResolver(list: SelectorList, ctx: SelectletContext): MatchResolver {
  ctx.probe.matBuild++;
  ctx.checkCacheWatermark();

  const match = buildStrictSelectorListTest(list, ctx);

  if (ctx.isDebug && ctx.debugMatch) {
    ctx.debugCompile = undefined;
  }

  return {
    match,
    usesScope: list.usesScope,
    usesCache: list.usesCache,
    usesHost: list.usesHost,
  };
}

export type DebugMatch = {
  kind: 'match';
  element?: QuerySourceDescription;
  selectors?: string;
  parse?: {
    arms: number;
    usesScope: boolean;
    usesCache: boolean;
    usesHost: boolean;
    cost: number;
  };
  result?: boolean;
  error?: string;
};

function initDebugMatch(ctx: SelectletContext, selectors: string, element: Element): void {
  ctx.debugStack.length = 0;
  const dbg: DebugMatch = {
    kind: 'match', selectors,
    element: describeQuerySource(element, undefined, ctx.dom),
  };

  ctx.debugMatch = dbg;
  ctx.debugStack.push(dbg);
}

function updateDebugMatch(ctx: SelectletContext, result: boolean): void {
  if (ctx.debugMatch) {
    ctx.debugMatch.result = result;
  }
}

function updateDebugParse(ctx: SelectletContext, parsed: SelectorList): void {
  if (ctx.debugMatch) {
    ctx.debugMatch.parse = {
      arms: parsed.arms.length,
      usesScope: parsed.usesScope,
      usesCache: parsed.usesCache,
      usesHost: parsed.usesHost,
      cost: parsed.cost,
    };
  }
}
