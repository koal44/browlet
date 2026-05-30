/* eslint-disable @typescript-eslint/no-implied-eval */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import type { ComplexSelector, SelectorList } from '../parser/parser';
import { buildStrictComplexMatcher, buildStrictMatcher } from './build';
import type { HashCache } from './runtime';

export type MatchLambda = (candidate: Element, h: HashCache | null) => boolean;

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
  snap.cacheSize++;
  return lambda;
}

export type SelectLambda = (
  candidates: Element[],
  h: HashCache,
) => Element[];

export function compileSelectComplex(complex: ComplexSelector, snap: Snapshot): SelectLambda {
  const cacheKey = complex.source;

  if (!complex.hasSeed) {
    const cached = snap.selectLambdas.get(cacheKey);
    if (cached) return cached;
  }

  const built = buildStrictComplexMatcher(complex);

  const f =
    `"use strict";` +
    built.declarations.join('') +
    `return function Resolver(c,h){` +
      `var e,k=-1,j=-1,r=[];` +
      `while((e=c[++k])){` +
        `if(${built.source}){` +
          `r[++j]=e;` +
        `}` +
      `}` +
      `return r;` +
    `}`;

  if (snap.isDebug) snap.debugCompile = f;

  const lambda = Function('s', f)(snap) as SelectLambda;

  if (!complex.hasSeed) {
    snap.selectLambdas.set(cacheKey, lambda);
    snap.cacheSize++;
  }

  return lambda;
}

export type FirstLambda = (
  candidates: Element[],
  h: HashCache,
) => Element | null;

export function compileFirstComplex(complex: ComplexSelector, snap: Snapshot): FirstLambda {
  const cacheKey = complex.source;

  if (!complex.hasSeed) {
    const cached = snap.firstLambdas.get(cacheKey);
    if (cached) return cached;
  }

  const built = buildStrictComplexMatcher(complex);

  const f =
    `"use strict";` +
    built.declarations.join('') +
    `return function Resolver(c,h){` +
      `var e,k=-1;` +
      `while((e=c[++k])){` +
        `if(${built.source}){` +
          `return e;` +
        `}` +
      `}` +
      `return null;` +
    `}`;

  if (snap.isDebug) snap.debugCompile = f;

  const lambda = Function('s', f)(snap) as FirstLambda;

  if (!complex.hasSeed) {
    snap.firstLambdas.set(cacheKey, lambda);
    snap.cacheSize++;
  }

  return lambda;
}

// export function compileSelectWalkComplex(complex: ComplexSelector, hasCb: boolean, snap: Snapshot): SelectLambda {
//   const cache = hasCb ? snap.selectLambdasWithCb : snap.selectLambdasNoCb;
//   const cacheKey = `walk:${complex.source}`;

//   const cached = cache.get(cacheKey);
//   if (cached) return cached;

//   const built = buildStrictComplexMatcher(complex);

//   const f =
//     `"use strict";` +
//     built.declarations.join('') +
//     `return function Resolver(c,f,x,r,h){` +
//       `var e,n,stop,t=x.nodeType,j=r.length-1,p=false;` +

//       // Document: include documentElement.
//       // Element: descendants only.
//       // Fragment: top-level element children.
//       `if(t===9){e=x.documentElement;stop=null;}` +
//       `else if(t===1){e=x.firstElementChild;stop=x;}` +
//       `else{e=x.firstElementChild;stop=null;}` +

//       `main:while(e){` +
//         `if(${built.source}){` +
//           `r[++j]=e;` +
//           (hasCb ? `if(f(e)===false){p=true;break main;}` : '') +
//         `}` +

//         `n=e.firstElementChild;` +
//         `if(!n){` +
//           `n=e.nextElementSibling;` +
//           `while(!n&&(e=e.parentElement)&&e!==stop){n=e.nextElementSibling;}` +
//           `if(e===stop)n=null;` +
//         `}` +
//         `e=n;` +
//       `}` +

//       `return p;` +
//     `}`;

//   if (snap.isDebug) snap.debugCompile = f;

//   const lambda = Function('s', f)(snap) as SelectLambda;
//   cache.set(cacheKey, lambda);
//   return lambda;
// }
