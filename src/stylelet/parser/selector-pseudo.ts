import type { ComplexRealSelectorList, CompoundSelector, RelativeSelectorList, SelectorList } from './selectlet';
import { type ComponentValue } from './syntax';

export enum PseudoClassArgumentKind {
  SelectorList = 'selector-list',
  ForgivingSelectorList = 'forgiving-selector-list',
  RelativeSelectorList = 'relative-selector-list',
  ComplexRealSelectorList = 'complex-real-selector-list',
  CompoundSelector = 'compound-selector',
  AnPlusB = 'an-plus-b',
  Ident = 'ident',
  Raw = 'raw',
}

export enum PseudoClassSpecificityKind {
  PseudoClass = 'pseudo-class',
  Zero = 'zero',
  MaxSelectorList = 'max-selector-list',
  PseudoClassPlusMaxSelectorList = 'pseudo-class-plus-max-selector-list',
  PseudoClassPlusArgument = 'pseudo-class-plus-argument',
}

export type PseudoClassBareForm = {
  specificity: PseudoClassSpecificityKind;
};

export type PseudoClassFunctionForm = {
  argument: PseudoClassArgumentKind;
  specificity: PseudoClassSpecificityKind;
};

export type PseudoClassDefinition = {
  bare?: PseudoClassBareForm;
  functional?: PseudoClassFunctionForm;
};

const barePseudo = (
  specificity = PseudoClassSpecificityKind.PseudoClass,
): PseudoClassBareForm => ({
  specificity,
});

const functionPseudo = (
  argument: PseudoClassArgumentKind,
  specificity = PseudoClassSpecificityKind.PseudoClass,
): PseudoClassFunctionForm => ({
  argument,
  specificity,
});

export const PSEUDO_CLASSES: Record<string, PseudoClassDefinition | undefined> = {
  hover: {
    bare: barePseudo(),
  },

  is: {
    functional: functionPseudo(
      PseudoClassArgumentKind.ForgivingSelectorList,
      PseudoClassSpecificityKind.MaxSelectorList,
    ),
  },

  where: {
    functional: functionPseudo(
      PseudoClassArgumentKind.ForgivingSelectorList,
      PseudoClassSpecificityKind.Zero,
    ),
  },

  not: {
    functional: functionPseudo(
      PseudoClassArgumentKind.ComplexRealSelectorList,
      PseudoClassSpecificityKind.MaxSelectorList,
    ),
  },

  has: {
    functional: functionPseudo(
      PseudoClassArgumentKind.RelativeSelectorList,
      PseudoClassSpecificityKind.MaxSelectorList,
    ),
  },

  // CSS Scoping, not Selectors 4 proper.
  host: {
    bare: barePseudo(),
    functional: functionPseudo(
      PseudoClassArgumentKind.CompoundSelector,
      PseudoClassSpecificityKind.PseudoClassPlusArgument,
    ),
  },
};

export type PseudoClassArgument =
  | RawPseudoClassArgument
  | SelectorListPseudoClassArgument
  | ForgivingSelectorListPseudoClassArgument
  | RelativeSelectorListPseudoClassArgument
  | ComplexRealSelectorListPseudoClassArgument
  | CompoundSelectorPseudoClassArgument
  | AnPlusBPseudoClassArgument
  | IdentPseudoClassArgument;

export type RawPseudoClassArgument = {
  type: PseudoClassArgumentKind.Raw;
  value: ComponentValue[];
};

export type SelectorListPseudoClassArgument = {
  type: PseudoClassArgumentKind.SelectorList;
  selectors: SelectorList;
};

export type ForgivingSelectorListPseudoClassArgument = {
  type: PseudoClassArgumentKind.ForgivingSelectorList;
  selectors: SelectorList;
};

export type RelativeSelectorListPseudoClassArgument = {
  type: PseudoClassArgumentKind.RelativeSelectorList;
  selectors: RelativeSelectorList;
};

export type ComplexRealSelectorListPseudoClassArgument = {
  type: PseudoClassArgumentKind.ComplexRealSelectorList;
  selectors: ComplexRealSelectorList;
};

export type CompoundSelectorPseudoClassArgument = {
  type: PseudoClassArgumentKind.CompoundSelector;
  selector: CompoundSelector;
};

export type AnPlusBPseudoClassArgument = {
  type: PseudoClassArgumentKind.AnPlusB;
  a: number;
  b: number;
};

export type IdentPseudoClassArgument = {
  type: PseudoClassArgumentKind.Ident;
  value: string;
};
