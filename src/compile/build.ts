import type {
  CompoundSelector, RelativeSelectorList2, SelectorList, ComplexSelector, Combinator,
  BuildContext, CandidateTest,
} from "../parser/parser";
import { emitClassTest, emitIdTest, emitTagTest } from "./emit-base";

export type BuiltMatcher = {
  source: string;
  declarations: string[];
};

export function buildStrictMatcher(list: SelectorList): BuiltMatcher {
  const ctx = createBuildContext();
  return {
    source: buildStrictSelectorListMatch(list, ctx),
    declarations: ctx.declarations,
  };
}

export function buildStrictComplexMatcher(complex: ComplexSelector): BuiltMatcher {
  const ctx = createBuildContext();

  return {
    source: buildComplexSelectorMatch(complex, ctx),
    declarations: ctx.declarations,
  };
}

function createBuildContext(): BuildContext {
  return { nextPredicate: 0, declarations: [] };
}

export function buildStrictSelectorListMatch(list: SelectorList, ctx: BuildContext): string {
  if (list.selectors.length === 0) {
    throw new Error('Cannot build matcher for empty selector list');
  }

  const arms = list.selectors.map(complex => buildComplexSelectorMatch(complex, ctx));
  return arms.length === 1 ? arms[0] : `(${arms.join(')||(')})`;
}

export function buildForgivingSelectorListMatch(list: SelectorList, ctx: BuildContext): string {
  if (list.selectors.length === 0) return 'false';

  return buildStrictSelectorListMatch(list, ctx);
}

export function buildComplexSelectorMatch(complex: ComplexSelector, ctx: BuildContext): string {
  const { parts } = complex;

  if (parts.length === 0) {
    throw new Error('Cannot build matcher for empty complex selector');
  }

  let source = buildCompoundTest(parts[0].compound, ctx);

  for (let i = 1; i < parts.length; i++) {
    const { combinator, compound } = parts[i];

    const left = definePredicate(source, ctx);
    const right = buildCompoundTest(compound, ctx);

    source = `${right}&&${buildCombinatorCall(combinator, left)}`;
  }

  return source;
}

export function buildCompoundTest(compound: CompoundSelector, ctx: BuildContext): string {
  const tests: string[] = [];

  if (compound.id && !compound.id.seed) {
    tests.push(buildCandidateTest(emitIdTest(compound.id), ctx));
  }

  if (compound.classes) {
    for (const cls of compound.classes) {
      if (!cls.seed) tests.push(buildCandidateTest(emitClassTest(cls), ctx));
    }
  }

  if (compound.tag && !compound.tag.seed) {
    tests.push(buildCandidateTest(emitTagTest(compound.tag), ctx));
  }

  for (const test of compound.tests) {
    tests.push(buildCandidateTest(test, ctx));
  }

  return tests.length ? tests.join('&&') : 'true';
}

function buildCombinatorCall(combinator: Combinator | null, pred: string): string {
  switch (combinator) {
    case ' ': return `s.matchAncestor(e,${pred},h)`;
    case '>': return `s.matchParent(e,${pred},h)`;
    case '+': return `s.matchPrev(e,${pred},h)`;
    case '~': return `s.matchPrevAny(e,${pred},h)`;
    default:
      throw new Error(`Invalid combinator in complex selector: ${String(combinator)}`);
  }
}

export function buildRelativeSelectorListMatch(list: RelativeSelectorList2, ctx: BuildContext): string {
  return 'false'; // Placeholder until :has() relative selector matching is implemented
}

function buildCandidateTest(test: CandidateTest, ctx: BuildContext): string {
  return 'buildSource' in test ? test.buildSource(ctx) : test.source;
}

function definePredicate(source: string, ctx: BuildContext): string {
  const name = `P${ctx.nextPredicate++}`;
  ctx.declarations.push(`function ${name}(e,h){return ${source};}\n`);
  return name;
}
