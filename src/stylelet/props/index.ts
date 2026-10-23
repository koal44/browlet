export {
  BaseProperty, type AnimationType, type PropertyAnimation,
  type PropertyPercentages, type ResolvedValueStage, type PropertyContext,
} from './base-property';
export { BuiltInProperty, type BuiltInPropertyDefinition } from './builtin-property';
export type { CustomPropertyName } from '../syntax/index';
export {
  builtInRegistry as propertyRegistry, type BuiltInRegistry as PropertyRegistry, type PropertyName, type BuiltInPropertyName, type BuiltInPropertyValue as PropertyValue,
  type CustomPropertyRegistration, type CustomPropertyRegistry, type RegistryContext,
} from './registry';
export { CustomProperty, type CustomPropertyValue } from './custom-property';
export { Shorthand } from './shorthand';
export { getShorthand, getShorthands, shorthandRegistry } from './shorthand-registry';
export {
  backgroundColorProperty, colorProperty, marginTopProperty, marginRightProperty,
  marginBottomProperty, marginLeftProperty, opacityProperty,
} from './built-in/index';
