import type { CustomPropertyName } from '../../syntax/index';

import { backgroundColorProperty, colorProperty } from './color';
import {
  marginProperty, marginTopProperty, marginRightProperty, marginBottomProperty, marginLeftProperty,
} from './margin';
import { opacityProperty } from './opacity';
import { touchActionProperty } from './touch-action';

/** Installed built-in properties, retaining each definition's concrete type. */
export const builtInRegistry = {
  'background-color': backgroundColorProperty,
  color: colorProperty,
  margin: marginProperty,
  'margin-bottom': marginBottomProperty,
  'margin-left': marginLeftProperty,
  'margin-right': marginRightProperty,
  'margin-top': marginTopProperty,
  opacity: opacityProperty,
  'touch-action': touchActionProperty,
} as const;

/** Installed property records, retaining each entry's concrete type. */
export type BuiltInRegistry = typeof builtInRegistry;

/** Built-in property names installed in the registry, including shorthands. */
export type BuiltInPropertyName = keyof typeof builtInRegistry;

/** Whole-value family accepted by a supported built-in property. */
export type BuiltInPropertyValue<N extends BuiltInPropertyName> = BuiltInRegistry[N]['initialValue'];

/** Supported property names; interpretation expands shorthands before retaining declarations. */
export type PropertyName = BuiltInPropertyName | CustomPropertyName;

/** Find either kind of built-in property using its normalized CSS name. */
export function getBuiltInProperty(name: string): BuiltInRegistry[BuiltInPropertyName] | undefined {
  return Object.hasOwn(builtInRegistry, name) ? builtInRegistry[name as BuiltInPropertyName] : undefined;
}
