import { buildForgivingSelectorListMatch } from './filter';
import type {
  CandidateTest, CompoundSelector, ComplexSelector, SelectorList, IdSelector, TagSelector, ClassSelector,
  ComplexPart,
} from '../parser/parser';
import { costComplex, costPart } from './cost';
import { asciiLower } from '../utils/css';

const enum SeedRank {
  None = 0,
  Tag = 1,
  Class = 2,
  Id = 3,
}

const NEVER_CMPD: CompoundSelector = {
  id: { raw: '__never__', seed: false, cost: 3 },
  tests: [{ source: 'false', cost: 0, debug: { kind: 'pseudo', name: 'xfalse' } }],
  usesScope: false,
  cost: 3,
};

const NEVER_ARM: ComplexSelector = {
  parts: [{
    combinator: null,
    compound: NEVER_CMPD,
    cost: NEVER_CMPD.cost,
  }],
  hasSeed: false,
  usesScope: false,
  cost: NEVER_CMPD.cost,
};

export function expandSelectorListForSeeding(list: SelectorList): ComplexSelector[] {
  const out: ComplexSelector[] = [];
  const arms = list.selectors;

  for (let i = 0; i < arms.length; i++) {
    const arm = arms[i];
    const baseSeedRank = getSubjectSeedRank(arm);

    const expanded = expandSeedLiftableIsWhere(arm, baseSeedRank);

    if (!expanded) {
      out.push(arm);
      continue;
    }

    for (let j = 0; j < expanded.length; j++) {
      out.push(expanded[j]);
    }
  }

  return out;
}

function expandSeedLiftableIsWhere(
  hostArm: ComplexSelector,
  baseSeedRank: SeedRank,
): ComplexSelector[] | null {
  if (baseSeedRank === SeedRank.Id) return null;
  if (hostArm.parts.length === 0) return null;

  const subjectPartIndex = hostArm.parts.length - 1;
  const subjectCompound = hostArm.parts[subjectPartIndex].compound;

  let isWhereTestIndex = -1;
  let argumentList: SelectorList | undefined;

  // Find a :is/:where on the subject compound whose every argument arm exposes a better subject seed.
  for (let i = 0; i < subjectCompound.tests.length; i++) {
    const test = subjectCompound.tests[i];
    const list = test.pseudoIs ?? test.pseudoWhere;
    if (!list) continue;

    const worstRank = getWorstSubjectSeedRank(list);
    if (worstRank > baseSeedRank) {
      isWhereTestIndex = i;
      argumentList = list;
      break;
    }
  }

  if (!argumentList) return null;

  const expanded: ComplexSelector[] = [];

  // Split :is(.a > h1, .b) into one seed-lifted planning arm per argument arm.
  for (let i = 0; i < argumentList.selectors.length; i++) {
    const argumentArm = argumentList.selectors[i];

    // section ~ [lang]:is(.a > h1) -> section ~ h1[lang]:is(.a > *)
    const liftedArm = deriveSeedLiftedArm(
      hostArm,
      isWhereTestIndex,
      argumentArm,
    );

    // Do not partially expand; one incompatible argument arm means the whole expansion falls back.
    if (!liftedArm) return null;

    expanded.push(liftedArm);
  }

  return expanded.length ? expanded : null;
}

function deriveSeedLiftedArm(
  hostArm: ComplexSelector,
  isWhereTestIndex: number,
  argumentArm: ComplexSelector,
): ComplexSelector | null {
  const subjectPartIndex = hostArm.parts.length - 1;
  const subjectPart = hostArm.parts[subjectPartIndex];
  const subjectCompound = subjectPart.compound;

  // Split the argument arm: .a > h1.foo -> lifted h1.foo, residual .a > *
  const split = splitSubjectSeed(argumentArm);
  if (!split) return null;

  // Derive the new host subject:
  // [lang]:is(.a > h1) + lifted h1 + residual .a > * -> h1[lang]:is(.a > *)
  const expandedSubject = deriveExpandedSubjectCompound(
    subjectCompound,
    isWhereTestIndex,
    split.seed,
    split.residualArm,
  );

  if (!expandedSubject) return null;
  if (expandedSubject === NEVER_CMPD) return NEVER_ARM;

  const parts = hostArm.parts.slice();

  // Replace only the host subject compound; do not splice the argument path into the host path.
  const expandedSubjectPart: ComplexPart = {
    combinator: subjectPart.combinator,
    compound: expandedSubject,
    cost: 0,
  };
  expandedSubjectPart.cost = costPart(expandedSubjectPart);

  parts[subjectPartIndex] = expandedSubjectPart;

  return {
    parts,
    usesScope: hostArm.usesScope || argumentArm.usesScope,
    cost: costComplex(parts),
    hasSeed: false,
  };
}

type SubjectSeedSplit = {
  seed: LiftedSeed;
  residualArm: ComplexSelector;
};

type LiftedSeed = {
  id?: IdSelector;
  tag?: TagSelector;
  classes?: ClassSelector[];
};

function splitSubjectSeed(arm: ComplexSelector): SubjectSeedSplit | null {
  if (arm.parts.length === 0) return null;

  const subjectPartIndex = arm.parts.length - 1;
  const subjectPart = arm.parts[subjectPartIndex];
  const subjectCompound = subjectPart.compound;

  // Only id/class/tag can become normal candidate seeds.
  if (
    !subjectCompound.id &&
    !subjectCompound.tag &&
    !(subjectCompound.classes && subjectCompound.classes.length)
  ) {
    return null;
  }

  // Clone lifted id/class/tag with seed=false; the expanded arm is replanned,
  // so these should behave like ordinary simple selectors, not preselected seeds.
  const seed: LiftedSeed = {
    id: subjectCompound.id
      ? { ...subjectCompound.id, seed: false }
      : undefined,
    tag: subjectCompound.tag
      ? { ...subjectCompound.tag, seed: false }
      : undefined,
    classes: subjectCompound.classes
      ? subjectCompound.classes.map((cls) => ({ ...cls, seed: false }))
      : undefined,
  };

  // h1.foo:hover becomes *:hover in the residual arm after its seed selectors are lifted out.
  const residualCompound: CompoundSelector = {
    ...subjectCompound,
    id: undefined,
    tag: undefined,
    classes: undefined,
    tests: subjectCompound.tests,
  };

  const residualParts = arm.parts.slice();

  // .a > h1.foo:hover -> .a > *:hover
  const residualPart = {
    ...subjectPart,
    compound: residualCompound,
  };
  residualPart.cost = costPart(residualPart);
  residualParts[subjectPartIndex] = residualPart;

  const residualArm: ComplexSelector = {
    ...arm,
    parts: residualParts,
    hasSeed: false,
    cost: costComplex(residualParts),
  };

  return { seed, residualArm };
}

function deriveExpandedSubjectCompound(
  subjectCompound: CompoundSelector,
  isWhereTestIndex: number,
  liftedSeed: LiftedSeed,
  residualArm: ComplexSelector,
): CompoundSelector | null {
  if (
    subjectCompound.id &&
    liftedSeed.id &&
    subjectCompound.id.raw !== liftedSeed.id.raw
  ) {
    return NEVER_CMPD;
  }

  if (subjectCompound.tag && liftedSeed.tag) {
    const samePrefix = subjectCompound.tag.prefixRaw === liftedSeed.tag.prefixRaw;
    const sameLocal =
      asciiLower(subjectCompound.tag.localRaw) === asciiLower(liftedSeed.tag.localRaw);

    if (!samePrefix || !sameLocal) {
      // return buildAlwaysFalseSeedableCompound();
      return NEVER_CMPD;
    }
  }

  // Keep the subject id if present; otherwise install the lifted id.
  const expandedId = subjectCompound.id
    ? { ...subjectCompound.id, seed: false }
    : liftedSeed.id;

  // Keep the subject tag if present; otherwise install the lifted tag.
  const expandedTag = subjectCompound.tag
    ? { ...subjectCompound.tag, seed: false }
    : liftedSeed.tag;

  let expandedClasses: ClassSelector[] | undefined;

  // Subject classes and lifted classes are conjunctive: .x:is(.y) -> .x.y.
  if (subjectCompound.classes) {
    expandedClasses = subjectCompound.classes.map((cls) => ({ ...cls, seed: false }));
  }

  if (liftedSeed.classes) {
    if (expandedClasses) {
      for (let i = 0; i < liftedSeed.classes.length; i++) {
        expandedClasses.push(liftedSeed.classes[i]);
      }
    } else {
      expandedClasses = liftedSeed.classes;
    }
  }

  const expandedTests: CandidateTest[] = [];

  // Preserve all subject tests except the selected :is/:where test.
  for (let i = 0; i < subjectCompound.tests.length; i++) {
    if (i !== isWhereTestIndex) expandedTests.push(subjectCompound.tests[i]);
  }

  // [lang]:is(.b) -> .b[lang], so omit the residual pseudo if it became :is(*).
  if (!isTrivialResidualArm(residualArm)) {
    const test = subjectCompound.tests[isWhereTestIndex];

    if (test.debug?.kind !== 'is' && test.debug?.kind !== 'where') {
      throw new Error('Expected selected pseudo-lift test to be :is() or :where().');
    }

    expandedTests.push(buildResidualIsWhereTest(residualArm, test.debug.kind));
  }

  return {
    ...subjectCompound,
    id: expandedId,
    tag: expandedTag,
    classes: expandedClasses,
    tests: expandedTests,
  };
}

// Determine whether a residual argument arm has become trivial `*`.
function isTrivialResidualArm(arm: ComplexSelector): boolean {
  if (arm.parts.length !== 1) return false;

  const subjectCompound = arm.parts[0].compound;

  // A single empty compound is the residual form of :is(*) / :where(*).
  return !subjectCompound.id
    && !subjectCompound.tag
    && !(subjectCompound.classes && subjectCompound.classes.length)
    && subjectCompound.tests.length === 0;
}

function buildResidualIsWhereTest(residualArm: ComplexSelector, isOrWhere: 'is' | 'where'): CandidateTest {
  // Rebuild the selected :is/:where test with only this residual arm.
  const list: SelectorList = {
    selectors: [residualArm],
    cost: residualArm.cost,
    usesScope: residualArm.usesScope,
  };

  const where = isOrWhere === 'where';

  return {
    debug: {
      kind: 'expanded',
      list,
    },
    cost: list.cost,
    usesScope: list.usesScope,
    pseudoIs: where ? undefined : list,
    pseudoWhere: where ? list : undefined,
    buildSource: (ctx) => buildForgivingSelectorListMatch(list, ctx),
  };
}

function getSubjectSeedRank(arm: ComplexSelector): SeedRank {
  if (arm.parts.length === 0) return SeedRank.None;

  const subjectCompound = arm.parts[arm.parts.length - 1].compound;

  if (subjectCompound.id) return SeedRank.Id;
  if (subjectCompound.classes && subjectCompound.classes.length) return SeedRank.Class;
  if (subjectCompound.tag) return SeedRank.Tag;

  return SeedRank.None;
}

function getWorstSubjectSeedRank(list: SelectorList): SeedRank {
  if (list.selectors.length === 0) return SeedRank.None;

  let minRank = SeedRank.Id;

  // :is(#a, .b, h1) has minimum rank Tag, so every expanded arm is at least tag-seedable.
  for (let i = 0; i < list.selectors.length; i++) {
    const rank = getSubjectSeedRank(list.selectors[i]);

    if (rank === SeedRank.None) return SeedRank.None;
    if (rank < minRank) minRank = rank;
  }

  return minRank;
}
