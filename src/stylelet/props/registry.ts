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

export type PropertyName = keyof typeof propertyRegistry;

/** Parsed value type associated with a registered property name. */
export type PropertyValue<Name extends PropertyName> = PropertyValues[Name];

type PropertyValues = {
  [Name in PropertyName]: NonNullable<ReturnType<(typeof propertyRegistry)[Name]['parse']>>;
};
