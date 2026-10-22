import { absoluteColorFromRgba, type AbsoluteColor, type SystemColorName } from '../values/index';

/** Create an independent light palette, replacing selected entries with host-supplied colors. */
// https://drafts.csswg.org/css-color-4/#css-system-colors
// These fixed defaults are Stylelet's choice, not colors discovered from the operating system.
export function createSystemColorPalette(
  overrides: Partial<Record<SystemColorName, AbsoluteColor>> = {},
): SystemColorPalette {
  const palette: SystemColorPalette = new Map();
  for (const name of Object.keys(defaultColors) as SystemColorName[]) {
    palette.set(name, overrides[name] ?? absoluteColorFromRgba(defaultColors[name]));
  }
  return palette;
}

/** Complete system-color mapping. Replace entries rather than mutate retained color payloads. */
export type SystemColorPalette = Map<SystemColorName, AbsoluteColor>;

const defaultColors: Record<SystemColorName, number> = {
  accentcolor: 0x005fccff,
  accentcolortext: 0xffffffff,
  activetext: 0xee0000ff,
  buttonborder: 0x767676ff,
  buttonface: 0xf0f0f0ff,
  buttontext: 0x000000ff,
  canvas: 0xffffffff,
  canvastext: 0x000000ff,
  field: 0xffffffff,
  fieldtext: 0x000000ff,
  graytext: 0x6d6d6dff,
  highlight: 0x005fccff,
  highlighttext: 0xffffffff,
  linktext: 0x0000eeff,
  mark: 0xffff00ff,
  marktext: 0x000000ff,
  selecteditem: 0x005fccff,
  selecteditemtext: 0xffffffff,
  visitedtext: 0x551a8bff,
};
