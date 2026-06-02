import { seedsByTag } from '../seeds/seedsByTag';
import type { Filter } from './filter';
import { buildStrictComplexMatcher, createBuildContext } from './filter';
import type { ComplexSelector, SelectorList } from '../parser/parser';
import { cssIdentUnescape } from '../utils/css';
import { expandSelectorListForSeeding } from './pseudo-lift';

type CandidateGroupDraft = {
  arms: ComplexSelector[];
  candidates: CandidatePlan;
};

export type CandidateGroupPlan = {
  candidates: CandidatePlan;
  filter: Filter;
};

export function planCandidateGroups(list: SelectorList, snap: Snapshot): CandidateGroupPlan[] {
  const arms = expandSelectorListForSeeding(list);
  const drafts = buildCandidateGroupDrafts(arms, snap);
  drafts.sort(compareCandidateGroupDrafts);
  return finalizeCandidateGroupDrafts(drafts);
}

function buildCandidateGroupDrafts(arms: ComplexSelector[], snap: Snapshot): CandidateGroupDraft[] {
  arms.sort((a, b) => a.cost - b.cost);
  // arms.sort((a, b) => b.cost - a.cost);

  const drafts: CandidateGroupDraft[] = [];

  for (let i = 0; i < arms.length; i++) {
    const arm = arms[i];
    const candidates = planCandidateLookup(arm, snap);

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

    drafts.push({ candidates, arms: [arm] });
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
    let usesCache = false;

    for (let j = 0; j < d.arms.length; j++) {
      const arm = d.arms[j];
      const built = buildStrictComplexMatcher(arm, ctx);

      sources[j] = built.source;
      cost += built.cost;
      usesScope ||= built.usesScope;
      usesCache ||= built.usesCache;
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
        usesCache,
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

function compareCandidateGroupDrafts(a: CandidateGroupDraft, b: CandidateGroupDraft): number {
  return candidateStrategyRank(a.candidates.strategy) - candidateStrategyRank(b.candidates.strategy)
    || draftCost(a) - draftCost(b);
}

function candidateStrategyRank(strategy: CandidatePlan['strategy']): number {
  switch (strategy) {
    case 'id': return 0;
    case 'class': return 1;
    case 'tag': return 2;
    case 'walk': return 3;
  }
}

function draftCost(draft: CandidateGroupDraft): number {
  let cost = 0;
  for (let i = 0; i < draft.arms.length; i++) {
    cost += draft.arms[i].cost;
  }
  return cost;
}

