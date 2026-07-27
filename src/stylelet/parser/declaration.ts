import {
  BlockItemAstKind, PropertyId, getPropertyId, type CustomPropertyDeclarationAst,
  type DeclarationAst,
} from './types';
import type { Declaration as SyntaxDeclaration } from './syntax';
import { parseCssWideValue } from '../values/css-wide';
import { parseColorValue } from '../values/color';
import { isDeclarationValue } from '../values/declaration-value';
import { parseAnimationNameValue } from '../props/animation-name';
import { parseMarginSideValue } from '../props/margin';

export function buildDeclarationAst(declaration: SyntaxDeclaration): DeclarationAst | null {
  if (declaration.value.length > 0 && !isDeclarationValue(declaration.value)) {
    return null;
  }

  const name = declaration.name;
  const prop = getPropertyId(name);

  switch (prop) {
    case PropertyId.Color:
    case PropertyId.BackgroundColor: {
      const value =
        parseCssWideValue(declaration.value) ?? parseColorValue(declaration.value);

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
        parseCssWideValue(declaration.value) ?? parseMarginSideValue(declaration.value);

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
        parseCssWideValue(declaration.value) ?? parseAnimationNameValue(declaration.value);
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
