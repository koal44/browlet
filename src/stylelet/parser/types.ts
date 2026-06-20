import type { RelativeSelectorList, SelectorList } from '../../selectlet/parser/parser';
import type { ColorValue } from './color';

// Stylesheet

export type Stylesheet = {
  rules: CssRule[];
}

// Rules

export type CssRule =
  | StyleRule
  | AtRule
  | InvalidRule;

export type StyleRule = {
  kind: RuleKind.Style;
  selector: SelectorList;
  block: StyleBlock;
};

export type AtRule = {
  kind: RuleKind.At;
  at: AtRuleKind;
  name: string;
  prelude: string;
  block?: StyleBlock | string;
};

export type InvalidRule = {
  kind: RuleKind.Invalid;
  source: string;
  reason?: string;
};

export enum RuleKind {
  Style = 1,
  At,
  Invalid,
}

export enum AtRuleKind {
  Unknown = 0,

  Media,
  Supports,
  Import,
  Layer,
  Keyframes,
  FontFace,
  Scope,
}

export const AtRuleKindByName: { [name: string]: AtRuleKind | undefined; } = {
  media: AtRuleKind.Media,
  supports: AtRuleKind.Supports,
  import: AtRuleKind.Import,
  layer: AtRuleKind.Layer,
  keyframes: AtRuleKind.Keyframes,
  'font-face': AtRuleKind.FontFace,
  scope: AtRuleKind.Scope,
};

export function atRuleKindFor(name: string): AtRuleKind {
  return AtRuleKindByName[name.toLowerCase()] ?? AtRuleKind.Unknown;
}

// Blocks

export type StyleBlock = {
  items: StyleBlockItem[];
};

export type StyleBlockItem =
  | Declaration
  | NestedStyleRule
  | AtRule
  | InvalidBlockItem;

export type NestedStyleRule = {
  kind: BlockItemKind.NestedStyle;
  selector: RelativeSelectorList;
  block: StyleBlock;
};

export type InvalidBlockItem = {
  kind: BlockItemKind.Invalid;
  source: string;
  reason?: string;
};

export enum BlockItemKind {
  Declaration = 1,
  NestedStyle,
  At,
  Invalid,
}

// Declarations

export type Declaration =
  | ColorDeclaration
  | DisplayDeclaration
  | MarginDeclaration
  | MarginSideDeclaration
  | RawDeclaration;

export type DeclarationBase<P extends PropertyId, V> = {
  kind: BlockItemKind.Declaration;
  prop: P;
  value: V | GlobalValue;
  important: boolean;
};

export type GlobalValue = {
  global: GlobalKeyword;
};

export enum GlobalKeyword {
  Inherit = 1,
  Initial,
  Unset,
  Revert,
  RevertLayer,
}

export type RawDeclaration = {
  kind: BlockItemKind.Declaration;
  raw: true;
  prop: PropertyId;
  name: string;
  value: string;
  important: boolean;
};

export type ColorDeclaration =
  DeclarationBase<ColorPropertyId, ColorValue>;

export type ColorPropertyId =
  | PropertyId.Color
  | PropertyId.BackgroundColor;

export type DisplayDeclaration =
  DeclarationBase<PropertyId.Display, DisplayValue>;

export type MarginDeclaration =
  DeclarationBase<PropertyId.Margin, BoxValue<LengthPercentageAuto>>;

export type MarginSideDeclaration =
  DeclarationBase<MarginSidePropertyId, LengthPercentageAuto>;

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

export enum SizeKind {
  Auto = 1,
  Length,
  Percentage,
}

export enum LengthUnit {
  None = 0,
  Px,
  Em,
  Rem,
  Vw,
  Vh,
}

export type LengthPercentageAuto = {
  kind: SizeKind;
  value: number;
  unit: LengthUnit;
};

export type BoxValue<T> = {
  top: T;
  right: T;
  bottom: T;
  left: T;
};

// Property registry

export enum PropertyId {
  Unknown = 0,

  AlignSelf,
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

export const PropertyIdByName: { [name: string]: PropertyId | undefined; } = {
  'align-self': PropertyId.AlignSelf,
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

export function propertyIdFor(name: string): PropertyId {
  return PropertyIdByName[name.toLowerCase()] ?? PropertyId.Unknown;
}
