/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
import type { ComponentValue } from './syntax';
import type { ColorValue } from '../values/color';
import type { CssWideValue } from '../values/css-wide';
import type { LengthPercentageAuto } from '../values/length-percentage';
import type { SelectorList } from '../../selectlet/parser/parser';
import { asciiLower } from '../../utils/css';
import type { AnimationNameValue } from '../props/animation-name';

// Stylesheet

export type StyleSheetAst = {
  rules: CssRuleAst[];
};

// Rules

export type CssRuleAst =
  | StyleRuleAst
  | AtRuleAst;

export type StyleRuleAst = {
  kind: RuleKindAst.Style;

  // temporary raw syntax, still useful for future component parser/debugging
  selector: readonly ComponentValue[];

  // temporary bridge result
  selectorText: string;
  selectorList: SelectorList; // existing selector parser output

  block: StyleBlockAst;
};

export type AtRuleAst = never;

export enum RuleKindAst {
  Style = 1,
  At,
}

export enum AtRuleKindAst {
  Media = 1,
  Supports,
  Import,
  Layer,
  Keyframes,
  FontFace,
  Scope,
}

export const AtRuleKindAstByName: { [name: string]: AtRuleKindAst | undefined; } = {
  media: AtRuleKindAst.Media,
  supports: AtRuleKindAst.Supports,
  import: AtRuleKindAst.Import,
  layer: AtRuleKindAst.Layer,
  keyframes: AtRuleKindAst.Keyframes,
  'font-face': AtRuleKindAst.FontFace,
  scope: AtRuleKindAst.Scope,
};

export function getAtRuleKindAst(name: string): AtRuleKindAst | undefined {
  return AtRuleKindAstByName[name.toLowerCase()];
}

// Blocks

export type StyleBlockAst = {
  items: StyleBlockItemAst[];
};

export type StyleBlockItemAst =
  | DeclarationAst
  | NestedStyleRuleAst
  | AtRuleAst;

export type NestedStyleRuleAst = {
  kind: BlockItemAstKind.NestedStyle;

  // Temporary for same reason as StyleRuleAst.selector.
  // Eventually this should be RelativeSelectorListAst.
  selector: readonly ComponentValue[];

  block: StyleBlockAst;
};

export enum BlockItemAstKind {
  Declaration = 1,
  NestedStyle,
  At,
}

// Declarations

export type DeclarationAst =
  | AnimationNameDeclarationAst
  | ColorDeclarationAst
  | DisplayDeclarationAst
  | MarginDeclarationAst
  | MarginSideDeclarationAst
  | CustomPropertyDeclarationAst;

export type DeclarationBaseAst<P extends PropertyId, V> = {
  kind: BlockItemAstKind.Declaration;
  prop: P;
  value: V | CssWideValue;
  important: boolean;
};

export type CustomPropertyDeclarationAst = {
  kind: BlockItemAstKind.Declaration;
  prop: PropertyId.Custom;
  name: string;
  value: readonly ComponentValue[];
  important: boolean;
};

export type AnimationNameDeclarationAst =
  DeclarationBaseAst<PropertyId.AnimationName, AnimationNameValue>;

export type ColorDeclarationAst =
  DeclarationBaseAst<ColorPropertyId, ColorValue>;

export type ColorPropertyId =
  | PropertyId.Color
  | PropertyId.BackgroundColor;

export type DisplayDeclarationAst =
  DeclarationBaseAst<PropertyId.Display, DisplayValue>;

export type MarginDeclarationAst =
  DeclarationBaseAst<PropertyId.Margin, BoxValue<LengthPercentageAuto>>;

export type MarginSideDeclarationAst =
  DeclarationBaseAst<MarginSidePropertyId, LengthPercentageAuto>;

export type MarginSidePropertyId =
  | PropertyId.MarginTop
  | PropertyId.MarginRight
  | PropertyId.MarginBottom
  | PropertyId.MarginLeft;

// Value types

export enum DisplayValue {
  Block = 1,
  Inline,
  InlineBlock,
  None,
}

export type BoxValue<T> = {
  top: T;
  right: T;
  bottom: T;
  left: T;
};

// Property registry

export enum PropertyId {
  Unknown = 0,
  Custom,

  AlignSelf,
  AnimationName,
  Azimuth,
  Background,
  BackgroundAttachment,
  BackgroundColor,
  BackgroundImage,
  BackgroundPosition,
  BackgroundRepeat,
  CaretColor,
  Color,
  Cursor,
  Direction,
  Display,
  Elevation,
  Font,
  FontFamily,
  FontFeatureSettings,
  FontKerning,
  FontSize,
  FontSizeAdjust,
  FontStyle,
  FontSynthesis,
  FontVariant,
  FontVariantCaps,
  FontVariantEastAsian,
  FontVariantLigatures,
  FontVariantNumeric,
  FontVariantPosition,
  FontWeight,
  GlyphOrientationVertical,
  GridRowStart,
  GridTemplate,
  GridTemplateAreas,
  GridTemplateColumns,
  LetterSpacing,
  Margin,
  MarginBottom,
  MarginLeft,
  MarginRight,
  MarginTop,
  Opacity,
  Orphans,
  Outline,
  OutlineColor,
  OutlineOffset,
  OutlineStyle,
  OutlineWidth,
  Padding,
  PaddingBottom,
  PaddingLeft,
  PaddingRight,
  PaddingTop,
  PageBreakAfter,
  PageBreakBefore,
  PageBreakInside,
  Pitch,
  Resize,
  Richness,
  SpeakHeader,
  SpeakNumeral,
  SpeakPunctuation,
  SpeechRate,
  Stress,
  TextAlign,
  TextCombineUpright,
  TextDecoration,
  TextIndent,
  TextOverflow,
  TextTransform,
  UnicodeBidi,
  ViewTransitionName,
  Volume,
  WhiteSpace,
  Widows,
  WordSpacing,
  WritingMode,
}

const PropertyIdByName: { [name: string]: PropertyId | undefined; } = {
  'align-self': PropertyId.AlignSelf,
  'animation-name': PropertyId.AnimationName,
  azimuth: PropertyId.Azimuth,
  background: PropertyId.Background,
  'background-attachment': PropertyId.BackgroundAttachment,
  'background-color': PropertyId.BackgroundColor,
  'background-image': PropertyId.BackgroundImage,
  'background-position': PropertyId.BackgroundPosition,
  'background-repeat': PropertyId.BackgroundRepeat,
  'caret-color': PropertyId.CaretColor,
  color: PropertyId.Color,
  cursor: PropertyId.Cursor,
  direction: PropertyId.Direction,
  display: PropertyId.Display,
  elevation: PropertyId.Elevation,
  font: PropertyId.Font,
  'font-family': PropertyId.FontFamily,
  'font-feature-settings': PropertyId.FontFeatureSettings,
  'font-kerning': PropertyId.FontKerning,
  'font-size': PropertyId.FontSize,
  'font-size-adjust': PropertyId.FontSizeAdjust,
  'font-style': PropertyId.FontStyle,
  'font-synthesis': PropertyId.FontSynthesis,
  'font-variant': PropertyId.FontVariant,
  'font-variant-caps': PropertyId.FontVariantCaps,
  'font-variant-east-asian': PropertyId.FontVariantEastAsian,
  'font-variant-ligatures': PropertyId.FontVariantLigatures,
  'font-variant-numeric': PropertyId.FontVariantNumeric,
  'font-variant-position': PropertyId.FontVariantPosition,
  'font-weight': PropertyId.FontWeight,
  'glyph-orientation-vertical': PropertyId.GlyphOrientationVertical,
  'grid-row-start': PropertyId.GridRowStart,
  'grid-template': PropertyId.GridTemplate,
  'grid-template-areas': PropertyId.GridTemplateAreas,
  'grid-template-columns': PropertyId.GridTemplateColumns,
  'letter-spacing': PropertyId.LetterSpacing,
  margin: PropertyId.Margin,
  'margin-bottom': PropertyId.MarginBottom,
  'margin-left': PropertyId.MarginLeft,
  'margin-right': PropertyId.MarginRight,
  'margin-top': PropertyId.MarginTop,
  opacity: PropertyId.Opacity,
  orphans: PropertyId.Orphans,
  outline: PropertyId.Outline,
  'outline-color': PropertyId.OutlineColor,
  'outline-offset': PropertyId.OutlineOffset,
  'outline-style': PropertyId.OutlineStyle,
  'outline-width': PropertyId.OutlineWidth,
  padding: PropertyId.Padding,
  'padding-bottom': PropertyId.PaddingBottom,
  'padding-left': PropertyId.PaddingLeft,
  'padding-right': PropertyId.PaddingRight,
  'padding-top': PropertyId.PaddingTop,
  'page-break-after': PropertyId.PageBreakAfter,
  'page-break-before': PropertyId.PageBreakBefore,
  'page-break-inside': PropertyId.PageBreakInside,
  pitch: PropertyId.Pitch,
  resize: PropertyId.Resize,
  richness: PropertyId.Richness,
  'speak-header': PropertyId.SpeakHeader,
  'speak-numeral': PropertyId.SpeakNumeral,
  'speak-punctuation': PropertyId.SpeakPunctuation,
  'speech-rate': PropertyId.SpeechRate,
  stress: PropertyId.Stress,
  'text-align': PropertyId.TextAlign,
  'text-combine-upright': PropertyId.TextCombineUpright,
  'text-decoration': PropertyId.TextDecoration,
  'text-indent': PropertyId.TextIndent,
  'text-overflow': PropertyId.TextOverflow,
  'text-transform': PropertyId.TextTransform,
  'unicode-bidi': PropertyId.UnicodeBidi,
  'view-transition-name': PropertyId.ViewTransitionName,
  volume: PropertyId.Volume,
  'white-space': PropertyId.WhiteSpace,
  widows: PropertyId.Widows,
  'word-spacing': PropertyId.WordSpacing,
  'writing-mode': PropertyId.WritingMode,
};

export function getPropertyId(name: string): PropertyId {
  if (isCustomPropertyName(name)) return PropertyId.Custom;
  return PropertyIdByName[asciiLower(name)] ?? PropertyId.Unknown;
}

const PropertyNameById: Readonly<Partial<Record<PropertyId, string>>> = (() => {
  const names: Partial<Record<PropertyId, string>> = {};

  for (const [name, id] of Object.entries(PropertyIdByName)) {
    if (id !== undefined) {
      names[id] = name;
    }
  }

  return names;
})();

export function getPropertyName(id: PropertyId): string | undefined {
  return PropertyNameById[id];
}

function isCustomPropertyName(name: string): boolean {
  return name.startsWith('--');
}
