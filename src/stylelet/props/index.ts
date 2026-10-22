export {
  PropertyRecord, type CustomPropertyRegistration, type CustomPropertyRegistry, type PropertyContext,
} from './property';
export type { CustomPropertyName } from '../syntax/index';
export { propertyRegistry, type PropertyName, type BuiltInPropertyName, type PropertyValue } from './registry';
export { Shorthand } from './shorthand';
export { getShorthand, getShorthands, shorthandRegistry } from './shorthand-registry';
export { backgroundColorProperty, colorProperty, marginSideProperty, opacityProperty } from './built-in/index';
