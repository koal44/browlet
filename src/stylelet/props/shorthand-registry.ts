import { marginShorthand } from './built-in/index';

import { builtInRegistry, type BuiltInPropertyName } from './registry';

/** Known shorthands; each instance owns its shared handling and family grammar. */
export const shorthandRegistry = {
  margin: marginShorthand,
};

/** Find a shorthand using its normalized CSS name. */
export function getShorthand(name: string): RegisteredShorthand | undefined {
  return Object.hasOwn(shorthandRegistry, name)
    ? shorthandRegistry[name as keyof typeof shorthandRegistry]
    : undefined;
}

/** Shared registry entries containing a longhand, in declaration-block serialization order. */
// https://drafts.csswg.org/cssom/#concept-shorthands-preferred-order
export function getShorthands(name: BuiltInPropertyName): RegisteredShorthand[] {
  return shorthandsByLonghand.get(name)!;
}

type RegisteredShorthand = typeof shorthandRegistry[keyof typeof shorthandRegistry];

// Registry metadata is fixed; compute prefix ranks and preferred order once.
const preferredShorthands = Object.values(shorthandRegistry)
  .map((shorthand) => ({
    shorthand, rank: shorthand.name.startsWith('-webkit-') ? 1 : shorthand.name.startsWith('-') ? 2 : 0,
  }))
  .sort((a, b) => b.shorthand.longhands.length - a.shorthand.longhands.length || a.rank - b.rank ||
    (a.shorthand.name < b.shorthand.name ? -1 : a.shorthand.name > b.shorthand.name ? 1 : 0))
  .map(({ shorthand }) => shorthand);

// Each relationship is declared once, on its shorthand; build the reverse lookup once too.
const shorthandsByLonghand = new Map<BuiltInPropertyName, RegisteredShorthand[]>();
for (const name of Object.keys(builtInRegistry) as BuiltInPropertyName[]) shorthandsByLonghand.set(name, []);
for (const shorthand of preferredShorthands) {
  for (const { name } of shorthand.longhands) shorthandsByLonghand.get(name)!.push(shorthand);
}
