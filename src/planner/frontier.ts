import type { RuntimeCache } from '../compile/runtimeCache';
import type { BuildContext, Combinator, ComplexSelector, CompoundSelector } from '../parser/parser';
import { cssIdentUnescape } from '../utils/css';
import type { CandidateGroupDraft } from './candidates';
import { buildCompoundTest, createBuildContext } from './filter';

export type FrontierResult =
  | { kind: 'context'; ctx: QueryContext; provenPart: number; }
  | { kind: 'candidates'; candidates: Element[]; provenPart: number; };

export type FrontierFn = (ctx: QueryContext, rc: RuntimeCache | null) => FrontierResult | undefined;

export function attachFrontiers(drafts: CandidateGroupDraft[], snap: Snapshot): void {
  for (let i = 0; i < drafts.length; i++) {
    const draft = drafts[i];

    if (draft.arms.length !== 1) continue;

    const frontier = buildFrontier(draft.arms[0], snap);
    if (frontier) draft.candidates.frontier = frontier;
  }
}

export function buildFrontier(complex: ComplexSelector, snap: Snapshot): FrontierFn | undefined {
  const { parts } = complex;
  if (parts.length < 2) return undefined;

  const head = parts[0].compound;

  let seedSource: string | undefined;

  if (head.id) {
    const id = cssIdentUnescape(head.id.raw);
    seedSource = `s.seedsById(${JSON.stringify(id)},ctx)`;
  } else if (head.classes?.length) {
    const classes = head.classes.map((c) => cssIdentUnescape(c.raw));
    if (classes.some((c) => /[\t\n\f\r ]/.test(c))) return undefined;

    seedSource = `s.seedsByClass(${JSON.stringify(classes)},ctx)`;
  } else {
    return undefined;
  }

  const buildCtx = createBuildContext();
  const sources: string[] = [];
  const declarations = buildCtx.declarations;
  const last = parts.length - 1;

  const headPred = defineFrontierPredicate(buildFrontierCompoundTest(head, buildCtx), buildCtx);

  sources.push(`var xs=${seedSource},e;`);
  sources.push(`xs=s.frontierFilter(xs,${headPred},rc);`);
  sources.push(`if(xs.length!==1)return undefined;`);
  sources.push(`e=xs[0];`);
  sources.push(`var ctx0=e,p=0;`);

  for (let i = 1; i < parts.length; i++) {
    const { combinator, compound } = parts[i];

    const advance = buildFrontierAdvanceCall(combinator);
    if (!advance) break;

    const pred = defineFrontierPredicate(buildFrontierCompoundTest(compound, buildCtx), buildCtx);

    sources.push(`xs=${advance}(xs,${pred},rc);`);

    if (i === last) {
      sources.push(`return xs.length?{kind:"candidates",candidates:xs,provenPart:${i}}:undefined;`);
      break;
    }

    sources.push(`if(xs.length!==1)return undefined;`);
    sources.push(`e=xs[0];`);
    sources.push(`ctx0=e;p=${i};`);
  }

  // If we stopped before the end, only use a singular proven frontier as a narrowed lookup context.
  sources.push(`return p>0?{kind:"context",ctx:ctx0,provenPart:p}:undefined;`);

  const f =
    `"use strict";` +
    declarations.join('') +
    `return function Frontier(ctx,rc){` +
      sources.join('') +
    `}`;

  if (snap.isDebug) snap.debugCompile = f;

  // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
  return Function('s', f)(snap) as FrontierFn;
}

function buildFrontierAdvanceCall(combinator: Combinator | null): string | undefined {
  switch (combinator) {
    case '>': return 's.frontierChildren';
    case '+': return 's.frontierNext';
    case '~': return 's.frontierFollowing';
    default: return undefined;
  }
}

function defineFrontierPredicate(source: string, ctx: BuildContext): string {
  const name = `F${ctx.nextPredicate++}`;
  ctx.declarations.push(`function ${name}(e,rc){return (${source});}\n`);
  return name;
}

function buildFrontierCompoundTest(compound: CompoundSelector, ctx: BuildContext): string {
  const idSeed = compound.id?.seed;
  const tagSeed = compound.tag?.seed;
  const classSeeds = compound.classes?.map((c) => c.seed);

  if (compound.id) compound.id.seed = false;
  if (compound.tag) compound.tag.seed = false;
  if (compound.classes) {
    for (const cls of compound.classes) cls.seed = false;
  }

  try {
    return buildCompoundTest(compound, ctx);
  } finally {
    if (compound.id) compound.id.seed = idSeed;
    if (compound.tag) compound.tag.seed = tagSeed;
    if (compound.classes && classSeeds) {
      for (let i = 0; i < compound.classes.length; i++) {
        compound.classes[i].seed = classSeeds[i];
      }
    }
  }
}
