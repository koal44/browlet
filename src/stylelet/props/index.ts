export {
  interpretPropertyDeclaration, interpretPropertyDeclarations, propertyRegistry,
  serializePropertyDeclaration, resolveBuiltInPropertyDeclaration,
  type PropertyRecord, type PropertyDeclaration, type BuiltInPropertyDeclaration, type CustomPropertyName, type CustomPropertyRegistration,
  type CustomPropertyRegistry, type PropertyContext, type PropertyName,
} from './property';
export { getShorthand, getShorthands, shorthandRegistry, type ShorthandRecord } from './shorthand';
export { backgroundColorProperty, colorProperty, parseColorProperty } from './color';
export { parseMarginSideProperty, marginSideProperty } from './margin';
export { opacityProperty, parseOpacityProperty } from './opacity';
