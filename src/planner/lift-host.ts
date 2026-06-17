import type {
  CandidateTest, ClassSelector, ComplexPart, ComplexSelector, CompoundSelector, IdSelector, SelectorList, TagSelector,
} from '../parser/parser';
import { asciiLower } from '../utils/css';
import { costComplex, costPart } from './cost';

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
      const expanded = expandOneHostIsWhereArm(arm);

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

function cloneCompound(compound: CompoundSelector): CompoundSelector {
  return finalizeCompound({
    id: cloneId(compound.id),
    tag: cloneTag(compound.tag),
    classes: cloneClasses(compound.classes),
    host: compound.host,
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
    const list = tests[i].pseudoIs ?? tests[i].pseudoWhere;

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
    host: compound.host,
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
    host: base.host ?? argument.host,
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

function finalizeCompound(compound: CompoundSelector): CompoundSelector {
  compound.usesScope = compoundUsesScope(compound);
  compound.usesCache = compoundUsesCache(compound);
  compound.cost = compoundCost(compound);
  return compound;
}

function compoundCost(compound: CompoundSelector): number {
  let cost = 0;

  if (compound.id) cost += compound.id.cost;
  if (compound.tag) cost += compound.tag.cost;
  if (compound.host) cost += compound.host.cost;

  if (compound.classes) {
    for (let i = 0; i < compound.classes.length; i++) {
      cost += compound.classes[i].cost;
    }
  }

  for (let i = 0; i < compound.tests.length; i++) {
    cost += compound.tests[i].cost;
  }

  return cost;
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
