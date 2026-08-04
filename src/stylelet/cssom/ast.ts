/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
import { serializeComponentValues, type BraceBlock, type ComponentValue } from '../parser/component-value';
import {
  parseStyleBlockContents, parseStylesheet as parseSyntaxStylesheet,
} from '../parser/syntax';
import {
  RuleKind as RuleKindSyntax,
  type Declaration as SyntaxDeclaration,
  type QualifiedRule as SyntaxQualifiedRule, type Rule as SyntaxRule,
  type StyleBlockItem as SyntaxStyleBlockItem, type StyleSheet as SyntaxStyleSheet,
} from '../parser/rule';
import { assertNever, requireDefined } from '../../shared/util';
import { parseSelectorList, type SelectorList } from '../parser/selector';
import { parseCssWideValue, type CssWideValue } from '../values/css-wide';
import { parseColorValue, type ColorValue } from '../values/color';
import { isDeclarationValueContents } from '../values/declaration-value';
import { parseAnimationNameValue, serializeAnimationName, type AnimationNameValue } from '../props/animation-name';
import { parseMarginSideValue, serializeMarginSideValue, type MarginSideValue } from '../props/margin';
import { asciiLower } from '../../shared/css';

export function parseStylesheet(input: string): StyleSheetAst {
  return buildStyleSheetAst(parseSyntaxStylesheet(input));
}

function buildStyleSheetAst(sheet: SyntaxStyleSheet): StyleSheetAst {
  const rules: CssRuleAst[] = [];

  for (const rule of sheet.rules) {
    const ast = buildTopLevelRuleAst(rule);
    if (ast !== null) rules.push(ast);
  }

  return { rules };
}

// =============================================================================
// AST
// =============================================================================

export type StyleSheetAst = {
  rules: CssRuleAst[];
};

type CssRuleAst =
  | StyleRuleAst
  | AtRuleAst;

export type StyleRuleAst = {
  kind: RuleKindAst.Style;

  // Temporary raw syntax, still useful for future component parser/debugging.
  selector: readonly ComponentValue[];

  // Semantic selector projection.
  selectorText: string;
  selectorList: SelectorList;

  block: StyleBlockAst;
};

type AtRuleAst = never;

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

export type StyleBlockAst = {
  items: StyleBlockItemAst[];
};

type StyleBlockItemAst =
  | DeclarationAst
  | NestedStyleRuleAst
  | AtRuleAst;

type NestedStyleRuleAst = {
  kind: BlockItemAstKind.NestedStyle;

  // Temporary for the same reason as StyleRuleAst.selector.
  // Eventually this should be RelativeSelectorListAst.
  selector: readonly ComponentValue[];

  block: StyleBlockAst;
};

export enum BlockItemAstKind {
  Declaration = 1,
  NestedStyle,
  At,
}

export type DeclarationAst =
  | AnimationNameDeclarationAst
  | ColorDeclarationAst
  | DisplayDeclarationAst
  | MarginDeclarationAst
  | MarginSideDeclarationAst
  | CustomPropertyDeclarationAst;

type DeclarationBaseAst<P extends PropertyId, V> = {
  kind: BlockItemAstKind.Declaration;
  prop: P;
  value: V | CssWideValue;
  important: boolean;
};

type CustomPropertyDeclarationAst = {
  kind: BlockItemAstKind.Declaration;
  prop: PropertyId.Custom;
  name: string;
  value: readonly ComponentValue[];
  important: boolean;
};

type AnimationNameDeclarationAst =
  DeclarationBaseAst<PropertyId.AnimationName, AnimationNameValue>;

type ColorDeclarationAst =
  DeclarationBaseAst<ColorPropertyId, ColorValue>;

type ColorPropertyId =
  | PropertyId.Color
  | PropertyId.BackgroundColor;

type DisplayDeclarationAst =
  DeclarationBaseAst<PropertyId.Display, DisplayValue>;

type MarginDeclarationAst =
  DeclarationBaseAst<PropertyId.Margin, BoxValue<MarginSideValue>>;

type MarginSideDeclarationAst =
  DeclarationBaseAst<MarginSidePropertyId, MarginSideValue>;

type MarginSidePropertyId =
  | PropertyId.MarginTop
  | PropertyId.MarginRight
  | PropertyId.MarginBottom
  | PropertyId.MarginLeft;

enum DisplayValue {
  Block = 1,
  Inline,
  InlineBlock,
  None,
}

type BoxValue<T> = {
  top: T;
  right: T;
  bottom: T;
  left: T;
};

function buildTopLevelRuleAst(rule: SyntaxRule): CssRuleAst | null {
  switch (rule.kind) {
    case RuleKindSyntax.Qualified:
      return buildStyleRuleAst(rule);

    case RuleKindSyntax.At:
      return null;
  }
}

function buildStyleRuleAst(rule: SyntaxQualifiedRule): StyleRuleAst | null {
  const selectorText = serializeComponentValues(rule.prelude);

  let selectorList: SelectorList | null;

  try {
    selectorList = parseSelectorList(rule.prelude);
  } catch {
    return null;
  }

  if (selectorList === null || selectorList.arms.length === 0) {
    return null;
  }

  return {
    kind: RuleKindAst.Style,
    selector: rule.prelude,
    selectorText,
    selectorList,
    block: buildStyleBlockAst(rule.block),
  };
}

function buildStyleBlockAst(block: BraceBlock): StyleBlockAst {
  const syntaxItems = parseStyleBlockContents(block.value);
  const items: StyleBlockItemAst[] = [];

  for (const item of syntaxItems) {
    const ast = buildStyleBlockItemAst(item);
    if (ast !== null) items.push(ast);
  }

  return { items };
}

function buildStyleBlockItemAst(item: SyntaxStyleBlockItem): StyleBlockItemAst | null {
  if (isSyntaxDeclaration(item)) {
    return buildDeclarationAst(item);
  }

  switch (item.kind) {
    case RuleKindSyntax.At:
      return null;

    case RuleKindSyntax.Qualified:
      return buildNestedStyleRuleAst(item);

    default: assertNever(item);
  }
}

function buildNestedStyleRuleAst(rule: SyntaxQualifiedRule): NestedStyleRuleAst {
  return {
    kind: BlockItemAstKind.NestedStyle,
    selector: rule.prelude,
    block: buildStyleBlockAst(rule.block),
  };
}

function isSyntaxDeclaration(item: SyntaxStyleBlockItem): item is SyntaxDeclaration {
  return 'value' in item;
}

// =============================================================================
// Declarations
// =============================================================================

function buildDeclarationAst(
  declaration: SyntaxDeclaration,
): DeclarationAst | null {
  if (
    declaration.value.length > 0 &&
    !isDeclarationValueContents(declaration.value)
  ) {
    return null;
  }

  const name = declaration.name;
  const prop = getPropertyId(name);

  switch (prop) {
    case PropertyId.Color:
    case PropertyId.BackgroundColor: {
      const value =
        parseCssWideValue(declaration.value) ?? parseColorValue(declaration.value);

      if (value === null) return null;

      return {
        kind: BlockItemAstKind.Declaration,
        prop,
        value,
        important: declaration.important,
      };
    }

    case PropertyId.MarginTop:
    case PropertyId.MarginRight:
    case PropertyId.MarginBottom:
    case PropertyId.MarginLeft: {
      const value =
        parseCssWideValue(declaration.value) ?? parseMarginSideValue(declaration.value);

      if (value === null) return null;

      return {
        kind: BlockItemAstKind.Declaration,
        prop,
        value,
        important: declaration.important,
      };
    }

    case PropertyId.AnimationName: {
      const value =
        parseCssWideValue(declaration.value) ?? parseAnimationNameValue(declaration.value);

      if (value === null) return null;

      return {
        kind: BlockItemAstKind.Declaration,
        prop,
        value,
        important: declaration.important,
      };
    }

    case PropertyId.Custom:
      return buildCustomPropertyDeclarationAst(declaration);

    case PropertyId.Unknown:
      return null;

    default:
      return null;
  }
}

function buildCustomPropertyDeclarationAst(
  declaration: SyntaxDeclaration,
): CustomPropertyDeclarationAst {
  // Custom property names are case-sensitive. Preserve declaration.name exactly.
  //
  // Syntax already consumed final !important into declaration.important and
  // removed it from declaration.value.
  return {
    kind: BlockItemAstKind.Declaration,
    prop: PropertyId.Custom,
    name: declaration.name,
    value: declaration.value,
    important: declaration.important,
  };
}

// -----------------
// Serialize
// -----------------

export type SerializedDeclarationAst = {
  name: string;
  value: string;
  important: boolean;
};

export function serializeAstDeclaration(declaration: DeclarationAst): SerializedDeclarationAst | null {
  switch (declaration.prop) {
    case PropertyId.MarginLeft:
    case PropertyId.MarginRight:
    case PropertyId.MarginTop:
    case PropertyId.MarginBottom:
      return {
        name: getName(declaration.prop),
        value: serialize(declaration.value, serializeMarginSideValue),
        important: declaration.important,
      };

    case PropertyId.Custom:
      return {
        name: declaration.name,
        value: serializeComponentValues(declaration.value),
        important: declaration.important,
      };

    case PropertyId.AnimationName:
      return {
        name: getName(declaration.prop),
        value: serialize(declaration.value, serializeAnimationName),
        important: declaration.important,
      };

    default:
      return null;
  }
}

function serialize<T>(value: T | CssWideValue, serialize: (value: T) => string): string {
  const isCssWideValue = (value: T | CssWideValue): value is CssWideValue =>
    !!value &&
    typeof value === 'object' &&
    (value as { type?: unknown; }).type === 'css-wide';

  return isCssWideValue(value)
    ? value.serialize()
    : serialize(value);
}

function getName(prop: PropertyId): string {
  return requireDefined(
    getPropertyName(prop),
    () => `No serialized property name for PropertyId ${prop}`,
  );
}

// -------------------
// Registry
// -------------------

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

function getPropertyId(name: string): PropertyId {
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

function getPropertyName(id: PropertyId): string | undefined {
  return PropertyNameById[id];
}

function isCustomPropertyName(name: string): boolean {
  return name.startsWith('--');
}
