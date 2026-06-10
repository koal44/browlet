import { buildStrictMatcher, createBuildContext, type Filter } from '../planner/filter';
import { parseSelectorList, type SelectorList } from '../parser/parser';
import { describeContext, type QueryContextDescription } from '../utils/util';
import type { RuntimeCache } from '../compile/runtimeCache';

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

export function matchStrict(selectors: string, element: Element, snap: Snapshot, rc: RuntimeCache | null): boolean {
  const resolver = getStrictMatchResolver(selectors, snap);
  return resolver.match(element, rc);
}

export type MatchResolver = { match: MatchFn; usesScope: boolean; usesCache: boolean; };

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

  const ctx = createBuildContext();
  const filter = buildStrictMatcher(list, ctx);
  const match = compileMatch(filter, snap);

  if (snap.isDebug && snap.debugMatch) {
    snap.debugMatch.matchSrcText = snap.debugCompile ?? match.toString();
    snap.debugCompile = undefined;
  }

  return {
    match,
    usesScope: filter.usesScope,
    usesCache: filter.usesCache,
  };
}

export type MatchFn = (candidate: Element, rc: RuntimeCache | null) => boolean;

function compileMatch(filter: Filter, snap: Snapshot): MatchFn {
  const f =
    `"use strict";` +
    filter.declarations.join('') +
    `return function Match(c,rc){` +
      `var e=c;` +
      `return ${filter.source};` +
    `}`;

  if (snap.isDebug) snap.debugCompile = f;

  // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
  return Function('s', f)(snap) as MatchFn;
}

export type DebugMatch = {
  kind: 'match';
  element?: QueryContextDescription;
  selectors?: string;
  parse?: {
    arms: number;
    usesScope: boolean;
    usesCache: boolean;
    cost: number;
  };
  matchSrcText?: string;
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
      cost: parsed.cost,
    };
  }
}
