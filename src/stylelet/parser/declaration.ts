import {
  BlockItemAstKind, PropertyId, getPropertyId,
  type CustomPropertyDeclarationAst, type DeclarationAst,
} from './types';
import {
  isDeclarationValue,
  type Declaration as SyntaxDeclaration,
} from './syntax';
import { tryParseCssWideValue } from '../values/css-wide';
import { parseColorValue } from '../values/color';
import { parseLengthPercentageAuto } from '../values/length-percentage';
import { parseAnimationNameValue } from '../props/animation-name';

export function buildDeclarationAst(declaration: SyntaxDeclaration): DeclarationAst | null {
  if (!isDeclarationValue(declaration.value)) {
    return null;
  }

  const name = declaration.name;
  const prop = getPropertyId(name);

  switch (prop) {
    case PropertyId.Color:
    case PropertyId.BackgroundColor: {
      const value =
        tryParseCssWideValue(declaration.value) ?? parseColorValue(declaration.value);

      if (value === null) return null;

      return {
        kind: BlockItemAstKind.Declaration,
        prop,
        value,
        important: declaration.important,
      };
    }

    case PropertyId.MarginTop:
    case PropertyId.MarginRight:
    case PropertyId.MarginBottom:
    case PropertyId.MarginLeft: {
      const value =
        tryParseCssWideValue(declaration.value) ?? parseLengthPercentageAuto(declaration.value);

      if (value === null) return null;

      return {
        kind: BlockItemAstKind.Declaration,
        prop,
        value,
        important: declaration.important,
      };
    }

    case PropertyId.AnimationName: {
      const value =
        tryParseCssWideValue(declaration.value) ?? parseAnimationNameValue(declaration.value);
      if (value === null) return null;
      return {
        kind: BlockItemAstKind.Declaration,
        prop,
        value,
        important: declaration.important,
      };
    }

    case PropertyId.Custom:
      return buildCustomPropertyDeclarationAst(declaration);

    case PropertyId.Unknown:
      return null;

    default:
      return null;
  }
}

function buildCustomPropertyDeclarationAst(
  declaration: SyntaxDeclaration,
): CustomPropertyDeclarationAst | null {
  // Custom property names are case-sensitive. Preserve declaration.name exactly.
  //
  // Syntax already consumed final !important into declaration.important and
  // removed it from declaration.value.
  return {
    kind: BlockItemAstKind.Declaration,
    prop: PropertyId.Custom,
    name: declaration.name,
    value: declaration.value,
    important: declaration.important,
  };
}
