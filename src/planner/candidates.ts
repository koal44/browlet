import { seedsByTag } from '../seeds/seedsByTag';
import type { Filter } from './filter';
import { buildStrictComplexMatcher, createBuildContext } from './filter';
import { type ComplexSelector, type SelectorList } from '../parser/parser';
import { cssIdentUnescape } from '../utils/css';

type CandidateGroupDraft = {
  arms: ComplexSelector[];
  candidates: CandidatePlan;
};

export type CandidateGroupPlan = {
  candidates: CandidatePlan;
  filter: Filter;
};

export function planCandidateGroups(list: SelectorList, snap: Snapshot): CandidateGroupPlan[] {
  const drafts = buildCandidateGroupDrafts(list, snap);
  return finalizeCandidateGroupDrafts(drafts);
}

function buildCandidateGroupDrafts(list: SelectorList, snap: Snapshot): CandidateGroupDraft[] {
  const arms = list.selectors;
  arms.sort((a, b) => a.cost - b.cost);

  const drafts: CandidateGroupDraft[] = [];

  for (let i = 0; i < arms.length; i++) {
    const arm = arms[i];

    const candidates = planCandidateLookup(arm, snap);

    // find existing draft
    let draft: CandidateGroupDraft | undefined;
    for (let j = 0; j < drafts.length; j++) {
      const d = drafts[j];
      if (sameCandidatePlan(d.candidates, candidates)) {
        draft = d;
        break;
      }
    }

    if (draft) {
      draft.arms.push(arm);
      continue;
    }

    drafts.push({
      candidates,
      arms: [arm],
    });
  }

  return drafts;
}

function finalizeCandidateGroupDrafts(drafts: CandidateGroupDraft[]): CandidateGroupPlan[] {
  const plans: CandidateGroupPlan[] = [];

  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i];

    const ctx = createBuildContext();
    const sources: string[] = [];
    let cost = 0;
    let usesScope = false;

    for (let j = 0; j < d.arms.length; j++) {
      const arm = d.arms[j];
      const built = buildStrictComplexMatcher(arm, ctx);

      sources[j] = built.source;
      cost += built.cost;
      usesScope ||= built.usesScope;
    }

    plans[i] = {
      candidates: d.candidates,
      filter: {
        source: sources.length === 1
          ? sources[0]
          : `((${sources.join(')||(')}))`,
        declarations: ctx.declarations,
        cost,
        usesScope,
      },
    };
  }

  return plans;
}

function sameCandidatePlan(a: CandidatePlan, b: CandidatePlan): boolean {
  return a.strategy === b.strategy
    && a.lookupQuery === b.lookupQuery;
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
