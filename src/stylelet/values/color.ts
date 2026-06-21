import type { Cursor } from '../../selectlet/parser/cursor';
import { consumeIdent } from '../../selectlet/parser/lex';

export type ColorValue = {
  source: ColorSource;
  rgba?: number;
};

export enum ColorSourceKind {
  Named = 1,
  CurrentColor,
  System,
  Hex,
  Rgb,
  Hsl,
  Hwb,
  Lab,
  Lch,
  Oklab,
  Oklch,
  Color,
  Raw,
}

export enum ColorName {
  none = 0,
  transparent,
  aliceblue,
  antiquewhite,
  aqua,
  aquamarine,
  azure,
  beige,
  bisque,
  black,
  blanchedalmond,
  blue,
  blueviolet,
  brown,
  burlywood,
  cadetblue,
  chartreuse,
  chocolate,
  coral,
  cornflowerblue,
  cornsilk,
  crimson,
  cyan,
  darkblue,
  darkcyan,
  darkgoldenrod,
  darkgray,
  darkgreen,
  darkgrey,
  darkkhaki,
  darkmagenta,
  darkolivegreen,
  darkorange,
  darkorchid,
  darkred,
  darksalmon,
  darkseagreen,
  darkslateblue,
  darkslategray,
  darkslategrey,
  darkturquoise,
  darkviolet,
  deeppink,
  deepskyblue,
  dimgray,
  dimgrey,
  dodgerblue,
  firebrick,
  floralwhite,
  forestgreen,
  fuchsia,
  gainsboro,
  ghostwhite,
  gold,
  goldenrod,
  gray,
  green,
  greenyellow,
  grey,
  honeydew,
  hotpink,
  indianred,
  indigo,
  ivory,
  khaki,
  lavender,
  lavenderblush,
  lawngreen,
  lemonchiffon,
  lightblue,
  lightcoral,
  lightcyan,
  lightgoldenrodyellow,
  lightgray,
  lightgreen,
  lightgrey,
  lightpink,
  lightsalmon,
  lightseagreen,
  lightskyblue,
  lightslategray,
  lightslategrey,
  lightsteelblue,
  lightyellow,
  lime,
  limegreen,
  linen,
  magenta,
  maroon,
  mediumaquamarine,
  mediumblue,
  mediumorchid,
  mediumpurple,
  mediumseagreen,
  mediumslateblue,
  mediumspringgreen,
  mediumturquoise,
  mediumvioletred,
  midnightblue,
  mintcream,
  mistyrose,
  moccasin,
  navajowhite,
  navy,
  oldlace,
  olive,
  olivedrab,
  orange,
  orangered,
  orchid,
  palegoldenrod,
  palegreen,
  paleturquoise,
  palevioletred,
  papayawhip,
  peachpuff,
  peru,
  pink,
  plum,
  powderblue,
  purple,
  rebeccapurple,
  red,
  rosybrown,
  royalblue,
  saddlebrown,
  salmon,
  sandybrown,
  seagreen,
  seashell,
  sienna,
  silver,
  skyblue,
  slateblue,
  slategray,
  slategrey,
  snow,
  springgreen,
  steelblue,
  tan,
  teal,
  thistle,
  tomato,
  turquoise,
  violet,
  wheat,
  white,
  whitesmoke,
  yellow,
  yellowgreen,
}

export const ColorNameByText: { [name: string]: ColorName | undefined; } = {
  transparent: ColorName.transparent,
  aliceblue: ColorName.aliceblue,
  antiquewhite: ColorName.antiquewhite,
  aqua: ColorName.aqua,
  aquamarine: ColorName.aquamarine,
  azure: ColorName.azure,
  beige: ColorName.beige,
  bisque: ColorName.bisque,
  black: ColorName.black,
  blanchedalmond: ColorName.blanchedalmond,
  blue: ColorName.blue,
  blueviolet: ColorName.blueviolet,
  brown: ColorName.brown,
  burlywood: ColorName.burlywood,
  cadetblue: ColorName.cadetblue,
  chartreuse: ColorName.chartreuse,
  chocolate: ColorName.chocolate,
  coral: ColorName.coral,
  cornflowerblue: ColorName.cornflowerblue,
  cornsilk: ColorName.cornsilk,
  crimson: ColorName.crimson,
  cyan: ColorName.cyan,
  darkblue: ColorName.darkblue,
  darkcyan: ColorName.darkcyan,
  darkgoldenrod: ColorName.darkgoldenrod,
  darkgray: ColorName.darkgray,
  darkgreen: ColorName.darkgreen,
  darkgrey: ColorName.darkgrey,
  darkkhaki: ColorName.darkkhaki,
  darkmagenta: ColorName.darkmagenta,
  darkolivegreen: ColorName.darkolivegreen,
  darkorange: ColorName.darkorange,
  darkorchid: ColorName.darkorchid,
  darkred: ColorName.darkred,
  darksalmon: ColorName.darksalmon,
  darkseagreen: ColorName.darkseagreen,
  darkslateblue: ColorName.darkslateblue,
  darkslategray: ColorName.darkslategray,
  darkslategrey: ColorName.darkslategrey,
  darkturquoise: ColorName.darkturquoise,
  darkviolet: ColorName.darkviolet,
  deeppink: ColorName.deeppink,
  deepskyblue: ColorName.deepskyblue,
  dimgray: ColorName.dimgray,
  dimgrey: ColorName.dimgrey,
  dodgerblue: ColorName.dodgerblue,
  firebrick: ColorName.firebrick,
  floralwhite: ColorName.floralwhite,
  forestgreen: ColorName.forestgreen,
  fuchsia: ColorName.fuchsia,
  gainsboro: ColorName.gainsboro,
  ghostwhite: ColorName.ghostwhite,
  gold: ColorName.gold,
  goldenrod: ColorName.goldenrod,
  gray: ColorName.gray,
  green: ColorName.green,
  greenyellow: ColorName.greenyellow,
  grey: ColorName.grey,
  honeydew: ColorName.honeydew,
  hotpink: ColorName.hotpink,
  indianred: ColorName.indianred,
  indigo: ColorName.indigo,
  ivory: ColorName.ivory,
  khaki: ColorName.khaki,
  lavender: ColorName.lavender,
  lavenderblush: ColorName.lavenderblush,
  lawngreen: ColorName.lawngreen,
  lemonchiffon: ColorName.lemonchiffon,
  lightblue: ColorName.lightblue,
  lightcoral: ColorName.lightcoral,
  lightcyan: ColorName.lightcyan,
  lightgoldenrodyellow: ColorName.lightgoldenrodyellow,
  lightgray: ColorName.lightgray,
  lightgreen: ColorName.lightgreen,
  lightgrey: ColorName.lightgrey,
  lightpink: ColorName.lightpink,
  lightsalmon: ColorName.lightsalmon,
  lightseagreen: ColorName.lightseagreen,
  lightskyblue: ColorName.lightskyblue,
  lightslategray: ColorName.lightslategray,
  lightslategrey: ColorName.lightslategrey,
  lightsteelblue: ColorName.lightsteelblue,
  lightyellow: ColorName.lightyellow,
  lime: ColorName.lime,
  limegreen: ColorName.limegreen,
  linen: ColorName.linen,
  magenta: ColorName.magenta,
  maroon: ColorName.maroon,
  mediumaquamarine: ColorName.mediumaquamarine,
  mediumblue: ColorName.mediumblue,
  mediumorchid: ColorName.mediumorchid,
  mediumpurple: ColorName.mediumpurple,
  mediumseagreen: ColorName.mediumseagreen,
  mediumslateblue: ColorName.mediumslateblue,
  mediumspringgreen: ColorName.mediumspringgreen,
  mediumturquoise: ColorName.mediumturquoise,
  mediumvioletred: ColorName.mediumvioletred,
  midnightblue: ColorName.midnightblue,
  mintcream: ColorName.mintcream,
  mistyrose: ColorName.mistyrose,
  moccasin: ColorName.moccasin,
  navajowhite: ColorName.navajowhite,
  navy: ColorName.navy,
  oldlace: ColorName.oldlace,
  olive: ColorName.olive,
  olivedrab: ColorName.olivedrab,
  orange: ColorName.orange,
  orangered: ColorName.orangered,
  orchid: ColorName.orchid,
  palegoldenrod: ColorName.palegoldenrod,
  palegreen: ColorName.palegreen,
  paleturquoise: ColorName.paleturquoise,
  palevioletred: ColorName.palevioletred,
  papayawhip: ColorName.papayawhip,
  peachpuff: ColorName.peachpuff,
  peru: ColorName.peru,
  pink: ColorName.pink,
  plum: ColorName.plum,
  powderblue: ColorName.powderblue,
  purple: ColorName.purple,
  rebeccapurple: ColorName.rebeccapurple,
  red: ColorName.red,
  rosybrown: ColorName.rosybrown,
  royalblue: ColorName.royalblue,
  saddlebrown: ColorName.saddlebrown,
  salmon: ColorName.salmon,
  sandybrown: ColorName.sandybrown,
  seagreen: ColorName.seagreen,
  seashell: ColorName.seashell,
  sienna: ColorName.sienna,
  silver: ColorName.silver,
  skyblue: ColorName.skyblue,
  slateblue: ColorName.slateblue,
  slategray: ColorName.slategray,
  slategrey: ColorName.slategrey,
  snow: ColorName.snow,
  springgreen: ColorName.springgreen,
  steelblue: ColorName.steelblue,
  tan: ColorName.tan,
  teal: ColorName.teal,
  thistle: ColorName.thistle,
  tomato: ColorName.tomato,
  turquoise: ColorName.turquoise,
  violet: ColorName.violet,
  wheat: ColorName.wheat,
  white: ColorName.white,
  whitesmoke: ColorName.whitesmoke,
  yellow: ColorName.yellow,
  yellowgreen: ColorName.yellowgreen,
};

export const ColorRgba: Partial<Record<ColorName, number>> = {
  [ColorName.transparent]: 0x00000000,
  [ColorName.aliceblue]: opaque(0xf0f8ff),
  [ColorName.antiquewhite]: opaque(0xfaebd7),
  [ColorName.aqua]: opaque(0x00ffff),
  [ColorName.aquamarine]: opaque(0x7fffd4),
  [ColorName.azure]: opaque(0xf0ffff),
  [ColorName.beige]: opaque(0xf5f5dc),
  [ColorName.bisque]: opaque(0xffe4c4),
  [ColorName.black]: opaque(0x000000),
  [ColorName.blanchedalmond]: opaque(0xffebcd),
  [ColorName.blue]: opaque(0x0000ff),
  [ColorName.blueviolet]: opaque(0x8a2be2),
  [ColorName.brown]: opaque(0xa52a2a),
  [ColorName.burlywood]: opaque(0xdeb887),
  [ColorName.cadetblue]: opaque(0x5f9ea0),
  [ColorName.chartreuse]: opaque(0x7fff00),
  [ColorName.chocolate]: opaque(0xd2691e),
  [ColorName.coral]: opaque(0xff7f50),
  [ColorName.cornflowerblue]: opaque(0x6495ed),
  [ColorName.cornsilk]: opaque(0xfff8dc),
  [ColorName.crimson]: opaque(0xdc143c),
  [ColorName.cyan]: opaque(0x00ffff),
  [ColorName.darkblue]: opaque(0x00008b),
  [ColorName.darkcyan]: opaque(0x008b8b),
  [ColorName.darkgoldenrod]: opaque(0xb8860b),
  [ColorName.darkgray]: opaque(0xa9a9a9),
  [ColorName.darkgreen]: opaque(0x006400),
  [ColorName.darkgrey]: opaque(0xa9a9a9),
  [ColorName.darkkhaki]: opaque(0xbdb76b),
  [ColorName.darkmagenta]: opaque(0x8b008b),
  [ColorName.darkolivegreen]: opaque(0x556b2f),
  [ColorName.darkorange]: opaque(0xff8c00),
  [ColorName.darkorchid]: opaque(0x9932cc),
  [ColorName.darkred]: opaque(0x8b0000),
  [ColorName.darksalmon]: opaque(0xe9967a),
  [ColorName.darkseagreen]: opaque(0x8fbc8f),
  [ColorName.darkslateblue]: opaque(0x483d8b),
  [ColorName.darkslategray]: opaque(0x2f4f4f),
  [ColorName.darkslategrey]: opaque(0x2f4f4f),
  [ColorName.darkturquoise]: opaque(0x00ced1),
  [ColorName.darkviolet]: opaque(0x9400d3),
  [ColorName.deeppink]: opaque(0xff1493),
  [ColorName.deepskyblue]: opaque(0x00bfff),
  [ColorName.dimgray]: opaque(0x696969),
  [ColorName.dimgrey]: opaque(0x696969),
  [ColorName.dodgerblue]: opaque(0x1e90ff),
  [ColorName.firebrick]: opaque(0xb22222),
  [ColorName.floralwhite]: opaque(0xfffaf0),
  [ColorName.forestgreen]: opaque(0x228b22),
  [ColorName.fuchsia]: opaque(0xff00ff),
  [ColorName.gainsboro]: opaque(0xdcdcdc),
  [ColorName.ghostwhite]: opaque(0xf8f8ff),
  [ColorName.gold]: opaque(0xffd700),
  [ColorName.goldenrod]: opaque(0xdaa520),
  [ColorName.gray]: opaque(0x808080),
  [ColorName.green]: opaque(0x008000),
  [ColorName.greenyellow]: opaque(0xadff2f),
  [ColorName.grey]: opaque(0x808080),
  [ColorName.honeydew]: opaque(0xf0fff0),
  [ColorName.hotpink]: opaque(0xff69b4),
  [ColorName.indianred]: opaque(0xcd5c5c),
  [ColorName.indigo]: opaque(0x4b0082),
  [ColorName.ivory]: opaque(0xfffff0),
  [ColorName.khaki]: opaque(0xf0e68c),
  [ColorName.lavender]: opaque(0xe6e6fa),
  [ColorName.lavenderblush]: opaque(0xfff0f5),
  [ColorName.lawngreen]: opaque(0x7cfc00),
  [ColorName.lemonchiffon]: opaque(0xfffacd),
  [ColorName.lightblue]: opaque(0xadd8e6),
  [ColorName.lightcoral]: opaque(0xf08080),
  [ColorName.lightcyan]: opaque(0xe0ffff),
  [ColorName.lightgoldenrodyellow]: opaque(0xfafad2),
  [ColorName.lightgray]: opaque(0xd3d3d3),
  [ColorName.lightgreen]: opaque(0x90ee90),
  [ColorName.lightgrey]: opaque(0xd3d3d3),
  [ColorName.lightpink]: opaque(0xffb6c1),
  [ColorName.lightsalmon]: opaque(0xffa07a),
  [ColorName.lightseagreen]: opaque(0x20b2aa),
  [ColorName.lightskyblue]: opaque(0x87cefa),
  [ColorName.lightslategray]: opaque(0x778899),
  [ColorName.lightslategrey]: opaque(0x778899),
  [ColorName.lightsteelblue]: opaque(0xb0c4de),
  [ColorName.lightyellow]: opaque(0xffffe0),
  [ColorName.lime]: opaque(0x00ff00),
  [ColorName.limegreen]: opaque(0x32cd32),
  [ColorName.linen]: opaque(0xfaf0e6),
  [ColorName.magenta]: opaque(0xff00ff),
  [ColorName.maroon]: opaque(0x800000),
  [ColorName.mediumaquamarine]: opaque(0x66cdaa),
  [ColorName.mediumblue]: opaque(0x0000cd),
  [ColorName.mediumorchid]: opaque(0xba55d3),
  [ColorName.mediumpurple]: opaque(0x9370db),
  [ColorName.mediumseagreen]: opaque(0x3cb371),
  [ColorName.mediumslateblue]: opaque(0x7b68ee),
  [ColorName.mediumspringgreen]: opaque(0x00fa9a),
  [ColorName.mediumturquoise]: opaque(0x48d1cc),
  [ColorName.mediumvioletred]: opaque(0xc71585),
  [ColorName.midnightblue]: opaque(0x191970),
  [ColorName.mintcream]: opaque(0xf5fffa),
  [ColorName.mistyrose]: opaque(0xffe4e1),
  [ColorName.moccasin]: opaque(0xffe4b5),
  [ColorName.navajowhite]: opaque(0xffdead),
  [ColorName.navy]: opaque(0x000080),
  [ColorName.oldlace]: opaque(0xfdf5e6),
  [ColorName.olive]: opaque(0x808000),
  [ColorName.olivedrab]: opaque(0x6b8e23),
  [ColorName.orange]: opaque(0xffa500),
  [ColorName.orangered]: opaque(0xff4500),
  [ColorName.orchid]: opaque(0xda70d6),
  [ColorName.palegoldenrod]: opaque(0xeee8aa),
  [ColorName.palegreen]: opaque(0x98fb98),
  [ColorName.paleturquoise]: opaque(0xafeeee),
  [ColorName.palevioletred]: opaque(0xdb7093),
  [ColorName.papayawhip]: opaque(0xffefd5),
  [ColorName.peachpuff]: opaque(0xffdab9),
  [ColorName.peru]: opaque(0xcd853f),
  [ColorName.pink]: opaque(0xffc0cb),
  [ColorName.plum]: opaque(0xdda0dd),
  [ColorName.powderblue]: opaque(0xb0e0e6),
  [ColorName.purple]: opaque(0x800080),
  [ColorName.rebeccapurple]: opaque(0x663399),
  [ColorName.red]: opaque(0xff0000),
  [ColorName.rosybrown]: opaque(0xbc8f8f),
  [ColorName.royalblue]: opaque(0x4169e1),
  [ColorName.saddlebrown]: opaque(0x8b4513),
  [ColorName.salmon]: opaque(0xfa8072),
  [ColorName.sandybrown]: opaque(0xf4a460),
  [ColorName.seagreen]: opaque(0x2e8b57),
  [ColorName.seashell]: opaque(0xfff5ee),
  [ColorName.sienna]: opaque(0xa0522d),
  [ColorName.silver]: opaque(0xc0c0c0),
  [ColorName.skyblue]: opaque(0x87ceeb),
  [ColorName.slateblue]: opaque(0x6a5acd),
  [ColorName.slategray]: opaque(0x708090),
  [ColorName.slategrey]: opaque(0x708090),
  [ColorName.snow]: opaque(0xfffafa),
  [ColorName.springgreen]: opaque(0x00ff7f),
  [ColorName.steelblue]: opaque(0x4682b4),
  [ColorName.tan]: opaque(0xd2b48c),
  [ColorName.teal]: opaque(0x008080),
  [ColorName.thistle]: opaque(0xd8bfd8),
  [ColorName.tomato]: opaque(0xff6347),
  [ColorName.turquoise]: opaque(0x40e0d0),
  [ColorName.violet]: opaque(0xee82ee),
  [ColorName.wheat]: opaque(0xf5deb3),
  [ColorName.white]: opaque(0xffffff),
  [ColorName.whitesmoke]: opaque(0xf5f5f5),
  [ColorName.yellow]: opaque(0xffff00),
  [ColorName.yellowgreen]: opaque(0x9acd32),
};

export type ColorSource =
  | NamedColorSource
  | CurrentColorSource
  | SystemColorSource
  | HexColorSource
  | RgbColorSource
  | HslColorSource
  | HwbColorSource
  | LabColorSource
  | LchColorSource
  | OklabColorSource
  | OklchColorSource
  | ColorFunctionSource
  | RawColorSource;

export enum SystemColorName {
  AccentColor = 1,
  AccentColorText,
  ActiveText,
  ButtonBorder,
  ButtonFace,
  ButtonText,
  Canvas,
  CanvasText,
  Field,
  FieldText,
  GrayText,
  Highlight,
  HighlightText,
  LinkText,
  Mark,
  MarkText,
  SelectedItem,
  SelectedItemText,
  VisitedText,
}

export const SystemColorNameByText: { [name: string]: SystemColorName | undefined; } = {
  accentcolor: SystemColorName.AccentColor,
  accentcolortext: SystemColorName.AccentColorText,
  activetext: SystemColorName.ActiveText,
  buttonborder: SystemColorName.ButtonBorder,
  buttonface: SystemColorName.ButtonFace,
  buttontext: SystemColorName.ButtonText,
  canvas: SystemColorName.Canvas,
  canvastext: SystemColorName.CanvasText,
  field: SystemColorName.Field,
  fieldtext: SystemColorName.FieldText,
  graytext: SystemColorName.GrayText,
  highlight: SystemColorName.Highlight,
  highlighttext: SystemColorName.HighlightText,
  linktext: SystemColorName.LinkText,
  mark: SystemColorName.Mark,
  marktext: SystemColorName.MarkText,
  selecteditem: SystemColorName.SelectedItem,
  selecteditemtext: SystemColorName.SelectedItemText,
  visitedtext: SystemColorName.VisitedText,
};

export type NamedColorSource = {
  kind: ColorSourceKind.Named;
  name: ColorName;
};

export type CurrentColorSource = {
  kind: ColorSourceKind.CurrentColor;
};

export type SystemColorSource = {
  kind: ColorSourceKind.System;
  name: SystemColorName;
};

export type HexColorSource = {
  kind: ColorSourceKind.Hex;
  text: string;
};

export type RgbColorSource = {
  kind: ColorSourceKind.Rgb;
  r: number;
  g: number;
  b: number;
  a: number;
};

export type HslColorSource = {
  kind: ColorSourceKind.Hsl;
  h: number;
  s: number;
  l: number;
  a: number;
};

export type HwbColorSource = {
  kind: ColorSourceKind.Hwb;
  h: number;
  w: number;
  b: number;
  a: number;
};

export type LabColorSource = {
  kind: ColorSourceKind.Lab;
  l: number;
  a: number;
  b: number;
  alpha: number;
};

export type LchColorSource = {
  kind: ColorSourceKind.Lch;
  l: number;
  c: number;
  h: number;
  alpha: number;
};

export type OklabColorSource = {
  kind: ColorSourceKind.Oklab;
  l: number;
  a: number;
  b: number;
  alpha: number;
};

export type OklchColorSource = {
  kind: ColorSourceKind.Oklch;
  l: number;
  c: number;
  h: number;
  alpha: number;
};

export type ColorFunctionSource = {
  kind: ColorSourceKind.Color;
  space: string;
  channels: number[];
  alpha: number;
};

export type RawColorSource = {
  kind: ColorSourceKind.Raw;
  text: string;
  reason?: string;
};

export function opaque(rgb: number): number {
  return (((rgb & 0xffffff) << 8) | 0xff) >>> 0;
}

export function namedColorSource(text: string): NamedColorSource | null {
  const name = ColorNameByText[text.toLowerCase()];
  return name === undefined ? null : { kind: ColorSourceKind.Named, name };
}

export function namedColorRgba(name: ColorName): number | undefined {
  return ColorRgba[name];
}

export function resolveColorToRgba(color: ColorValue): number | null {
  if (color.rgba !== undefined) return color.rgba;

  const rgba = resolveColorSourceToRgba(color.source);
  if (rgba === null) return null;

  color.rgba = rgba;
  return rgba;
}

export function resolveColorSourceToRgba(source: ColorSource): number | null {
  switch (source.kind) {
    case ColorSourceKind.Named:
      return ColorRgba[source.name] ?? null;

    case ColorSourceKind.Hex:
      return resolveHexColorToRgba(source.text);

    case ColorSourceKind.Rgb:
      return packRgba(
        byte(source.r),
        byte(source.g),
        byte(source.b),
        alphaByte(source.a),
      );

    case ColorSourceKind.Hsl:
      return resolveHslColorToRgba(source.h, source.s, source.l, source.a);

    case ColorSourceKind.CurrentColor:
    case ColorSourceKind.System:
    case ColorSourceKind.Hwb:
    case ColorSourceKind.Lab:
    case ColorSourceKind.Lch:
    case ColorSourceKind.Oklab:
    case ColorSourceKind.Oklch:
    case ColorSourceKind.Color:
    case ColorSourceKind.Raw:
      return null;
  }
}

export function packRgba(r: number, g: number, b: number, a: number): number {
  return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}

function byte(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}

function alphaByte(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return 255;
  return Math.round(value * 255);
}

function resolveHexColorToRgba(text: string): number | null {
  const hex = text[0] === '#' ? text.slice(1) : text;

  if (hex.length === 3) {
    const r = parseHexNibble(hex.charCodeAt(0));
    const g = parseHexNibble(hex.charCodeAt(1));
    const b = parseHexNibble(hex.charCodeAt(2));

    if (r < 0 || g < 0 || b < 0) return null;

    return packRgba(r * 17, g * 17, b * 17, 255);
  }

  if (hex.length === 4) {
    const r = parseHexNibble(hex.charCodeAt(0));
    const g = parseHexNibble(hex.charCodeAt(1));
    const b = parseHexNibble(hex.charCodeAt(2));
    const a = parseHexNibble(hex.charCodeAt(3));

    if (r < 0 || g < 0 || b < 0 || a < 0) return null;

    return packRgba(r * 17, g * 17, b * 17, a * 17);
  }

  if (hex.length === 6) {
    const rgb = parseHexInt(hex);
    if (rgb < 0) return null;

    return opaque(rgb);
  }

  if (hex.length === 8) {
    const rgba = parseHexInt(hex);
    if (rgba < 0) return null;

    return rgba >>> 0;
  }

  return null;
}

function parseHexNibble(code: number): number {
  // 0-9
  if (code >= 48 && code <= 57) return code - 48;

  // A-F
  if (code >= 65 && code <= 70) return code - 55;

  // a-f
  if (code >= 97 && code <= 102) return code - 87;

  return -1;
}

function parseHexInt(hex: string): number {
  let value = 0;

  for (let i = 0; i < hex.length; i++) {
    const n = parseHexNibble(hex.charCodeAt(i));
    if (n < 0) return -1;

    value = (value * 16) + n;
  }

  return value >>> 0;
}

function resolveHslColorToRgba(h: number, s: number, l: number, a: number): number {
  h = normalizeHue(h);
  s = unit(s);
  l = unit(l);

  const c = (1 - Math.abs((2 * l) - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - (c / 2);

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (h < 60) {
    r1 = c;
    g1 = x;
  } else if (h < 120) {
    r1 = x;
    g1 = c;
  } else if (h < 180) {
    g1 = c;
    b1 = x;
  } else if (h < 240) {
    g1 = x;
    b1 = c;
  } else if (h < 300) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }

  return packRgba(
    byte((r1 + m) * 255),
    byte((g1 + m) * 255),
    byte((b1 + m) * 255),
    alphaByte(a),
  );
}

function normalizeHue(h: number): number {
  h = h % 360;
  return h < 0 ? h + 360 : h;
}

function unit(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function parseColorValue(c: Cursor): ColorValue {
  const raw = consumeIdent(c);
  const text = raw.toLowerCase();

  if (text === 'currentcolor') {
    return {
      source: {
        kind: ColorSourceKind.CurrentColor,
      },
    };
  }

  const name = ColorNameByText[text];

  if (name === undefined) {
    c.error(`Expected color, got ${raw}`);
  }

  const source: ColorSource = {
    kind: ColorSourceKind.Named,
    name,
  };

  const rgba = namedColorRgba(name);

  return rgba === undefined ? { source } : { source, rgba };
}
