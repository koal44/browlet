import type { ComplexRealSelectorList, CompoundSelector, RelativeSelectorList, SelectorList } from './selectlet';
import { addSpecificity, type Specificity, SpecificityB, SpecificityC, Specificity0 } from './selector-specificity';

export enum PseudoClassArgumentKind {
  ForgivingSelectorList = 'forgiving-selector-list',
  ComplexRealSelectorList = 'complex-real-selector-list',
  RelativeSelectorList = 'relative-selector-list',
  CompoundSelector = 'compound-selector',
  Direction = 'direction',
  LanguageRangeList = 'language-range-list',
  AnPlusB = 'an-plus-b',
  NthChild = 'nth-child',
}

export type PseudoClassArgument =
  | ForgivingSelectorListPseudoClassArgument
  | ComplexRealSelectorListPseudoClassArgument
  | RelativeSelectorListPseudoClassArgument
  | CompoundSelectorPseudoClassArgument
  | DirectionPseudoClassArgument
  | LanguageRangeListPseudoClassArgument
  | AnPlusBPseudoClassArgument
  | NthChildPseudoClassArgument;

type PseudoClassArgumentFor<K extends PseudoClassArgumentKind> =
  Extract<PseudoClassArgument, { kind: K; }>;

export type PseudoClassBareForm = {
  specificity: Specificity;
};

export type PseudoClassFunctionalForm = {
  argument: PseudoClassArgumentKind;
  specificity: (argument: PseudoClassArgument) => Specificity;
};

export type PseudoClassDefinition = {
  bare?: PseudoClassBareForm;
  functional?: PseudoClassFunctionalForm;
};

const barePseudoClass = (
  specificity = SpecificityB,
): PseudoClassBareForm => ({
  specificity,
});

const functionalPseudoClass = <K extends PseudoClassArgumentKind>(
  argument: K,
  specificity: (argument: PseudoClassArgumentFor<K>) => Specificity,
): PseudoClassFunctionalForm => ({
  argument,
  specificity: specificity as (argument: PseudoClassArgument) => Specificity,
});

export const PSEUDO_CLASSES: Record<string, PseudoClassDefinition | undefined> = {
  hover: {
    bare: barePseudoClass(),
  },

  is: {
    functional: functionalPseudoClass(
      PseudoClassArgumentKind.ForgivingSelectorList,
      (argument) => argument.selectors.specificity,
    ),
  },

  where: {
    functional: functionalPseudoClass(
      PseudoClassArgumentKind.ForgivingSelectorList,
      () => Specificity0,
    ),
  },

  not: {
    functional: functionalPseudoClass(
      PseudoClassArgumentKind.ComplexRealSelectorList,
      (argument) => argument.selectors.specificity,
    ),
  },

  has: {
    functional: functionalPseudoClass(
      PseudoClassArgumentKind.RelativeSelectorList,
      (argument) => argument.selectors.specificity,
    ),
  },

  host: {
    bare: barePseudoClass(),
    functional: functionalPseudoClass(
      PseudoClassArgumentKind.CompoundSelector,
      (argument) => addSpecificity(SpecificityB, argument.selector.specificity),
    ),
  },
};


export type ForgivingSelectorListPseudoClassArgument = {
  kind: PseudoClassArgumentKind.ForgivingSelectorList;
  selectors: SelectorList;
};

export type RelativeSelectorListPseudoClassArgument = {
  kind: PseudoClassArgumentKind.RelativeSelectorList;
  selectors: RelativeSelectorList;
};

export type ComplexRealSelectorListPseudoClassArgument = {
  kind: PseudoClassArgumentKind.ComplexRealSelectorList;
  selectors: ComplexRealSelectorList;
};

export type CompoundSelectorPseudoClassArgument = {
  kind: PseudoClassArgumentKind.CompoundSelector;
  selector: CompoundSelector;
};

export type DirectionPseudoClassArgument = {
  kind: PseudoClassArgumentKind.Direction;
  value: 'ltr' | 'rtl';
};

export type LanguageRangeListPseudoClassArgument = {
  kind: PseudoClassArgumentKind.LanguageRangeList;
  ranges: LanguageRange[];
};

type LanguageRange = unknown; // TODO

export type AnPlusBPseudoClassArgument = {
  kind: PseudoClassArgumentKind.AnPlusB;
  a: number;
  b: number;
};

export type NthChildPseudoClassArgument = {
  kind: PseudoClassArgumentKind.NthChild;
  a: number;
  b: number;
  of: ComplexRealSelectorList | null;
};

// -------------------------------------------------------------------------
// Pseudo-element definitions
// -------------------------------------------------------------------------

export enum PseudoElementArgumentKind {
  SelectorList = 'selector-list',
}

export type PseudoElementArgument =
  | SelectorListPseudoElementArgument;

export type SelectorListPseudoElementArgument = {
  kind: PseudoElementArgumentKind.SelectorList;
  selectors: SelectorList;
};

export type PseudoElementBareForm = {
  specificity: Specificity;
};

export type PseudoElementFunctionalForm = {
  argument: PseudoElementArgumentKind;
  specificity: (argument: PseudoElementArgument) => Specificity;
};

export type PseudoElementDefinition = {
  bare?: PseudoElementBareForm;
  functional?: PseudoElementFunctionalForm;
  legacy?: boolean;
};

type PseudoElementArgumentFor<K extends PseudoElementArgumentKind> =
  Extract<PseudoElementArgument, { kind: K; }>;

const functionalPseudoElement = <K extends PseudoElementArgumentKind>(
  argument: K,
  specificity: (argument: PseudoElementArgumentFor<K>) => Specificity = () => SpecificityC,
): PseudoElementFunctionalForm => ({
  argument,
  specificity: specificity as (argument: PseudoElementArgument) => Specificity,
});

const barePseudoElement = (
  specificity = SpecificityC,
): PseudoElementBareForm => ({
  specificity,
});

export const PSEUDO_ELEMENTS: Record<string, PseudoElementDefinition | undefined> = {
  before: {
    bare: barePseudoElement(),
    legacy: true,
  },

  after: {
    bare: barePseudoElement(),
    legacy: true,
  },

  'first-line': {
    bare: barePseudoElement(),
    legacy: true,
  },

  'first-letter': {
    bare: barePseudoElement(),
    legacy: true,
  },

  // part: {
  //   functional: functionalPseudoElement(
  //     PseudoElementArgumentKind.Ident,
  //   ),
  // },
};
