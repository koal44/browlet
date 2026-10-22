import type { CustomPropertyName } from '../syntax/index';
import { backgroundColorProperty, colorProperty, marginSideProperty, opacityProperty } from './built-in/index';

/** Shared grammars and metadata for supported built-in properties. */
export const propertyRegistry = {
  'background-color': backgroundColorProperty,
  color: colorProperty,
  'margin-bottom': marginSideProperty,
  'margin-left': marginSideProperty,
  'margin-right': marginSideProperty,
  'margin-top': marginSideProperty,
  opacity: opacityProperty,
} as const;

/** Names accepted by interpreted declarations: supported longhands or custom properties. */
export type PropertyName = BuiltInPropertyName | CustomPropertyName;

/** Built-in longhand names installed in the registry. */
export type BuiltInPropertyName = keyof PropertyRegistry;

/** Parsed value type associated with a supported built-in property name. */
export type PropertyValue<Name extends BuiltInPropertyName> = NonNullable<ReturnType<PropertyRegistry[Name]['parse']>>;

/** Registry entries retain each property's parser and metadata. */
type PropertyRegistry = typeof propertyRegistry;
