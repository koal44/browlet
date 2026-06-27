import type { ComplexRealSelectorList, ComplexSelectorList, CompoundSelector, RelativeSelectorList, SelectorList } from './selectlet';
import { addSpecificity, type Specificity, SpecificityB, SpecificityC, Specificity0 } from './specificity';
import { type ComponentValue } from './syntax';

export enum PseudoClassArgumentKind {
  ForgivingSelectorList = 'forgiving-selector-list',
  RelativeSelectorList = 'relative-selector-list',
  ComplexRealSelectorList = 'complex-real-selector-list',
  CompoundSelector = 'compound-selector',

  Direction = 'direction',
  LanguageRangeList = 'language-range-list',

  AnPlusB = 'an-plus-b',
  NthChild = 'nth-child',
}

export type PseudoClassBareForm = {
  specificity: Specificity;
};

export type PseudoClassDefinition = {
  bare?: PseudoClassBareForm;
  functional?: AnyPseudoClassFunctionForm;
};

export type AnyPseudoClassFunctionForm = {
  [K in keyof PseudoClassArgumentByKind]: PseudoClassFunctionForm<K>;
}[keyof PseudoClassArgumentByKind];

const barePseudo = (
  specificity = SpecificityB,
): PseudoClassBareForm => ({
  specificity,
});

export type PseudoClassFunctionForm<
  K extends keyof PseudoClassArgumentByKind = keyof PseudoClassArgumentByKind,
> = {
  argument: K;
  specificity: (argument: PseudoClassArgumentByKind[K]) => Specificity;
};

type PseudoClassArgumentByKind = {
  [PseudoClassArgumentKind.ForgivingSelectorList]: ForgivingSelectorListPseudoClassArgument;
  [PseudoClassArgumentKind.RelativeSelectorList]: RelativeSelectorListPseudoClassArgument;
  [PseudoClassArgumentKind.ComplexRealSelectorList]: ComplexRealSelectorListPseudoClassArgument;
  [PseudoClassArgumentKind.CompoundSelector]: CompoundSelectorPseudoClassArgument;
  [PseudoClassArgumentKind.AnPlusB]: AnPlusBPseudoClassArgument;
  [PseudoClassArgumentKind.NthChild]: NthChildPseudoClassArgument;
  [PseudoClassArgumentKind.Direction]: DirectionPseudoClassArgument;
  [PseudoClassArgumentKind.LanguageRangeList]: LanguageRangeListPseudoClassArgument;
};

const functionPseudo = <K extends keyof PseudoClassArgumentByKind>(
  argument: K,
  specificity: (argument: PseudoClassArgumentByKind[K]) => Specificity,
): PseudoClassFunctionForm<K> => ({
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
      (argument) => argument.selectors.specificity,
    ),
  },

  where: {
    functional: functionPseudo(
      PseudoClassArgumentKind.ForgivingSelectorList,
      () => Specificity0,
    ),
  },

  not: {
    functional: functionPseudo(
      PseudoClassArgumentKind.ComplexRealSelectorList,
      (argument) => argument.selectors.specificity,
    ),
  },

  has: {
    functional: functionPseudo(
      PseudoClassArgumentKind.RelativeSelectorList,
      (argument) => argument.selectors.specificity,
    ),
  },

  host: {
    bare: barePseudo(),
    functional: functionPseudo(
      PseudoClassArgumentKind.CompoundSelector,
      (argument) => addSpecificity(SpecificityB, argument.selector.specificity),
    ),
  },
};

export type PseudoClassArgument =
  | ForgivingSelectorListPseudoClassArgument
  | RelativeSelectorListPseudoClassArgument
  | ComplexRealSelectorListPseudoClassArgument
  | CompoundSelectorPseudoClassArgument
  | DirectionPseudoClassArgument
  | LanguageRangeListPseudoClassArgument
  | AnPlusBPseudoClassArgument
  | NthChildPseudoClassArgument;

export type ForgivingSelectorListPseudoClassArgument = {
  type: PseudoClassArgumentKind.ForgivingSelectorList;
  selectors: ComplexSelectorList;
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

export type DirectionPseudoClassArgument = {
  type: PseudoClassArgumentKind.Direction;
  value: 'ltr' | 'rtl';
};

export type LanguageRangeListPseudoClassArgument = {
  type: PseudoClassArgumentKind.LanguageRangeList;
  ranges: LanguageRange[];
};

type LanguageRange = unknown; // TODO

export type AnPlusBPseudoClassArgument = {
  type: PseudoClassArgumentKind.AnPlusB;
  a: number;
  b: number;
};

export type NthChildPseudoClassArgument = {
  type: PseudoClassArgumentKind.NthChild;
  a: number;
  b: number;
  selectorList: ComplexRealSelectorList | null;
};

// -------------------------------------------------------------------------
// Pseudo-element definitions
// -------------------------------------------------------------------------

export enum PseudoElementArgumentKind {
  Ident = 'ident',
  SelectorList = 'selector-list',
  Raw = 'raw',
}

export type PseudoElementArgument =
  | RawPseudoElementArgument
  | SelectorListPseudoElementArgument
  | IdentPseudoElementArgument;

export type RawPseudoElementArgument = {
  type: PseudoElementArgumentKind.Raw;
  value: ComponentValue[];
};

export type SelectorListPseudoElementArgument = {
  type: PseudoElementArgumentKind.SelectorList;
  selectors: SelectorList;
};

export type IdentPseudoElementArgument = {
  type: PseudoElementArgumentKind.Ident;
  value: string;
};

export type PseudoElementBareForm = {
  specificity: Specificity;
};

export type PseudoElementFunctionForm = {
  argument: PseudoElementArgumentKind;
  specificity: (argument: PseudoElementArgument) => Specificity;
};

export type PseudoElementDefinition = {
  bare?: PseudoElementBareForm;
  functional?: PseudoElementFunctionForm;
  legacy?: boolean;
};

const barePseudoElement = (
  specificity = SpecificityC,
): PseudoElementBareForm => ({
  specificity,
});

const functionPseudoElement = (
  argument: PseudoElementArgumentKind,
  specificity: (argument: PseudoElementArgument) => Specificity = () => SpecificityC,
): PseudoElementFunctionForm => ({
  argument,
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

  part: {
    functional: functionPseudoElement(
      PseudoElementArgumentKind.Ident,
    ),
  },
};
