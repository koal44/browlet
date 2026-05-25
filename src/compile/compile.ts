import { ComplexSelector, SelectorList } from "../parser/parser";
import { buildStrictComplexMatcher, buildStrictMatcher } from "./build";

export function compileMatchList(list: SelectorList, selectorKey: string, snap: Snapshot): MatchLambda {
  const cached = snap.matchLambdas.get(selectorKey);
  if (cached) return cached;

  const built = buildStrictMatcher(list);

  const f =
    `"use strict";` +
    built.declarations.join('') +
    `return function Resolver(c,h){` +
      `var e=c;` +
      `return ${built.source};` +
    `}`;

  if (snap.isDebug) snap.debugCompile = f;

  const lambda = Function('s', f)(snap) as MatchLambda;
  snap.matchLambdas.set(selectorKey, lambda);
  return lambda;
}

export function compileSelectComplex(complex: ComplexSelector, hasCb: boolean, snap: Snapshot): SelectLambda {
  const cache = hasCb ? snap.selectLambdasWithCb : snap.selectLambdasNoCb;
  const cacheKey = complex.source;

  if (!complex.hasSeed) {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  }

  const built = buildStrictComplexMatcher(complex);

  const callback = hasCb
    ? `if(f(e)===false){p=true;break main;}`
    : '';

  const f =
    `"use strict";` +
    built.declarations.join('') +
    `return function Resolver(c,f,x,r,h){` +
      `var e,j=r.length-1,k=-1,p=false;` +
      `main:while((e=c[++k])){` +
        `if(${built.source}){` +
          `r[++j]=e;` +
          callback +
        `}` +
      `}` +
      `return p;` +
    `}`;

  if (snap.isDebug) snap.debugCompile = f;

  const lambda = Function('s', f)(snap) as SelectLambda;

  if (!complex.hasSeed) {
    cache.set(cacheKey, lambda);
  }

  return lambda;
}
