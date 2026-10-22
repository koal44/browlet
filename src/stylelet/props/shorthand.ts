import type { ParserInput } from '../syntax/index';
import { marginShorthand } from './built-in/index';

import type { PropertyContext } from './property';
import type { PropertyName, PropertyValue } from './registry';

/** A shorthand's longhand mapping and property-family grammar/serialization. */
export type ShorthandRecord = {
  /** Longhands in the shorthand's canonical order, including reset-only properties. */
  longhands: PropertyName[];
  /** Parse into values in longhand order; the declaration owner supplies names and importance. */
  expand: (input: ParserInput, context: PropertyContext) => PropertyValue<PropertyName>[] | null;
  /** Serialize complete, equally important longhand values in canonical order, or empty text if incompatible. */
  serialize: (values: PropertyValue<PropertyName>[]) => string;
};

/** Known shorthand dependencies; a record may still expose explicit unfinished operations. */
export const shorthandRegistry = {
  margin: marginShorthand,
};

/** Find a shorthand using its normalized CSS name. */
export function getShorthand(name: string): ShorthandRecord | undefined {
  return Object.hasOwn(shorthandRegistry, name)
    ? shorthandRegistry[name as keyof typeof shorthandRegistry]
    : undefined;
}

/** Shorthands containing a longhand, ordered for declaration-block serialization. */
// https://drafts.csswg.org/cssom/#concept-shorthands-preferred-order
export function getShorthands(name: PropertyName): Array<[string, ShorthandRecord]> {
  return preferredShorthands.filter(([, shorthand]) => shorthand.longhands.includes(name));
}

// Registry metadata is fixed; compute prefix ranks and preferred order once.
const preferredShorthands = Object.entries(shorthandRegistry)
  .map(([name, shorthand]) => ({ name, shorthand, rank: name.startsWith('-webkit-') ? 1 : name.startsWith('-') ? 2 : 0 }))
  .sort((a, b) => b.shorthand.longhands.length - a.shorthand.longhands.length || a.rank - b.rank ||
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  .map(({ name, shorthand }): [string, ShorthandRecord] => [name, shorthand]);
