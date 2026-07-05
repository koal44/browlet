import type {
  CandidateTest, ClassSelector, ComplexPart, ComplexSelector, CompoundSelector, HostSelector, IdSelector, SelectorList, TagSelector,
} from '../parser/parser';
import { asciiLower } from '../../utils/css';
import { costComplex, costCompound, costPart } from './cost';
import { emitNotPseudoTest } from '../compile/emit';

const NEVER_CMPD: CompoundSelector = {
  id: { raw: '__never__', seed: false, cost: 3 },
  tests: [{ build: () => () => false, cost: 0, debug: { kind: 'pseudo', name: 'xfalse' } }],
  usesScope: false,
  usesCache: false,
  cost: 3,
};

export function liftHostSelectorList(list: SelectorList): SelectorList {
  const arms = expandSelectorListContainingHost(list);

  if (arms === list.arms) return list;

  return selectorListFromArms(arms);
}

function selectorListFromArms(arms: ComplexSelector[]): SelectorList {
  let cost = 0;
  let usesScope = false;
  let usesCache = false;

  for (let i = 0; i < arms.length; i++) {
    const arm = arms[i];

    cost += arm.cost;
    usesScope = usesScope || arm.usesScope;
    usesCache = usesCache || arm.usesCache;
  }

  return {
    arms,
    cost,
    usesScope,
    usesCache,
  };
}

function expandSelectorListContainingHost(list: SelectorList): ComplexSelector[] {
  let current = list.arms;

  while (true) {
    let changed = false;
    let next: ComplexSelector[] | null = null;

    for (let i = 0; i < current.length; i++) {
      const arm = current[i];
      const expanded = expandOneHostArm(arm);
      // const expanded = expandOneHostIsWhereArm(arm);

      if (!expanded) {
        if (next) next.push(arm);
        continue;
      }

      if (!next) next = current.slice(0, i);
      changed = true;

      for (let j = 0; j < expanded.length; j++) {
        next.push(expanded[j]);
      }
    }

    if (!changed) return current;
    current = next!;
  }
}

function expandOneHostArm(arm: ComplexSelector): ComplexSelector[] | null {
  return expandOneHostIsWhereArm(arm) ?? expandOneHostNotArm(arm);
}

function expandOneHostIsWhereArm(arm: ComplexSelector): ComplexSelector[] | null {
  const parts = arm.parts;

  for (let partIndex = 0; partIndex < parts.length; partIndex++) {
    const part = parts[partIndex];
    const compound = part.compound;
    const tests = compound.tests;

    for (let testIndex = 0; testIndex < tests.length; testIndex++) {
      const test = tests[testIndex];
      const list = test.pseudoIs ?? test.pseudoWhere;

      if (!list || !selectorListContainsHost(list)) continue;

      return expandAtHostIsWhere(arm, partIndex, testIndex, list);
    }
  }

  return null;
}

function expandAtHostIsWhere(
  arm: ComplexSelector,
  partIndex: number,
  testIndex: number,
  list: SelectorList,
): ComplexSelector[] | null {
  const outerPart = arm.parts[partIndex];
  const baseCompound = compoundWithoutTest(outerPart.compound, testIndex);
  const expanded: ComplexSelector[] = [];

  for (let i = 0; i < list.arms.length; i++) {
    const argumentArm = list.arms[i];

    if (argumentArm.parts.length === 0) return null;

    expanded.push(expandArgumentArmIntoHostArm(
      arm,
      partIndex,
      baseCompound,
      argumentArm,
    ));
  }

  return expanded.length ? expanded : null;
}

function expandArgumentArmIntoHostArm(
  hostArm: ComplexSelector,
  partIndex: number,
  baseCompound: CompoundSelector,
  argumentArm: ComplexSelector,
): ComplexSelector {
  const hostPart = hostArm.parts[partIndex];
  const argumentParts = argumentArm.parts;
  const argumentSubjectIndex = argumentParts.length - 1;

  const parts: ComplexPart[] = [];

  // Prefix before the :is/:where-containing part.
  for (let i = 0; i < partIndex; i++) {
    parts.push(hostArm.parts[i]);
  }

  // Splice the argument complex selector into the host arm.
  for (let i = 0; i < argumentParts.length; i++) {
    const argumentPart = argumentParts[i];

    const compound = i === argumentSubjectIndex
      ? mergeCompounds(baseCompound, argumentPart.compound)
      : cloneCompound(argumentPart.compound);

    const part: ComplexPart = {
      // The first inserted argument part inherits the outer combinator.
      // Later argument parts keep their own internal combinators.
      combinator: i === 0 ? hostPart.combinator : argumentPart.combinator,
      compound,
      cost: 0,
    };

    part.cost = costPart(part);
    parts.push(part);
  }

  // Suffix after the :is/:where-containing part.
  // Its combinator already points from the old subject position to the next part;
  // after splicing, it now points from the argument subject to the next part.
  for (let i = partIndex + 1; i < hostArm.parts.length; i++) {
    parts.push(hostArm.parts[i]);
  }

  return {
    parts,
    usesScope: complexUsesScope(parts),
    usesCache: complexUsesCache(parts),
    cost: costComplex(parts),
    hasSeed: false,
  };
}

type HostNotProjection = {
  // null means :not(:host), which has no host-boundary arm.
  arg: CompoundSelector | null;
};

function expandOneHostNotArm(arm: ComplexSelector): ComplexSelector[] | null {
  const parts = arm.parts;

  for (let partIndex = 0; partIndex < parts.length; partIndex++) {
    const part = parts[partIndex];
    const compound = part.compound;
    const tests = compound.tests;

    for (let testIndex = 0; testIndex < tests.length; testIndex++) {
      const test = tests[testIndex];
      if (!test.pseudoNot) continue;

      const projection = extractHostNotProjection(test.pseudoNot);
      if (!projection) continue;

      return expandAtHostNot(arm, partIndex, testIndex, projection);
    }
  }

  return null;
}

function expandAtHostNot(
  arm: ComplexSelector,
  partIndex: number,
  testIndex: number,
  projection: HostNotProjection,
): ComplexSelector[] {
  const outerPart = arm.parts[partIndex];
  const baseCompound = compoundWithoutTest(outerPart.compound, testIndex);
  const expanded: ComplexSelector[] = [];

  // Ordinary element branch:
  //
  // :not(:host(.x)) is true for ordinary elements because :host(.x)
  // is false on ordinary elements. So remove the :not() test.
  //
  // But if the remaining base compound itself contains :host/:host-context,
  // there is no ordinary branch.
  if (!compoundHasDirectHostBoundary(baseCompound)) {
    expanded.push(replacePartCompound(arm, partIndex, baseCompound));
  }

  // Host-boundary branch:
  //
  // :not(:host) contributes no host branch.
  // :not(:host(.x)) contributes :host(:not(.x)).
  if (projection.arg) {
    const hostBase = projectCompoundToHostBoundary(baseCompound);

    if (hostBase) {
      const hostCompound = applyNegatedHostArg(hostBase, projection.arg);
      expanded.push(replacePartCompound(arm, partIndex, hostCompound));
    }
  }

  // Example: :host:not(:host) has no ordinary branch and no host branch.
  if (expanded.length === 0) {
    return [replacePartCompound(arm, partIndex, NEVER_CMPD)];
  }

  return expanded;
}

function extractHostNotProjection(list: SelectorList): HostNotProjection | null {
  const arg = extractBareHostQuestionArg(list);
  if (arg === undefined) return null;

  return { arg };
}

function extractBareHostQuestionArg(list: SelectorList): CompoundSelector | null | undefined {
  if (list.arms.length !== 1) return undefined;

  const arm = list.arms[0];
  if (arm.parts.length !== 1) return undefined;

  return extractBareHostQuestionArgFromCompound(arm.parts[0].compound);
}

function extractBareHostQuestionArgFromCompound(compound: CompoundSelector): CompoundSelector | null | undefined {
  if (
    compound.id ||
    compound.tag ||
    compound.classes?.length ||
    compound.hostContext
  ) {
    return undefined;
  }

  // :host or :host(ARG)
  if (compound.host) {
    if (compound.tests.length !== 0) return undefined;
    return compound.host.arg ? cloneCompound(compound.host.arg) : null;
  }

  // Narrow nested logical support:
  // :not(:is(:host(.x)))
  // :not(:where(:host(.x)))
  if (compound.tests.length === 1) {
    const list = compound.tests[0].pseudoIs ?? compound.tests[0].pseudoWhere;
    if (!list) return undefined;

    return extractBareHostQuestionArg(list);
  }

  return undefined;
}

function compoundHasDirectHostBoundary(compound: CompoundSelector): boolean {
  return !!compound.host || !!compound.hostContext;
}

function projectCompoundToHostBoundary(compound: CompoundSelector): CompoundSelector | null {
  if (
    compound.id ||
    compound.tag ||
    compound.classes?.length ||
    compound.tests.length !== 0
  ) {
    return null;
  }

  // Existing host-boundary compound.
  if (compound.host || compound.hostContext) {
    return cloneCompound(compound);
  }

  // Empty base compound from :not(:host(...)).
  // Synthesize the featureless host boundary.
  return finalizeCompound({
    host: { cost: 1 },
    tests: [],
    usesScope: false,
    usesCache: false,
    cost: 0,
  });
}

function applyNegatedHostArg(base: CompoundSelector, arg: CompoundSelector): CompoundSelector {
  const negatedArg = compoundFromTest(
    emitNotPseudoTest(selectorListFromCompound(cloneCompound(arg))),
  );

  const out = cloneCompound(base);
  out.host = mergeHostWithArg(out.host, negatedArg);

  return finalizeCompound(out);
}

function mergeHostWithArg(host: HostSelector | undefined, arg: CompoundSelector): HostSelector {
  if (!host) {
    return {
      arg,
      cost: 1 + arg.cost,
    };
  }

  if (!host.arg) {
    return {
      arg,
      cost: 1 + arg.cost,
    };
  }

  const merged = mergeCompounds(host.arg, arg);

  return {
    arg: merged,
    cost: 1 + merged.cost,
  };
}

function compoundFromTest(test: CandidateTest): CompoundSelector {
  return finalizeCompound({
    tests: [test],
    usesScope: false,
    usesCache: false,
    cost: 0,
  });
}

function selectorListFromCompound(compound: CompoundSelector): SelectorList {
  return {
    arms: [{
      parts: [{ combinator: null, compound, cost: compound.cost }],
      usesScope: compound.usesScope,
      usesCache: compound.usesCache,
      cost: compound.cost,
    }],
    usesScope: compound.usesScope,
    usesCache: compound.usesCache,
    cost: compound.cost,
  };
}

function replacePartCompound(
  arm: ComplexSelector,
  partIndex: number,
  compound: CompoundSelector,
): ComplexSelector {
  const parts: ComplexPart[] = [];

  for (let i = 0; i < arm.parts.length; i++) {
    const old = arm.parts[i];

    if (i !== partIndex) {
      parts.push(old);
      continue;
    }

    const part: ComplexPart = {
      combinator: old.combinator,
      compound,
      cost: 0,
    };

    part.cost = costPart(part);
    parts.push(part);
  }

  return {
    parts,
    usesScope: complexUsesScope(parts),
    usesCache: complexUsesCache(parts),
    cost: costComplex(parts),
    hasSeed: false,
  };
}

function cloneHost(host: HostSelector | undefined): HostSelector | undefined {
  if (!host) return undefined;

  return host.arg
    ? { arg: cloneCompound(host.arg), cost: host.cost }
    : { cost: host.cost };
}

function cloneCompound(compound: CompoundSelector): CompoundSelector {
  return finalizeCompound({
    id: cloneId(compound.id),
    tag: cloneTag(compound.tag),
    classes: cloneClasses(compound.classes),
    host: cloneHost(compound.host),
    hostContext: compound.hostContext,
    tests: compound.tests.slice(),
    usesScope: false,
    usesCache: false,
    cost: 0,
  });
}

function selectorListContainsHost(list: SelectorList): boolean {
  for (let i = 0; i < list.arms.length; i++) {
    if (complexContainsHost(list.arms[i])) return true;
  }

  return false;
}

function complexContainsHost(complex: ComplexSelector): boolean {
  const parts = complex.parts;

  for (let i = 0; i < parts.length; i++) {
    if (compoundContainsHost(parts[i].compound)) return true;
  }

  return false;
}

function compoundContainsHost(compound: CompoundSelector): boolean {
  if (compound.host || compound.hostContext) return true;

  const tests = compound.tests;
  for (let i = 0; i < tests.length; i++) {
    // const list = tests[i].pseudoIs ?? tests[i].pseudoWhere;
    const list = tests[i].pseudoIs ?? tests[i].pseudoWhere ?? tests[i].pseudoNot;

    if (list && selectorListContainsHost(list)) return true;
  }

  return false;
}

function compoundWithoutTest(compound: CompoundSelector, testIndex: number): CompoundSelector {
  const tests: CandidateTest[] = [];

  for (let i = 0; i < compound.tests.length; i++) {
    if (i !== testIndex) tests.push(compound.tests[i]);
  }

  return finalizeCompound({
    id: cloneId(compound.id),
    tag: cloneTag(compound.tag),
    classes: cloneClasses(compound.classes),
    host: cloneHost(compound.host),
    hostContext: compound.hostContext,
    tests,
    usesScope: false,
    usesCache: false,
    cost: 0,
  });
}

function mergeCompounds(base: CompoundSelector, argument: CompoundSelector): CompoundSelector {
  const id = mergeIds(base.id, argument.id);
  if (id === false) return NEVER_CMPD;

  const tag = mergeTags(base.tag, argument.tag);
  if (tag === false) return NEVER_CMPD;

  return finalizeCompound({
    id,
    tag,
    classes: mergeClasses(base.classes, argument.classes),
    host: mergeHosts(base.host, argument.host),
    hostContext: base.hostContext ?? argument.hostContext,
    tests: [...argument.tests, ...base.tests],
    usesScope: false,
    usesCache: false,
    cost: 0,
  });
}

function mergeIds(a: IdSelector | undefined, b: IdSelector | undefined): IdSelector | undefined | false {
  if (!a) return cloneId(b);
  if (!b) return cloneId(a);

  return a.raw === b.raw
    ? { ...a, seed: false }
    : false;
}

function mergeTags(a: TagSelector | undefined, b: TagSelector | undefined): TagSelector | undefined | false {
  if (!a) return cloneTag(b);
  if (!b) return cloneTag(a);

  const samePrefix = a.prefixRaw === b.prefixRaw;
  const sameLocal = asciiLower(a.localRaw) === asciiLower(b.localRaw);

  return samePrefix && sameLocal
    ? { ...a, seed: false }
    : false;
}

function mergeClasses(
  a: ClassSelector[] | undefined,
  b: ClassSelector[] | undefined,
): ClassSelector[] | undefined {
  if (!a && !b) return undefined;

  const out: ClassSelector[] = [];

  if (b) {
    for (let i = 0; i < b.length; i++) {
      out.push({ ...b[i], seed: false });
    }
  }

  if (a) {
    for (let i = 0; i < a.length; i++) {
      out.push({ ...a[i], seed: false });
    }
  }

  return out.length ? out : undefined;
}

function mergeHosts(a: HostSelector | undefined, b: HostSelector | undefined): HostSelector | undefined {
  if (!a) return cloneHost(b);
  if (!b) return cloneHost(a);

  if (!a.arg && !b.arg) {
    return { cost: 1 };
  }

  if (!a.arg) return cloneHost(b);
  if (!b.arg) return cloneHost(a);

  const arg = mergeCompounds(a.arg, b.arg);

  return {
    arg,
    cost: 1 + arg.cost,
  };
}

function finalizeCompound(compound: CompoundSelector): CompoundSelector {
  compound.usesScope = compoundUsesScope(compound);
  compound.usesCache = compoundUsesCache(compound);
  compound.cost = costCompound(compound);
  return compound;
}

function compoundUsesScope(compound: CompoundSelector): boolean {
  if (compound.host?.arg?.usesScope) return true;
  if (compound.hostContext?.arg.usesScope) return true;

  for (let i = 0; i < compound.tests.length; i++) {
    if (compound.tests[i].usesScope) return true;
  }

  return false;
}

function compoundUsesCache(compound: CompoundSelector): boolean {
  if (compound.host?.arg?.usesCache) return true;
  if (compound.hostContext?.arg.usesCache) return true;

  for (let i = 0; i < compound.tests.length; i++) {
    if (compound.tests[i].usesCache) return true;
  }

  return false;
}

function complexUsesScope(parts: ComplexPart[]): boolean {
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].compound.usesScope) return true;
  }

  return false;
}

function complexUsesCache(parts: ComplexPart[]): boolean {
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].compound.usesCache) return true;
  }

  return false;
}

function cloneId(id: IdSelector | undefined): IdSelector | undefined {
  return id ? { ...id, seed: false } : undefined;
}

function cloneTag(tag: TagSelector | undefined): TagSelector | undefined {
  return tag ? { ...tag, seed: false } : undefined;
}

function cloneClasses(classes: ClassSelector[] | undefined): ClassSelector[] | undefined {
  if (!classes) return undefined;

  const out: ClassSelector[] = [];
  for (let i = 0; i < classes.length; i++) {
    out.push({ ...classes[i], seed: false });
  }

  return out;
}
