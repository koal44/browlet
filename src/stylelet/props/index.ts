export type {
  PropertyRecord, CustomPropertyName, CustomPropertyRegistration, CustomPropertyRegistry, PropertyContext,
} from './property';
export { propertyRegistry, type PropertyName, type PropertyValue } from './registry';
export { getShorthand, getShorthands, shorthandRegistry, type ShorthandRecord } from './shorthand';
export {
  backgroundColorProperty, colorProperty, parseColorProperty,
  parseMarginSideProperty, marginSideProperty, opacityProperty, parseOpacityProperty,
} from './built-in/index';
