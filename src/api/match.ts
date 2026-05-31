import { buildStrictMatcher, createBuildContext, type Filter } from '../planner/filter';
import type { HashCache } from '../compile/runtime';
import { parseSelectorList, type SelectorList } from '../parser/parser';
import { describeContext, type QueryContextDescription } from '../utils/util';

export function queryMatches(selectors: string, element: Element, snap: Snapshot, h: HashCache | null): boolean {
  snap.probe.match++;
  const isDebug = snap.isDebug;
  if (isDebug) initDebugMatch(snap, selectors, element, true /*isApiEntry*/);

  const resolver = getStrictMatchResolver(selectors, snap);

  if (resolver.usesScope) {
    snap.update(element, true /*updateScope*/);
  }

  const result = resolver.match(element, h);

  if (isDebug) updateDebugMatch(snap, result);

  return result;
}

export function matchStrict(selectors: string, element: Element, snap: Snapshot, h: HashCache | null): boolean {
  const resolver = getStrictMatchResolver(selectors, snap);
  return resolver.match(element, h);
}

export type MatchResolver = { match: MatchFn; usesScope: boolean; };

function getStrictMatchResolver(selectors: string, snap: Snapshot): MatchResolver {
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
  };
}

export type MatchFn = (candidate: Element, h: HashCache | null) => boolean;

function compileMatch(filter: Filter, snap: Snapshot): MatchFn {
  const f =
    `"use strict";` +
    filter.declarations.join('') +
    `return function Match(c,h){` +
      `var e=c;` +
      `return ${filter.source};` +
    `}`;

  if (snap.isDebug) snap.debugCompile = f;

  // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
  return Function('s', f)(snap) as MatchFn;
}

export type DebugMatch = {
  kind: 'match';
  isApiEntry: boolean;
  element?: QueryContextDescription;
  selectors?: string;
  parse?: {
    arms: number;
    usesScope: boolean;
    cost: number;
  };
  matchSrcText?: string;
  result?: boolean;
  error?: string;
};

function initDebugMatch(snap: Snapshot, selectors: string, element: Element, isApiEntry: boolean): void {
  if (isApiEntry) snap.debugStack.length = 0;
  const dbg: DebugMatch = {
    kind: 'match', isApiEntry, selectors,
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
      arms: parsed.selectors.length,
      usesScope: parsed.usesScope,
      cost: parsed.cost,
    };
  }
}
