export {
  interpretPropertyDeclaration, interpretPropertyDeclarations, propertyRegistry,
  serializePropertyDeclaration, resolveBuiltInPropertyDeclaration,
  type PropertyRecord, type PropertyDeclaration, type CustomPropertyName, type CustomPropertyRegistration,
  type CustomPropertyRegistry, type PropertyContext, type PropertyName,
} from './property';
export { backgroundColorProperty, colorProperty, colorWholeValueDef } from './color';
export {
  marginSideWholeValueDef,
  marginBottomProperty, marginLeftProperty, marginRightProperty, marginTopProperty,
} from './margin';
export { opacityProperty, opacityWholeValueDef } from './opacity';
