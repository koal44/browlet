import type {
  CompoundSelector, RelativeSelectorList, SelectorList, ComplexSelector, Combinator,
  BuildContext, CandidateTest,
} from '../parser/parser';
import { emitClassTest, emitIdTest, emitTagTest } from '../compile/emit-seedable';

export type Filter = {
  source: string;
  declarations: string[];
  cost: number;
  usesScope: boolean;
  usesCache: boolean;
};

export type BuildMode = {
  frontierAware?: boolean;
};

export function buildStrictMatcher(list: SelectorList, ctx: BuildContext): Filter {
  return {
    source: buildStrictSelectorListMatch(list, ctx),
    declarations: ctx.declarations,
    cost: list.cost,
    usesScope: list.usesScope,
    usesCache: list.usesCache,
  };
}

export function buildStrictComplexMatcher(
  complex: ComplexSelector,
  ctx: BuildContext,
  mode: BuildMode = {},
): Filter {
  return {
    source: buildComplexSelectorMatch(complex, ctx, mode),
    declarations: ctx.declarations,
    cost: complex.cost,
    usesScope: complex.usesScope,
    usesCache: complex.usesCache,
  };
}

export function createBuildContext(): BuildContext {
  return { nextPredicate: 0, declarations: [] };
}

export function buildStrictSelectorListMatch(
  list: SelectorList,
  ctx: BuildContext,
  mode: BuildMode = {},
): string {
  if (list.selectors.length === 0) {
    throw new Error('Cannot build matcher for empty selector list');
  }

  const selectors = list.selectors.slice();
  selectors.sort((a, b) => a.cost - b.cost);

  const arms = selectors.map((complex) => buildComplexSelectorMatch(complex, ctx, mode));
  return arms.length === 1 ? arms[0] : `((${arms.join(')||(')}))`;
}

export function buildForgivingSelectorListMatch(
  list: SelectorList,
  ctx: BuildContext,
  mode: BuildMode = {},
): string {
  if (list.selectors.length === 0) return 'false';

  return buildStrictSelectorListMatch(list, ctx, mode);
}

export function buildComplexSelectorMatch(
  complex: ComplexSelector,
  ctx: BuildContext,
  mode: BuildMode = {},
): string {
  const { parts } = complex;

  if (parts.length === 0) {
    throw new Error('Cannot build matcher for empty complex selector');
  }

  let source = buildCompoundTest(parts[0].compound, ctx);

  for (let i = 1; i < parts.length; i++) {
    const { combinator, compound } = parts[i];

    const left = definePredicate(source, ctx, i - 1, mode);
    const right = buildCompoundTest(compound, ctx);

    source = `${right}&&${buildCombinatorCall(combinator, left, mode)}`;
  }

  return source;
}

export function buildCompoundTest(compound: CompoundSelector, ctx: BuildContext): string {
  const tests: CandidateTest[] = [];

  if (compound.id && !compound.id.seed) {
    tests.push(emitIdTest(compound.id));
  }

  if (compound.classes) {
    for (let i = 0; i < compound.classes.length; i++) {
      const cls = compound.classes[i];
      if (!cls.seed) tests.push(emitClassTest(cls));
    }
  }

  if (compound.tag && !compound.tag.seed) {
    tests.push(emitTagTest(compound.tag));
  }

  for (let i = 0; i < compound.tests.length; i++) {
    tests.push(compound.tests[i]);
  }

  const n = tests.length;
  if (n === 0) return 'true';
  if (n === 1) return buildCandidateTest(tests[0], ctx);

  tests.sort((a, b) => a.cost - b.cost);

  const sources: string[] = [];
  for (let i = 0; i < n; i++) {
    sources[i] = buildCandidateTest(tests[i], ctx);
  }

  return sources.join('&&');
}

function buildCombinatorCall(combinator: Combinator | null, pred: string, mode: BuildMode): string {
  const frontierArg = mode.frontierAware ? ',provenPart' : '';

  switch (combinator) {
    case ' ': return `s.matchAncestor(e,${pred},rc${frontierArg})`;
    case '>': return `s.matchParent(e,${pred},rc${frontierArg})`;
    case '+': return `s.matchPrev(e,${pred},rc${frontierArg})`;
    case '~': return `s.matchPrevAny(e,${pred},rc${frontierArg})`;
    default:
      throw new Error(`Invalid combinator in complex selector: ${String(combinator)}`);
  }
}

export function buildRelativeSelectorListMatch(list: RelativeSelectorList, ctx: BuildContext): string {
  if (list.arms.length === 0) return 'false';

  const arms = list.arms.map((arm) => {
    const steps = arm.steps.map((step, i) => {
      const source = buildCompoundTest(step.compound.compound, ctx);
      const pred = definePredicate(source, ctx, i, {});
      return `[${JSON.stringify(step.combinator)},${pred}]`;
    });

    return `s.matchHas([${steps.join(',')}],e,rc)`;
  });

  return arms.length === 1 ? arms[0] : `((${arms.join(')||(')}))`;
}

function buildCandidateTest(test: CandidateTest, ctx: BuildContext): string {
  return 'buildSource' in test ? test.buildSource(ctx) : test.source;
}

function definePredicate(source: string, ctx: BuildContext, partIndex: number, mode: BuildMode): string {
  const name = `P${ctx.nextPredicate++}`;

  if (mode.frontierAware) {
    ctx.declarations.push(`function ${name}(e,rc,provenPart){return provenPart===${partIndex}||(${source});}\n`);
  } else {
    ctx.declarations.push(`function ${name}(e,rc){return (${source});}\n`);
  }

  return name;
}
