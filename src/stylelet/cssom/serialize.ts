import { requireDefined } from '../../utils/util';
import type { DeclarationAst } from '../parser/types';
import { PropertyId, propertyNameFor } from '../parser/types';
import { isCssWideValue, serializeCssWideValue, type CssWideValue } from '../values/css-wide';
import { serializeLengthPercentageAuto } from '../values/length-percentage';

export type SerializedDeclaration = {
  name: string;
  value: string;
  important: boolean;
};

export function serializeAstDeclaration(declaration: DeclarationAst): SerializedDeclaration | null {
  switch (declaration.prop) {
    case PropertyId.MarginLeft:
    case PropertyId.MarginRight:
    case PropertyId.MarginTop:
    case PropertyId.MarginBottom:
      return {
        name: getName(declaration.prop),
        value: serialize(declaration.value, serializeLengthPercentageAuto),
        important: declaration.important,
      };

    case PropertyId.Custom:
      return {
        name: declaration.name,
        value: serialize(declaration.value, (v) => v),
        important: declaration.important,
      };

    default:
      return null;
  }
}

function serialize<T>(value: T | CssWideValue, serialize: (value: T) => string): string {
  return isCssWideValue(value)
    ? serializeCssWideValue(value)
    : serialize(value);
}

function getName(prop: PropertyId): string {
  return requireDefined(
    propertyNameFor(prop),
    () => `No serialized property name for PropertyId ${prop}`,
  );
}
