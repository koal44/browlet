import { assertNever } from '../../utils/util';
import type { DeclarationAst, GlobalValue, MarginSideDeclarationAst } from '../parser/types';
import { PropertyId } from '../parser/types';
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
      return serializeMarginSideDeclaration(declaration);

    case PropertyId.Custom:
      return {
        name: declaration.name,
        value: declaration.value,
        important: declaration.important,
      };

    default:
      return null;
  }
}

function isGlobalValue(value: unknown): value is GlobalValue {
  return !!value
    && typeof value === 'object'
    && (value as { type?: unknown; }).type === 'global';
}

function serializeGlobalValue(value: GlobalValue): string {
  switch (value.keyword) {
    case 'inherit': return 'inherit';
    case 'initial': return 'initial';
    case 'unset': return 'unset';
    case 'revert': return 'revert';
    case 'revert-layer': return 'revert-layer';
    default: assertNever(value.keyword);
  }
}


function serializeMarginSideDeclaration(declaration: MarginSideDeclarationAst): SerializedDeclaration {
  const value = isGlobalValue(declaration.value)
    ? serializeGlobalValue(declaration.value)
    : serializeLengthPercentageAuto(declaration.value);
  return {
    name: marginSidePropertyName(declaration.prop),
    value: value,
    important: declaration.important,
  };
}

function marginSidePropertyName(prop: MarginSideDeclarationAst['prop']): string {
  switch (prop) {
    case PropertyId.MarginTop: return 'margin-top';
    case PropertyId.MarginRight: return 'margin-right';
    case PropertyId.MarginBottom: return 'margin-bottom';
    case PropertyId.MarginLeft: return 'margin-left';
  }
}
