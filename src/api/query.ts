import { seedsByClass } from "../candidates/seedsByClass";
import { seedsById } from "../candidates/seedsById";
import { seedsByTag } from "../candidates/seedsByTag";
import { compile } from "../compile/compile";
import { initDebugMatch, initDebugSelect, updateDebugMatch, updateDebugSelectRun } from "../debug";
import { parse } from "../parser";
import { sortUniqueByDocPosition } from "../utils/collections";
import { cssIdentUnescape } from "../utils/css";
import { assertNever } from "../utils/type";

// equivalent of w3c 'matches' method
export function queryMatch(selectors: string, element: Element, snap: Snapshot, h: HashCache | null): boolean {
  snap.probe.match++;
  const isDebug = snap.isDebug;
  if (isDebug) initDebugMatch(snap, selectors, element, true /*isApiEntry*/);

  const resolver = getStrictMatchResolver(selectors, snap);

  if (resolver.usesScope) {
    snap.update(element, true /*updateScope*/);
  }

  const result = resolver.lambdas.some(f => f(element, h));

  if (isDebug) updateDebugMatch(snap, resolver, result);

  return result;
}

export function matchStrict(selectors: string, element: Element, snap: Snapshot, h: HashCache | null): boolean {
  const resolver = getStrictMatchResolver(selectors, snap);
  return resolver.lambdas.some(f => f(element, h));
}

export function matchForgiving(selectors: string, element: Element, snap: Snapshot, h: HashCache | null): boolean {
  const resolver = getForgivingMatchResolver(selectors, snap);
  return resolver.lambdas.some(f => f(element, h));
}

function getStrictMatchResolver(selectors: string, snap: Snapshot): MatchResolver {
  let resolver = snap.strictMatchResolvers[selectors];

  if (!resolver) {
    const parsed = parse(selectors, snap.re);

    if (snap.isDebug && snap.debugMatch) {
      snap.debugMatch.parsed = parsed;
    }

    resolver = snap.strictMatchResolvers[selectors] = buildStrictMatchResolver(parsed, snap);
  }

  return resolver;
}

function getForgivingMatchResolver(selectors: string, snap: Snapshot): MatchResolver {
  let resolver = snap.forgivingMatchResolvers[selectors];

  if (!resolver) {
    const parsed = parse(selectors, snap.re, true);

    if (snap.isDebug && snap.debugMatch) {
      snap.debugMatch.parsed = parsed;
    }

    resolver = snap.forgivingMatchResolvers[selectors] = buildForgivingMatchResolver(parsed, snap);
  }

  return resolver;
}

function buildStrictMatchResolver(selectors: string[], snap: Snapshot): MatchResolver {
  const lambdas: MatchLambda[] = [];
  snap.probe.matBuild++;

  for (let i = 0, l = selectors.length; i < l; ++i) {
    lambdas[i] = compile(selectors[i], false /*select/match mode*/, false /*cb*/, snap);
  }

  return {
    lambdas,
    usesScope: hasScopeSelector(selectors),
  };
}

function buildForgivingMatchResolver(selectors: string[], snap: Snapshot): MatchResolver {
  const lambdas: MatchLambda[] = [];
  snap.probe.matBuild++;

  for (let i = 0, l = selectors.length; i < l; ++i) {
    try {
      lambdas.push(compile(selectors[i], false, false, snap));
    } catch {
      // Invalid arm in a forgiving selector list.
    }
  }

  return {
    lambdas,
    usesScope: false, // forgiving match is only used for :is()/:where() arms, which are not entry points.
  };
}

// equivalent of w3c 'querySelectorAll' method
export function querySelect(sel: string, ctx: QueryContext, cb: QueryCallback | null, snap: Snapshot, isApiEntry = false): Element[] {
  snap.probe.select++;
  const isDebug = snap.isDebug;
  if (isDebug) initDebugSelect(snap, sel, cb, ctx, isApiEntry);

  // try to reuse cached resolver
  let resolver = snap.selectResolvers[sel];
  if (!resolver || resolver.hasCb !== !!cb) {
    const parsed = parse(sel, snap.re);
    resolver = buildSelectResolver(parsed, !!cb, snap);
    snap.selectResolvers[sel] = resolver;
  }

  snap.update(ctx, isApiEntry && resolver.usesScope);

  const results: Element[] = [];
  const cache: HashCache = {};
  const seeds = resolver.seeds;

  for (const seed of seeds) {
    const candidates = seed.getCandidates(ctx);
    const stopped = seed.lambda(candidates, cb, ctx, results, cache);

    if (isDebug) updateDebugSelectRun(snap, seed, candidates, results);
    if (stopped) break;
  }

  if (seeds.length > 1 && results.length > 1) {
    sortUniqueByDocPosition(results);
  }

  return results;
}

function buildSelectResolver(selectors: string[], hasCb: boolean, snap: Snapshot): SelectResolver {
  const seeds: CandidateSeed[] = [];
  const usesScope = hasScopeSelector(selectors);

  snap.probe.selBuild++;

  for (const sel of selectors) {
    let { key, query, compileQuery } = getOptimizedPlan(sel, snap);

    // Normalize optimized DOM lookups so candidate seeds remain selector-equivalent.
    let getCandidates: GetCandidates;
    switch (key) {
      case '#': {
        query = cssIdentUnescape(query);
        getCandidates = (ctx) => seedsById(query, ctx, snap);
        break;
      }
      case '.': {
        query = cssIdentUnescape(query);
        // classname lookup accepts whitespace queries that QSA class selectors do not.
        getCandidates = /[\t\n\f\r ]/.test(query)
          ? () => []
          : (ctx) => seedsByClass(query, ctx, snap);
        break;
      }
      case '*': {
        query = cssIdentUnescape(query);
        getCandidates = (ctx) => seedsByTag(query, ctx, snap);
        break;
      }
      default: assertNever(key);
    }

    if (snap.isDebug) {
      snap.debugSelect?.build.push({ selector: sel, seedKey: key, seedQuery: query, compileQuery });
    }

    seeds.push({
      key, query, compileQuery, getCandidates,
      lambda: compile(compileQuery, true, hasCb, snap),
    });
  }

  return {
    seeds, usesScope, hasCb,
  }
}

function getOptimizedPlan(selector: string, snap: Snapshot): CandidatePlan {
  const token = selector.match(snap.re.optimizer);

  if (!token || token[1] === ':') {
    return {
      key: '*',
      query: '*',
      compileQuery: selector,
    };
  }

  const index = token.index;
  if (index === undefined) throw new Error('Invalid token: ' + token);

  const key = token[1] || '*';
  if (key !== '.' && key !== '#' && key !== '*') {
    throw new SyntaxError(`invalid selector for optimization '${selector}'`);
  }

  const length = token[1].length + token[2].length;
  const compileQuery =
    selector.slice(0, index) +
    (' >+~'.indexOf(selector.charAt(index - 1)) > -1
      ? (':['.indexOf(selector.charAt(index + length + 1)) > -1 ? '*' : '')
      : '') +
    selector.slice(index + length - (token[1] == '*' ? 1 : 0));

  return {
    key,
    query: token[2],
    compileQuery,
  };
}

const stopAfterFirst: QueryCallback = () => false;

// equivalent of w3c 'querySelector' method
export function queryFirst(selectors: string, context: QueryContext, snap: Snapshot, isApiEntry = true): Element | null {
  return querySelect(selectors, context, stopAfterFirst, snap, isApiEntry)[0] || null;
}

// equivalent of w3c 'closest' method
export function queryClosest(selectors: string, element: Element, snap: Snapshot): Element | null {
  let el: Element | null = element;
  snap.update(element, true /*updateScope*/);
  while (el) {
    if (matchStrict(selectors, el, snap, null)) break;
    el = el.parentElement;
  }
  return el;
}

function hasScopeSelector(selectors: string[]) {
  return selectors.some(sel => /:scope\b/i.test(sel));
}
