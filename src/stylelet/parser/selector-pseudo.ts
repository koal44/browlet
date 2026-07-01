import type { CustomIdentValue } from '../values/custom-ident';
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
  // Logical combination pseudo-classes

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

  // Elemental pseudo-classes

  defined: {
    bare: barePseudoClass(),
  },

  // Linguistic pseudo-classes

  dir: {
    functional: functionalPseudoClass(
      PseudoClassArgumentKind.Direction,
      () => SpecificityB,
    ),
  },

  lang: {
    functional: functionalPseudoClass(
      PseudoClassArgumentKind.LanguageRangeList,
      () => SpecificityB,
    ),
  },

  // Location pseudo-classes

  'any-link': {
    bare: barePseudoClass(),
  },

  link: {
    bare: barePseudoClass(),
  },

  visited: {
    bare: barePseudoClass(),
  },

  target: {
    bare: barePseudoClass(),
  },

  scope: {
    bare: barePseudoClass(),
  },

  // Removed location pseudo-class.
  // Selectors Level 4 previously defined :target-within, but removed it in favor of :has(:target).
  // 'target-within': {
  //   bare: barePseudoClass(),
  // },


  // User action pseudo-classes

  hover: {
    bare: barePseudoClass(),
  },

  active: {
    bare: barePseudoClass(),
  },

  focus: {
    bare: barePseudoClass(),
  },

  'focus-visible': {
    bare: barePseudoClass(),
  },

  'focus-within': {
    bare: barePseudoClass(),
  },

  // Resource state pseudo-classes

  playing: {
    bare: barePseudoClass(),
  },

  paused: {
    bare: barePseudoClass(),
  },

  seeking: {
    bare: barePseudoClass(),
  },

  buffering: {
    bare: barePseudoClass(),
  },

  stalled: {
    bare: barePseudoClass(),
  },

  muted: {
    bare: barePseudoClass(),
  },

  'volume-locked': {
    bare: barePseudoClass(),
  },

  // Element display state pseudo-classes

  open: {
    bare: barePseudoClass(),
  },

  'popover-open': {
    bare: barePseudoClass(),
  },

  modal: {
    bare: barePseudoClass(),
  },

  fullscreen: {
    bare: barePseudoClass(),
  },

  'picture-in-picture': {
    bare: barePseudoClass(),
  },

  // Input pseudo-classes

  enabled: {
    bare: barePseudoClass(),
  },

  disabled: {
    bare: barePseudoClass(),
  },

  'read-only': {
    bare: barePseudoClass(),
  },

  'read-write': {
    bare: barePseudoClass(),
  },

  'placeholder-shown': {
    bare: barePseudoClass(),
  },

  autofill: {
    bare: barePseudoClass(),
  },

  default: {
    bare: barePseudoClass(),
  },

  checked: {
    bare: barePseudoClass(),
  },

  unchecked: {
    bare: barePseudoClass(),
  },

  indeterminate: {
    bare: barePseudoClass(),
  },

  valid: {
    bare: barePseudoClass(),
  },

  invalid: {
    bare: barePseudoClass(),
  },

  'in-range': {
    bare: barePseudoClass(),
  },

  'out-of-range': {
    bare: barePseudoClass(),
  },

  required: {
    bare: barePseudoClass(),
  },

  optional: {
    bare: barePseudoClass(),
  },

  'user-valid': {
    bare: barePseudoClass(),
  },

  'user-invalid': {
    bare: barePseudoClass(),
  },

  // Tree-structural pseudo-classes

  root: {
    bare: barePseudoClass(),
  },

  empty: {
    bare: barePseudoClass(),
  },

  // Child-indexed pseudo-classes

  'nth-child': {
    functional: functionalPseudoClass(
      PseudoClassArgumentKind.NthChild,
      (argument) => addSpecificity(
        SpecificityB,
        argument.of?.specificity ?? Specificity0,
      ),
    ),
  },

  'nth-last-child': {
    functional: functionalPseudoClass(
      PseudoClassArgumentKind.NthChild,
      (argument) => addSpecificity(
        SpecificityB,
        argument.of?.specificity ?? Specificity0,
      ),
    ),
  },

  'first-child': {
    bare: barePseudoClass(),
  },

  'last-child': {
    bare: barePseudoClass(),
  },

  'only-child': {
    bare: barePseudoClass(),
  },

  // Typed child-indexed pseudo-classes

  'nth-of-type': {
    functional: functionalPseudoClass(
      PseudoClassArgumentKind.AnPlusB,
      () => SpecificityB,
    ),
  },

  'nth-last-of-type': {
    functional: functionalPseudoClass(
      PseudoClassArgumentKind.AnPlusB,
      () => SpecificityB,
    ),
  },

  'first-of-type': {
    bare: barePseudoClass(),
  },

  'last-of-type': {
    bare: barePseudoClass(),
  },

  'only-of-type': {
    bare: barePseudoClass(),
  },

  // Shadow pseudo-classes

  host: {
    bare: barePseudoClass(),
    functional: functionalPseudoClass(
      PseudoClassArgumentKind.CompoundSelector,
      (argument) => addSpecificity(SpecificityB, argument.selector.specificity),
    ),
  },

  'host-context': {
    functional: functionalPseudoClass(
      PseudoClassArgumentKind.CompoundSelector,
      (argument) => addSpecificity(SpecificityB, argument.selector.specificity),
    ),
  },

  'has-slotted': {
    bare: barePseudoClass(),
  },
};

export type ForgivingSelectorListPseudoClassArgument = {
  kind: PseudoClassArgumentKind.ForgivingSelectorList;
  selectors: ComplexRealSelectorList;
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
  value: string; // values other than 'ltr' and 'rtl' are ignored
};

export type LanguageRangeListPseudoClassArgument = {
  kind: PseudoClassArgumentKind.LanguageRangeList;
  ranges: LanguageRange[];
};

export type LanguageRange = string;

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
  CompoundSelector = 'compound-selector',
  PartNameList = 'part-name-list',
  CustomIdent = 'custom-ident',
}

export type PseudoElementArgument =
  | SelectorListPseudoElementArgument
  | CompoundSelectorPseudoElementArgument
  | PartNameListPseudoElementArgument
  | CustomIdentPseudoElementArgument;

export type SelectorListPseudoElementArgument = {
  kind: PseudoElementArgumentKind.SelectorList;
  selectors: SelectorList;
};

export type CompoundSelectorPseudoElementArgument = {
  kind: PseudoElementArgumentKind.CompoundSelector;
  selector: CompoundSelector;
};

export type PartNameListPseudoElementArgument = {
  kind: PseudoElementArgumentKind.PartNameList;
  names: string[];
};

export type CustomIdentPseudoElementArgument = {
  kind: PseudoElementArgumentKind.CustomIdent;
  value: CustomIdentValue;
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
  // Typographic pseudo-elements

  'first-line': {
    bare: barePseudoElement(),
  },

  'first-letter': {
    bare: barePseudoElement(),
  },

  // Sub-pseudo-elements of ::first-letter.
  // Valid in chains like ::first-letter::prefix / ::first-letter::suffix.

  prefix: {
    bare: barePseudoElement(),
  },

  suffix: {
    bare: barePseudoElement(),
  },

  // Highlight pseudo-elements

  selection: {
    bare: barePseudoElement(),
  },

  'search-text': {
    bare: barePseudoElement(),
  },

  'target-text': {
    bare: barePseudoElement(),
  },

  'spelling-error': {
    bare: barePseudoElement(),
  },

  'grammar-error': {
    bare: barePseudoElement(),
  },

  highlight: {
    functional: functionalPseudoElement(
      PseudoElementArgumentKind.CustomIdent,
      () => SpecificityC,
    ),
  },

  // Generated content pseudo-elements

  before: {
    bare: barePseudoElement(),
  },

  after: {
    bare: barePseudoElement(),
  },

  // List marker pseudo-elements

  marker: {
    bare: barePseudoElement(),
  },

  // Input pseudo-elements

  placeholder: {
    bare: barePseudoElement(),
  },

  // Element-backed pseudo-elements

  'file-selector-button': {
    bare: barePseudoElement(),
  },

  'details-content': {
    bare: barePseudoElement(),
  },

  // Shadow pseudo-elements

  slotted: {
    functional: functionalPseudoElement(
      PseudoElementArgumentKind.CompoundSelector,
      (argument) => addSpecificity(SpecificityC, argument.selector.specificity),
    ),
  },

  part: {
    functional: functionalPseudoElement(
      PseudoElementArgumentKind.PartNameList,
      () => SpecificityC,
    ),
  },
};
