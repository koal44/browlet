export {
  interpretPropertyDeclaration, interpretPropertyDeclarations, propertyRegistry,
  serializePropertyDeclaration, resolveBuiltInPropertyDeclaration,
  type PropertyRecord, type PropertyDeclaration, type BuiltInPropertyDeclaration, type CustomPropertyName, type CustomPropertyRegistration,
  type CustomPropertyRegistry, type PropertyContext, type PropertyName,
} from './property';
export { getShorthand, getShorthands, shorthandRegistry, type ShorthandRecord } from './shorthand';
export { backgroundColorProperty, colorProperty, colorWholeValueDef } from './color';
export { marginSideWholeValueDef, marginSideProperty } from './margin';
export { opacityProperty, opacityWholeValueDef } from './opacity';
