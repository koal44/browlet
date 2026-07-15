import type { Combinator, ComplexSelector, CompoundSelector } from '../parser/parser';
import { assertNever } from '../../shared/util';

export function costComplex(parts: ComplexSelector['parts']): number {
  let cost = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    cost += costPart(part);
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
      const cls = compound.classes[i]!;
      cost += cls.cost;
    }
  }

  for (let i = 0; i < compound.tests.length; i++) {
    const test = compound.tests[i]!;
    cost += test.cost;
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
