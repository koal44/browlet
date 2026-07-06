import { type CandidateBiPredicate, parseSelectorList, type SelectorList } from '../parser/parser';
import { describeContext, type QueryContextDescription } from '../debug';
import type { RuntimeCache } from '../compile/runtimeCache';
import { buildStrictSelectorListTest } from '../planner/chain';

export function queryMatches(selectors: string, element: Element, snap: Snapshot): boolean {
  snap.probe.match++;
  const isDebug = snap.isDebug;
  if (isDebug) initDebugMatch(snap, selectors, element);

  const resolver = getStrictMatchResolver(selectors, snap);

  if (resolver.usesScope) snap.update(element, true /*updateScope*/);

  let rc: RuntimeCache | null = null;
  if (resolver.usesCache && snap.hasTreeVersion) {
    snap.syncRuntimeCache(element);
    rc = snap.runtimeCache;
  }

  const result = resolver.match(element, rc);

  if (isDebug) updateDebugMatch(snap, result);

  return result;
}

export type MatchResolver = {
  match: CandidateBiPredicate;
  usesScope: boolean;
  usesCache: boolean;
  usesHost: boolean;
};

export function getStrictMatchResolver(selectors: string, snap: Snapshot): MatchResolver {
  let resolver = snap.strictMatchResolvers.get(selectors);

  if (!resolver) {
    const parsed = parseSelectorList(selectors, { pseudos: snap.pseudos });

    if (snap.isDebug && snap.debugMatch) {
      updateDebugParse(snap, parsed);
    }

    resolver = buildStrictMatchResolver(parsed, snap);
    snap.strictMatchResolvers.set(selectors, resolver);
    snap.cacheSize++;
  }

  return resolver;
}

function buildStrictMatchResolver(list: SelectorList, snap: Snapshot): MatchResolver {
  snap.probe.matBuild++;
  snap.checkCacheWatermark();

  const match = buildStrictSelectorListTest(list, snap);

  if (snap.isDebug && snap.debugMatch) {
    snap.debugCompile = undefined;
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
  element?: QueryContextDescription;
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

function initDebugMatch(snap: Snapshot, selectors: string, element: Element): void {
  snap.debugStack.length = 0;
  const dbg: DebugMatch = {
    kind: 'match', selectors,
    element: describeContext(element),
  };

  snap.debugMatch = dbg;
  snap.debugStack.push(dbg);
}

function updateDebugMatch(snap: Snapshot, result: boolean): void {
  if (snap.debugMatch) {
    snap.debugMatch.result = result;
  }
}

function updateDebugParse(snap: Snapshot, parsed: SelectorList): void {
  if (snap.debugMatch) {
    snap.debugMatch.parse = {
      arms: parsed.arms.length,
      usesScope: parsed.usesScope,
      usesCache: parsed.usesCache,
      usesHost: parsed.usesHost,
      cost: parsed.cost,
    };
  }
}
