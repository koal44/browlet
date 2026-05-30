import { seedsByTag } from '../candidates/seedsByTag';
import { compileMatchList, compileSelectComplex, type SelectLambda, type MatchLambda } from '../compile/compile';
import type { HashCache } from '../compile/runtime';
import { initDebugMatch, initDebugSelect, updateDebugMatch, updateDebugSelectBuild, updateDebugSelectRun } from '../debug';
import { parseSelectorList, type ComplexSelector, type SelectorList } from '../parser/parser';
import type { SelectCallback } from '../selectlet';
import { sortUniqueByDocPosition } from '../utils/collections';
import { cssIdentUnescape } from '../utils/css';

// equivalent of w3c 'matches' method
export function queryMatch(selectors: string, element: Element, snap: Snapshot, h: HashCache | null): boolean {
  snap.probe.match++;
  const isDebug = snap.isDebug;
  if (isDebug) initDebugMatch(snap, selectors, element, true /*isApiEntry*/);

  const resolver = getStrictMatchResolver(selectors, snap);

  if (resolver.usesScope) {
    snap.update(element, true /*updateScope*/);
  }

  const result = resolver.lambda(element, h);

  if (isDebug) updateDebugMatch(snap, resolver, result);

  return result;
}

export function matchStrict(selectors: string, element: Element, snap: Snapshot, h: HashCache | null): boolean {
  const resolver = getStrictMatchResolver(selectors, snap);
  return resolver.lambda(element, h);
}

export type MatchResolver = { lambda: MatchLambda; usesScope: boolean; };

function getStrictMatchResolver(selectors: string, snap: Snapshot): MatchResolver {
  let resolver = snap.strictMatchResolvers.get(selectors);

  if (!resolver) {
    const parsed = parseSelectorList(selectors, { pseudos: snap.pseudos });

    if (snap.isDebug && snap.debugMatch) {
      snap.debugMatch.parsed = [selectors]; // or serialize parsed later
    }

    resolver = buildStrictMatchResolver(parsed, selectors, snap);
    snap.strictMatchResolvers.set(selectors, resolver);
    snap.cacheSize++;
  }

  return resolver;
}

function buildStrictMatchResolver(list: SelectorList, selectors: string, snap: Snapshot): MatchResolver {
  snap.probe.matBuild++;
  snap.checkCacheWatermark();

  const lambda = compileMatchList(list, selectors, snap);

  if (snap.isDebug && snap.debugMatch) {
    snap.debugMatch.lambdaSource = snap.debugCompile ?? lambda.toString();
    snap.debugCompile = undefined;
  }

  return {
    lambda,
    usesScope: list.usesScope ?? false,
  };
}

// equivalent of w3c 'querySelectorAll' method
export function querySelect(sel: string, ctx: QueryContext, cb: SelectCallback | null, snap: Snapshot, isApiEntry = false): Element[] {
  snap.probe.select++;
  const isDebug = snap.isDebug;
  if (isDebug) initDebugSelect(snap, sel, cb, ctx, isApiEntry);

  let resolver = snap.selectResolvers.get(sel);
  if (!resolver || resolver.hasCb !== !!cb) {
    const parsed = parseSelectorList(sel, { pseudos: snap.pseudos });
    resolver = buildSelectResolver(parsed, !!cb, snap);
    snap.selectResolvers.set(sel, resolver);
    snap.cacheSize++;
  }

  snap.update(ctx, isApiEntry && resolver.usesScope);

  const results: Element[] = [];
  const cache: HashCache = {};
  const arms = resolver.arms;

  for (const arm of arms) {
    const candidates = arm.plan.lookup(ctx);
    const stopped = arm.matcher(candidates, cb, ctx, results, cache);

    if (isDebug) updateDebugSelectRun(snap, arm, candidates, results);
    if (stopped) break;
  }

  if (arms.length > 1 && results.length > 1) {
    sortUniqueByDocPosition(results);
  }

  return results;
}

export type SelectResolver = { arms: SelectArm[]; hasCb: boolean; usesScope: boolean; };
export type SelectArm = { plan: CandidatePlan; matcher: SelectLambda; };

function buildSelectResolver(list: SelectorList, hasCb: boolean, snap: Snapshot): SelectResolver {
  snap.checkCacheWatermark();
  const arms: SelectArm[] = [];
  snap.probe.selBuild++;

  for (const complex of list.selectors) {
    const plan = planCandidateLookup(complex, snap);

    // Compile the residual matcher; seed-supplied simple selectors are skipped.
    const matcher = compileSelectComplex(complex, hasCb, snap);

    arms.push({
      plan,
      matcher,
    });

    if (snap.isDebug) {
      updateDebugSelectBuild(snap, complex, plan, matcher);
    }
  }

  const usesScope = list.usesScope ?? false;
  return { arms, usesScope, hasCb };
}

export type CandidatePlan = {
  strategy: 'id' | 'class' | 'tag' | 'walk';
  lookupQuery: string;
  lookup: (ctx: QueryContext) => Element[];
};

// Marks seed-supplied simple selectors so residual matcher generation can skip them.
function planCandidateLookup(complex: ComplexSelector, snap: Snapshot): CandidatePlan {
  if (complex.parts.length === 0) {
    throw new Error('Cannot plan candidates for empty complex selector');
  }
  const last = complex.parts[complex.parts.length - 1].compound;

  if (last.id) {
    const query = cssIdentUnescape(last.id.raw);

    last.id.seed = true;
    complex.hasSeed = true;

    return {
      strategy: 'id',
      lookupQuery: query,
      lookup: (ctx) => snap.seedsById(query, ctx),
    };
  }

  if (last.classes?.length) {
    const classes = last.classes.map((c) => cssIdentUnescape(c.raw));

    if (classes.some((c) => /[\t\n\f\r ]/.test(c))) {
      return {
        strategy: 'class',
        lookupQuery: classes[0] ?? '',
        lookup: () => [],
      };
    }

    for (const cls of last.classes) cls.seed = true;
    complex.hasSeed = true;

    return {
      strategy: 'class',
      lookupQuery: classes.join('.'),
      lookup: (ctx) => snap.seedsByClass(classes, ctx),
    };
  }

  if (last.tag) {
    const { prefixRaw, localRaw } = last.tag;
    const query = localRaw === '*' ? '*' : cssIdentUnescape(localRaw);

    // tag lookup is a localName superset; |tag and |* still need namespace filtering.
    if (prefixRaw !== '') {
      last.tag.seed = true;
      complex.hasSeed = true;
    }

    return {
      strategy: 'tag',
      lookupQuery: query,
      lookup: (ctx) => seedsByTag(query, ctx, snap),
    };
  }

  return {
    strategy: 'walk',
    lookupQuery: '*',
    lookup: (ctx) => seedsByTag('*', ctx, snap),
  };
}

const stopAfterFirst: SelectCallback = () => false;

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
