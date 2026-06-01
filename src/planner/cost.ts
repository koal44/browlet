import type { Combinator, ComplexSelector, CompoundSelector } from '../parser/parser';
import { assertNever } from '../utils/util';

export function costComplex(parts: ComplexSelector['parts']): number {
  let cost = 0;

  for (let i = 0; i < parts.length; i++) {
    cost += costPart(parts[i]);
  }

  return cost;
}

export function costPart(part: ComplexSelector['parts'][number]): number {
  return combinatorCost(part.combinator) + costCompound(part.compound);
}

export function costCompound(compound: CompoundSelector): number {
  let cost = 0;

  if (compound.id) cost += compound.id.cost;
  if (compound.tag) cost += compound.tag.cost;

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

export function combinatorCost(c: Combinator | null): number {
  switch (c) {
    case null: return 0;
    case '>': return 1;
    case '+': return 2;
    case ' ': return 8;
    case '~': return 12;
    default: return assertNever(c);
  }
}
