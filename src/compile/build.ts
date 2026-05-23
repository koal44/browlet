import type { CompoundSelector, RelativeSelectorList2, SelectorList, ComplexSelector } from "../parser/parser";
import { emitClassTest, emitIdTest, emitTagTest } from "./emit";

export function buildSelectorListMatch(list: SelectorList): string {
  if (list.selectors.length === 0) return 'false';

  const arms = list.selectors.map(buildComplexSelectorMatch);
  return arms.length === 1 ? arms[0] : `(${arms.join(')||(')})`;
}

export function buildComplexSelectorMatch(complex: ComplexSelector): string {
  return '';
  // throw new Error('Complex selector matching is not implemented yet');
}

export function buildCompoundTest(compound: CompoundSelector): string {
  const tests: string[] = [];

  if (compound.id) tests.push(emitIdTest(compound.id).source!);

  if (compound.classes) {
    for (const cls of compound.classes) {
      tests.push(emitClassTest(cls).source!);
    }
  }

  if (compound.tag) tests.push(emitTagTest(compound.tag).source!);

  for (const test of compound.tests) {
    tests.push(test.source!);
  }

  return tests.length ? tests.join('&&') : 'true';
}

export function buildRelativeSelectorListMatch(_list: RelativeSelectorList2): string {
  return '';
  // throw new Error(':has() relative selector matching is not implemented yet');
}
