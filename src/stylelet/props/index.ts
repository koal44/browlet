export {
  BaseProperty, type AnimationType, type PropertyAnimation,
  type PropertyPercentages, type ResolvedValueStage, type PropertyContext,
} from './base-property';
export { BuiltInProperty, type BuiltInPropertyDefinition } from './builtin-property';
export type { CustomPropertyName } from '../syntax/index';
export {
  builtInRegistry as propertyRegistry, getBuiltInProperty,
  type BuiltInRegistry as PropertyRegistry, type PropertyName, type BuiltInPropertyName,
  type BuiltInPropertyValue as PropertyValue,
  type CustomPropertyRegistration, type CustomPropertyRegistry, type RegistryContext,
} from './registry';
export { CustomProperty, type CustomPropertyValue } from './custom-property';
export { Shorthand, FourSidesShorthand } from './shorthand';
export {
  backgroundColorProperty, colorProperty, marginProperty, marginTopProperty, marginRightProperty,
  marginBottomProperty, marginLeftProperty, opacityProperty,
} from './built-in/index';
